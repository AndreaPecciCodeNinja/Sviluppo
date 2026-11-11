import {
  getReplyTemplate,
  listReplyTemplates,
  renderTemplate,
  type ReplyTemplate,
} from "./reply-templates";

export type ReplyProvider = "claude" | "ollama";

export type SuggestReplyResult = {
  draft: string;
  templateId: string;
  templateLabel: string;
  slots: Record<string, string>;
  rationale: string;
  model: string;
  provider: ReplyProvider;
  intentSummary: string;
};

type ModelChoice = {
  template_id?: string;
  slots?: Record<string, string>;
  rationale?: string;
  intent_summary?: string;
};

export function getReplyProvider(): ReplyProvider {
  // Default ollama for local Mac/dev; set REPLY_PROVIDER=claude to use Anthropic.
  const raw = (process.env.REPLY_PROVIDER || "ollama").trim().toLowerCase();
  return raw === "claude" ? "claude" : "ollama";
}

export function getClaudeConfig() {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || "",
    // Fast routing model (alias → claude-haiku-4-5-20251001). Override with ANTHROPIC_MODEL.
    model: process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5",
  };
}

export function getOllamaConfig() {
  const base =
    process.env.OLLAMA_BASE_URL?.trim().replace(/\/+$/, "") ||
    "http://127.0.0.1:11434";
  return {
    baseUrl: base,
    model: process.env.OLLAMA_MODEL?.trim() || "qwen2.5:7b",
  };
}

export function getReplyAgentStatus() {
  const provider = getReplyProvider();
  if (provider === "ollama") {
    const { baseUrl, model } = getOllamaConfig();
    return {
      provider,
      configured: true,
      model,
      baseUrl,
      missing: [] as string[],
    };
  }
  const { apiKey, model } = getClaudeConfig();
  return {
    provider,
    configured: Boolean(apiKey),
    model,
    baseUrl: null as string | null,
    missing: apiKey ? [] : (["ANTHROPIC_API_KEY"] as string[]),
  };
}

export type { OllamaHealth } from "./ollama-health";
export { checkOllamaHealth } from "./ollama-health";

function buildSystemPrompt(templates: ReplyTemplate[]): string {
  const catalog = templates.map((t) => ({
    id: t.id,
    label: t.label,
    intent: t.intent,
    when_to_use: t.when_to_use,
    slots: t.slots,
  }));

  return [
    "You are a WhatsApp reply router for a small business inbox.",
    "Given an inbound customer message (possibly a voice transcription), choose exactly one reply template from the catalog and fill its slots.",
    "Prefer Italian for slot values when the inbound text is Italian.",
    "Respond with ONLY compact JSON (no markdown fences) matching:",
    '{"template_id":"<id>","slots":{"name":"value"},"rationale":"<short>","intent_summary":"<short>"}',
    "Rules:",
    "- template_id MUST be one of the catalog ids.",
    "- Include every slot the chosen template declares; use empty string if unknown.",
    "- Do not invent facts beyond the inbound text.",
    "- If unsure, use template_id generic_ack with empty slots.",
    "",
    "Catalog:",
    JSON.stringify(catalog),
  ].join("\n");
}

function extractJsonObject(text: string, label: string): ModelChoice {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as ModelChoice;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as ModelChoice;
    }
    throw new Error(`${label} did not return valid JSON for template choice`);
  }
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const cause = (err as Error & { cause?: { code?: string; message?: string } })
    .cause;
  const code = cause?.code?.toLowerCase() || "";
  return (
    code === "econnrefused" ||
    code === "enotfound" ||
    code === "econnreset" ||
    code === "etimedout" ||
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("network")
  );
}

async function callClaude(params: {
  apiKey: string;
  model: string;
  system: string;
  userText: string;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: 512,
        temperature: 0,
        system: params.system,
        messages: [
          {
            role: "user",
            content: `Inbound WhatsApp message to classify:\n"""\n${params.userText}\n"""`,
          },
        ],
      }),
      cache: "no-store",
    });
  } catch (err) {
    if (isConnectionError(err)) {
      throw new Error(
        "Cannot reach Anthropic API — check network connectivity",
      );
    }
    throw err;
  }

  const raw = await response.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    /* keep text */
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body &&
      "error" in body &&
      typeof (body as { error?: { message?: string } }).error?.message ===
        "string"
        ? (body as { error: { message: string } }).error.message
        : `Anthropic API HTTP ${response.status}`;
    throw new Error(message);
  }

  const content = (body as { content?: Array<{ type?: string; text?: string }> })
    .content;
  const textBlock = content?.find((c) => c.type === "text" && c.text);
  if (!textBlock?.text) {
    throw new Error("Anthropic response had no text content");
  }
  return textBlock.text;
}

/**
 * Ollama local chat API (`/api/chat`, non-streaming, JSON format).
 * https://github.com/ollama/ollama/blob/main/docs/api.md
 */
async function callOllama(params: {
  baseUrl: string;
  model: string;
  system: string;
  userText: string;
}): Promise<string> {
  const url = `${params.baseUrl}/api/chat`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: params.model,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [
          { role: "system", content: params.system },
          {
            role: "user",
            content: `Inbound WhatsApp message to classify:\n"""\n${params.userText}\n"""`,
          },
        ],
      }),
      cache: "no-store",
    });
  } catch (err) {
    if (isConnectionError(err)) {
      throw new Error(
        `Ollama unreachable at ${params.baseUrl} — start Ollama (ollama serve), pull the model (ollama pull ${params.model}), and keep Next.js on the same machine. Check OLLAMA_BASE_URL.`,
      );
    }
    throw err;
  }

  const raw = await response.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    /* keep text */
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Ollama HTTP ${response.status} at ${url}`;
    // Common: model not found
    if (
      typeof message === "string" &&
      message.toLowerCase().includes("not found")
    ) {
      throw new Error(
        `${message} — run: ollama pull ${params.model}`,
      );
    }
    throw new Error(message);
  }

  const messageContent = (
    body as { message?: { content?: string } }
  ).message?.content;
  if (!messageContent?.trim()) {
    throw new Error("Ollama response had no message content");
  }
  return messageContent;
}

function renderChoice(
  choice: ModelChoice,
  inboundText: string,
  model: string,
  provider: ReplyProvider,
): SuggestReplyResult {
  const templateId = choice.template_id?.trim() || "generic_ack";
  const template =
    getReplyTemplate(templateId) || getReplyTemplate("generic_ack");
  if (!template) {
    throw new Error(`Unknown template_id from model: ${templateId}`);
  }

  const slots: Record<string, string> = {};
  for (const slot of template.slots) {
    const value = choice.slots?.[slot.name];
    slots[slot.name] = typeof value === "string" ? value.trim() : "";
  }

  if (
    template.id === "food_ingredients_meal" &&
    !slots.ingredients &&
    inboundText.length > 0
  ) {
    slots.ingredients = inboundText
      .split(/[\n,;•\-]+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .join(", ");
  }

  return {
    draft: renderTemplate(template, slots).trim(),
    templateId: template.id,
    templateLabel: template.label,
    slots,
    rationale: choice.rationale?.trim() || "",
    intentSummary: choice.intent_summary?.trim() || "",
    model,
    provider,
  };
}

export type SuggestReplyOptions = {
  /** Contact key for local SQLite memory (phone E.164 or conversation id). */
  contactKey?: string | null;
  conversationId?: string | null;
};

/**
 * Classify inbound text with Claude or local Ollama and render a reply template.
 * When `contactKey` is set, LangChain/SQLite memory facts + snippets are injected.
 */
export async function suggestReplyFromText(
  inboundText: string,
  options: SuggestReplyOptions = {},
): Promise<SuggestReplyResult> {
  const text = inboundText.trim();
  if (!text) {
    throw new Error("Empty text — select a message or paste content first");
  }

  const templates = listReplyTemplates();
  if (templates.length === 0) {
    throw new Error("No reply templates configured in config/reply-templates.json");
  }

  const contactKey = options.contactKey?.trim() || "";
  let memoryBlock = "";
  if (contactKey) {
    // Import store only — avoid barrel pull of optional LangChain history.
    const { buildMemoryPromptBlock, appendMessage } = await import(
      "@/lib/memory/store"
    );
    memoryBlock = buildMemoryPromptBlock(contactKey);
    // Persist the inbound text we're classifying as a human snippet.
    try {
      appendMessage({
        contactKey,
        conversationId: options.conversationId,
        role: "human",
        content: text,
      });
    } catch {
      /* memory write-back is best-effort */
    }
  }

  const provider = getReplyProvider();
  const system = [
    buildSystemPrompt(templates),
    memoryBlock
      ? `\nUse this contact memory when filling slots (do not invent beyond it + inbound text):\n${memoryBlock}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (provider === "ollama") {
    const { baseUrl, model } = getOllamaConfig();
    const rawChoice = await callOllama({
      baseUrl,
      model,
      system,
      userText: text,
    });
    const choice = extractJsonObject(rawChoice, "Ollama");
    return renderChoice(choice, text, model, "ollama");
  }

  const { apiKey, model } = getClaudeConfig();
  if (!apiKey) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY — set it in .env.local, or set REPLY_PROVIDER=ollama for local Ollama",
    );
  }

  const rawChoice = await callClaude({
    apiKey,
    model,
    system,
    userText: text,
  });
  const choice = extractJsonObject(rawChoice, "Claude");
  return renderChoice(choice, text, model, "claude");
}

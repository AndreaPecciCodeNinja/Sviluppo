import {
  getReplyTemplate,
  listReplyTemplates,
  renderTemplate,
  type ReplyTemplate,
} from "./reply-templates";

export type SuggestReplyResult = {
  draft: string;
  templateId: string;
  templateLabel: string;
  slots: Record<string, string>;
  rationale: string;
  model: string;
  intentSummary: string;
};

type ClaudeChoice = {
  template_id?: string;
  slots?: Record<string, string>;
  rationale?: string;
  intent_summary?: string;
};

export function getClaudeConfig() {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || "",
    // Fast routing model (alias → claude-haiku-4-5-20251001). Override with ANTHROPIC_MODEL.
    model: process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5",
  };
}

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

function extractJsonObject(text: string): ClaudeChoice {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as ClaudeChoice;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as ClaudeChoice;
    }
    throw new Error("Claude did not return valid JSON for template choice");
  }
}

async function callClaude(params: {
  apiKey: string;
  model: string;
  system: string;
  userText: string;
}): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
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
 * Classify inbound text with Claude and render a preconfigured reply template.
 */
export async function suggestReplyFromText(
  inboundText: string,
): Promise<SuggestReplyResult> {
  const text = inboundText.trim();
  if (!text) {
    throw new Error("Empty text — select a message or paste content first");
  }

  const { apiKey, model } = getClaudeConfig();
  if (!apiKey) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY — set it in .env.local for the Claude reply agent",
    );
  }

  const templates = listReplyTemplates();
  if (templates.length === 0) {
    throw new Error("No reply templates configured in config/reply-templates.json");
  }

  const rawChoice = await callClaude({
    apiKey,
    model,
    system: buildSystemPrompt(templates),
    userText: text,
  });
  const choice = extractJsonObject(rawChoice);

  const templateId = choice.template_id?.trim() || "generic_ack";
  const template =
    getReplyTemplate(templateId) || getReplyTemplate("generic_ack");
  if (!template) {
    throw new Error(`Unknown template_id from Claude: ${templateId}`);
  }

  const slots: Record<string, string> = {};
  for (const slot of template.slots) {
    const value = choice.slots?.[slot.name];
    slots[slot.name] = typeof value === "string" ? value.trim() : "";
  }

  // Defensive: if food template but ingredients empty, try a naive comma join of lines.
  if (
    template.id === "food_ingredients_meal" &&
    !slots.ingredients &&
    text.length > 0
  ) {
    slots.ingredients = text
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
  };
}

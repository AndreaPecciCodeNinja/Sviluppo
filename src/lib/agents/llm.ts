import {
  getClaudeConfig,
  getOllamaConfig,
  getReplyProvider,
  type ReplyProvider,
} from "../reply-provider";

export function extractJsonObject<T>(
  text: string,
  label: string,
  detail = "valid JSON",
): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
    throw new Error(`${label} did not return ${detail}`);
  }
}

const LLM_TIMEOUT_MS = 20_000;

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name.toLowerCase();
  return (
    name === "timeouterror" ||
    name === "aborterror" ||
    /timeout|timed out|aborted/i.test(err.message)
  );
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
  userContent: string;
  maxTokens?: number;
  schema?: Record<string, unknown>;
}): Promise<string> {
  const payload: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens ?? 512,
    system: params.system,
    messages: [{ role: "user", content: params.userContent }],
  };
  if (params.schema) {
    payload.output_config = {
      format: { type: "json_schema", schema: params.schema },
    };
  }
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": params.schema ? "2026-10-21" : "2023-06-01",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(
        "Anthropic non risponde in tempo (20s). Riprova con Suggerisci.",
      );
    }
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
  userContent: string;
  /** `text` leaves the reply as written. An object is a JSON schema. */
  format?: "json" | "text" | Record<string, unknown>;
  temperature?: number;
}): Promise<string> {
  const url = `${params.baseUrl}/api/chat`;
  const payload: Record<string, unknown> = {
    model: params.model,
    stream: false,
    options: { temperature: params.temperature ?? 0 },
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.userContent },
    ],
  };
  if (params.format && typeof params.format === "object") {
    payload.format = params.format;
  } else if (params.format !== "text") {
    payload.format = "json";
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(
        `Ollama non risponde in tempo (20s) su ${params.baseUrl}. Controlla che sia avviato, poi riprova con Suggerisci.`,
      );
    }
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
    if (
      typeof message === "string" &&
      message.toLowerCase().includes("not found")
    ) {
      throw new Error(`${message} — run: ollama pull ${params.model}`);
    }
    throw new Error(message);
  }

  const messageContent = (body as { message?: { content?: string } }).message
    ?.content;
  if (!messageContent?.trim()) {
    throw new Error("Ollama response had no message content");
  }
  return messageContent;
}

/** Always Ollama, even when the reply provider is Claude. */
export async function completeWithOllama(params: {
  system: string;
  userText: string;
  /** When false, Ollama returns the menu as text, not a JSON object. */
  json?: boolean;
  /** JSON schema sent as Ollama `format`. */
  schema?: Record<string, unknown>;
  temperature?: number;
}): Promise<{ raw: string; model: string; baseUrl: string }> {
  const { baseUrl, model } = getOllamaConfig();
  const raw = await callOllama({
    baseUrl,
    model,
    system: params.system,
    userContent: params.userText,
    format: params.schema ?? (params.json === false ? "text" : "json"),
    temperature: params.temperature,
  });
  return { raw, model, baseUrl };
}

/** Chef menu. Larger Claude model, JSON schema. Never prints the API key. */
export async function completeWithClaude(params: {
  system: string;
  userText: string;
  schema?: Record<string, unknown>;
}): Promise<{ raw: string; model: string }> {
  const { apiKey } = getClaudeConfig();
  if (!apiKey) {
    throw new Error("Manca ANTHROPIC_API_KEY nell'ambiente.");
  }
  const model = process.env.ANTHROPIC_CHEF_MODEL?.trim() || "claude-opus-5-5";
  const raw = await callClaude({
    apiKey,
    model,
    system: params.system,
    userContent: params.userText,
    maxTokens: params.schema ? 2048 : 1024,
    schema: params.schema,
  });
  return { raw, model };
}

export async function completeWithReplyProvider(params: {
  system: string;
  userText: string;
  /** Sentence before the quoted inbound text. */
  leadIn?: string;
}): Promise<{ raw: string; model: string; provider: ReplyProvider }> {
  const leadIn = params.leadIn ?? "Inbound WhatsApp message to classify:";
  const userContent = `${leadIn}\n"""\n${params.userText}\n"""`;
  const provider = getReplyProvider();

  if (provider === "ollama") {
    const { baseUrl, model } = getOllamaConfig();
    const raw = await callOllama({
      baseUrl,
      model,
      system: params.system,
      userContent,
    });
    return { raw, model, provider };
  }

  const { apiKey, model } = getClaudeConfig();
  if (!apiKey) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY — set it in .env.local, or set REPLY_PROVIDER=ollama for local Ollama",
    );
  }
  const raw = await callClaude({
    apiKey,
    model,
    system: params.system,
    userContent,
  });
  return { raw, model, provider };
}

export type ReplyProvider = "claude" | "ollama" | "openai";

export function getReplyProvider(): ReplyProvider {
  // Default ollama for local Mac/dev.
  const raw = (process.env.REPLY_PROVIDER || "ollama").trim().toLowerCase();
  if (raw === "claude") return "claude";
  if (raw === "openai") return "openai";
  return "ollama";
}

export function replyProviderLabel(provider: ReplyProvider): string {
  if (provider === "ollama") return "Ollama";
  if (provider === "openai") return "OpenAI";
  return "Claude";
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

export function getOpenAIReplyConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() || "",
    model: process.env.OPENAI_REPLY_MODEL?.trim() || "gpt-4o-mini",
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
  if (provider === "openai") {
    const { apiKey, model } = getOpenAIReplyConfig();
    return {
      provider,
      configured: Boolean(apiKey),
      model,
      baseUrl: null as string | null,
      missing: apiKey ? [] : (["OPENAI_API_KEY"] as string[]),
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

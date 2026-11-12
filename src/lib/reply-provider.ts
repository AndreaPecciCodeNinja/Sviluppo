export type ReplyProvider = "claude" | "ollama";

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

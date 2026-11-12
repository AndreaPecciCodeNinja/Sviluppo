import { getOllamaConfig, getReplyProvider, type ReplyProvider } from "./reply-provider";

export type { ReplyProvider };

export type OllamaHealth = {
  provider: ReplyProvider;
  /** True when REPLY_PROVIDER=ollama (reply agent will use Ollama). */
  active: boolean;
  reachable: boolean;
  model: string;
  baseUrl: string;
  modelPresent: boolean;
  availableModels: string[];
  /** Reachable and configured model is installed. */
  ok: boolean;
  message: string;
};

function modelMatches(requested: string, installedName: string): boolean {
  if (installedName === requested) return true;
  return (
    installedName.startsWith(`${requested}-`) ||
    installedName.startsWith(`${requested}:`)
  );
}

/**
 * Lightweight Ollama probe (GET /api/tags). Standalone — no memory/LangChain
 * imports — so /api/ollama/health stays buildable even if LangChain is missing.
 */
export async function checkOllamaHealth(): Promise<OllamaHealth> {
  const provider = getReplyProvider();
  const { baseUrl, model } = getOllamaConfig();
  const active = provider === "ollama";

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      return {
        provider,
        active,
        reachable: false,
        model,
        baseUrl,
        modelPresent: false,
        availableModels: [],
        ok: false,
        message: `Ollama non raggiungibile (HTTP ${response.status}) su ${baseUrl}`,
      };
    }
    const body = (await response.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    const availableModels = (body.models || [])
      .map((m) => m.name || m.model || "")
      .filter(Boolean);
    const modelPresent = availableModels.some((name) =>
      modelMatches(model, name),
    );
    if (!modelPresent) {
      return {
        provider,
        active,
        reachable: true,
        model,
        baseUrl,
        modelPresent: false,
        availableModels,
        ok: false,
        message: `Ollama raggiungibile, ma manca «${model}» — esegui: ollama pull ${model}`,
      };
    }
    return {
      provider,
      active,
      reachable: true,
      model,
      baseUrl,
      modelPresent: true,
      availableModels,
      ok: true,
      message: `Ollama disponibile · ${model}`,
    };
  } catch {
    return {
      provider,
      active,
      reachable: false,
      model,
      baseUrl,
      modelPresent: false,
      availableModels: [],
      ok: false,
      message: `Ollama non raggiungibile su ${baseUrl} — avvia l'app Ollama su Mac / controlla OLLAMA_BASE_URL`,
    };
  }
}

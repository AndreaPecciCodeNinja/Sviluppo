import { chiamaClaude } from "./claude.mjs";
import { cercaNelVault, eTestoStorico } from "./search.mjs";

export function elencoTitoli(notes) {
  return notes.map((note) => `- ${note.title} (${note.rel})`).join("\n");
}

/**
 * Agente specializzato: cerca la ricetta nel vault e, se c'è la chiave,
 * la fa raccontare a Claude usando solo quelle note.
 */
export async function rispondi({ vaultPath, query, env = process.env, fetchImpl }) {
  const richiesta = String(query ?? "").trim();
  if (!richiesta) {
    return {
      ok: false,
      kind: "vuota",
      notes: [],
      text: "Scrivi il nome del piatto. Esempio: npm run ricetta -- \"cacio e pepe\"",
    };
  }

  let notes;
  try {
    notes = await cercaNelVault(vaultPath, richiesta);
  } catch (error) {
    if (error?.code === "VAULT_ASSENTE") {
      return { ok: false, kind: "vault", notes: [], text: error.message };
    }
    throw error;
  }

  if (notes.length === 0) {
    return {
      ok: false,
      kind: "assente",
      notes: [],
      text: `Nel vault non c'è una ricetta per «${richiesta}».`,
    };
  }

  const pronte = notes.map((note) => ({ ...note, storica: eTestoStorico(note.rel) }));
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return {
      ok: true,
      kind: "senza-chiave",
      notes: pronte,
      text: [
        "Claude non è configurato: manca ANTHROPIC_API_KEY.",
        "Note trovate nel vault:",
        elencoTitoli(pronte),
      ].join("\n"),
    };
  }

  const reply = await chiamaClaude({
    apiKey,
    model: env.ANTHROPIC_MODEL,
    query: richiesta,
    notes: pronte,
    fetchImpl,
  });
  return {
    ok: true,
    kind: "risposta",
    notes: pronte,
    text: ["Note usate:", elencoTitoli(pronte), "", reply].join("\n"),
  };
}

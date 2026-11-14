export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

export const RUOLO = [
  "Sei l'agente ricette della cucina italiana.",
  "Rispondi in italiano.",
  "Usa soltanto le note del vault allegate al messaggio.",
  "Non aggiungere ingredienti, dosi o passaggi che non compaiono in quelle note.",
  "Cita il titolo di ogni nota che usi.",
  "Se una nota è un testo storico, dillo in apertura.",
  "Se le note non contengono la ricetta chiesta, dillo e non improvvisare.",
].join(" ");

const MAX_NOTA = 14_000;

export function messaggioUtente(query, notes) {
  const blocchi = notes.map((note, index) => {
    const testo = note.text.length > MAX_NOTA
      ? `${note.text.slice(0, MAX_NOTA)}\n\n[nota troncata]`
      : note.text;
    const fonte = note.storica ? "testo storico del vault" : "nota del vault";
    return [
      `Nota ${index + 1}`,
      `Percorso: ${note.rel}`,
      `Titolo: ${note.title}`,
      `Tipo: ${fonte}`,
      testo,
    ].join("\n");
  });
  return [`Richiesta: ${query}`, "", ...blocchi].join("\n");
}

export function richiestaClaude({ apiKey, model, query, notes }) {
  return {
    url: ANTHROPIC_MESSAGES_URL,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 1200,
        temperature: 0,
        system: RUOLO,
        messages: [{ role: "user", content: messaggioUtente(query, notes) }],
      }),
    },
  };
}

export function testoRisposta(payload) {
  const parts = Array.isArray(payload?.content) ? payload.content : [];
  const text = parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) {
    throw new Error("Claude non ha restituito testo.");
  }
  return text;
}

export async function chiamaClaude({ apiKey, model, query, notes, fetchImpl = fetch }) {
  const { url, init } = richiestaClaude({ apiKey, model, query, notes });
  const response = await fetchImpl(url, init);
  const raw = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Claude ha risposto con un errore: ${detail}`);
  }
  return testoRisposta(payload);
}

import { chiamaClaude } from "./claude.mjs";
import { bloccoImpostazioni } from "./impostazioni.mjs";
import { estraiAlimenti } from "./menu.mjs";

export const RUOLO_DIALOGO = [
  "Sei un assistente vocale specializzato nella composizione di menù della cucina italiana.",
  "Parli in italiano, con frasi brevi da leggere ad alta voce.",
  "L'utente non ha ancora una lista definitiva di alimenti.",
  "Chiedi che cosa ha per pranzo, per cena e per gli altri pasti, per esempio colazione, spuntino e merenda.",
  "Non inventare piatti e non citare ricette: il menù si compone dopo, solo con le note del vault.",
  "Rispondi soltanto con JSON, senza testo intorno:",
  '{"stato":"domanda","testo":"frase da dire","alimenti":""}',
  "oppure, solo quando l'utente ha confermato che la lista è chiusa,",
  '{"stato":"definitivo","testo":"frase da dire","alimenti":"alimenti separati da virgole"}.',
].join(" ");

export function analizzaTurno(testo) {
  const pulito = String(testo ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = pulito.indexOf("{");
  const end = pulito.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(pulito.slice(start, end + 1));
      const stato = obj.stato === "definitivo" ? "definitivo" : "domanda";
      const detto = String(obj.testo ?? "").trim();
      const alimenti = String(obj.alimenti ?? "").trim();
      if (detto) return { stato, testo: detto, alimenti };
    } catch {
      /* il testo resta una domanda parlata */
    }
  }
  return { stato: "domanda", testo: pulito, alimenti: "" };
}

function storiaValida(messaggi) {
  if (!Array.isArray(messaggi)) return [];
  return messaggi
    .filter((msg) => msg && (msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string")
    .slice(-20)
    .map((msg) => ({ role: msg.role, content: msg.content.trim().slice(0, 4000) }))
    .filter((msg) => msg.content);
}

export async function turnoDialogo({ messaggi, impostazioni, env = process.env, fetchImpl }) {
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";
  const voceMancante = "Claude non è configurato: manca ANTHROPIC_API_KEY. Non posso conversare per raccogliere gli alimenti. Scrivili nel riquadro e crea il menù.";
  if (!apiKey) {
    return {
      ok: true,
      kind: "senza-chiave",
      stato: "domanda",
      testo: voceMancante,
      alimenti: "",
      voce: voceMancante,
    };
  }

  const storia = storiaValida(messaggi);
  const messages = storia.length > 0
    ? storia
    : [{
      role: "user",
      content: "Non ho ancora detto quali alimenti ho. Chiedimi pranzo, cena e gli altri pasti.",
    }];

  const raw = await chiamaClaude({
    apiKey,
    model: env.ANTHROPIC_MODEL,
    fetchImpl,
    system: `${RUOLO_DIALOGO} ${bloccoImpostazioni(impostazioni)}`,
    messages,
    maxTokens: 700,
  });
  let turno = analizzaTurno(raw);
  if (turno.stato === "definitivo" && estraiAlimenti(turno.alimenti).length === 0) {
    turno = {
      stato: "domanda",
      testo: turno.testo || "Dimmi gli alimenti e conferma quando la lista è chiusa.",
      alimenti: "",
    };
  }
  return { ok: true, kind: "dialogo", ...turno, voce: turno.testo };
}

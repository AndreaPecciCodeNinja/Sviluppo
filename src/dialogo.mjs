import { chiamaClaude } from "./claude.mjs";
import { bloccoImpostazioni, normalizzaImpostazioni } from "./impostazioni.mjs";
import { estraiAlimenti } from "./menu.mjs";
import { normalizza } from "./vault.mjs";

const NON_CIBO = new Set([
  "aiutami", "aiuto", "aiutare", "preparare", "prepara", "prepararmi",
  "cena", "pranzo", "colazione", "spuntino", "merenda", "menu",
  "pasto", "pasti", "giusti", "giusto", "quelli", "questi", "sono",
  "scrivi", "scrivere", "lista", "elenco", "confermo", "conferma",
  "esatto", "bene", "ok", "vorrei", "fammi", "voglio", "cucinare",
  "fare", "qualcosa", "stasera", "oggi", "domani", "grazie", "perfetto",
  "certo", "yes",
]);

export const RUOLO_DIALOGO = [
  "Sei un assistente che compone menù della cucina italiana.",
  "In questo turno l'utente sta scrivendo, non parlando: la risposta va nel riquadro di testo.",
  "Ricorda le domande e le risposte già presenti nei messaggi e continua quella sequenza.",
  "Fai una sola domanda, con un solo punto interrogativo.",
  "Quando chiedi di scrivere, la frase deve contenere la parola «scrivi».",
  "Non inventare piatti e non citare ricette.",
  "Rispondi soltanto con JSON: {\"testo\":\"la domanda\"}.",
].join(" ");

export function èRichiesta(testo) {
  const raw = String(testo ?? "").trim();
  if (!raw || raw.includes(",")) return false;
  return /aiut|prepar|vorrei|fammi|men[uù]|\b(cena|pranzo|colazione)\b/i.test(raw);
}

export function alimentiNelTesto(testo) {
  return estraiAlimenti(testo).filter((alimento) => !alimento.split(" ").every((token) => NON_CIBO.has(token)));
}

export function èConferma(testo) {
  return /quelli giusti/i.test(String(testo ?? ""));
}

export function èAffermativa(testo) {
  const n = normalizza(testo);
  if (/\b(no|non|sbagliat|cambia|togli)\b/.test(n)) return false;
  if (alimentiNelTesto(testo).length > 0) return false;
  return /^(si|ok|yes)$/.test(n) || /\b(si|esatto|confermo|va bene|perfetto|certo|giusti)\b/.test(n);
}

export function alimentiRaccolti(messaggi) {
  const visti = new Set();
  const lista = [];
  for (const msg of storiaValida(messaggi)) {
    if (msg.role !== "user") continue;
    for (const alimento of alimentiNelTesto(msg.content)) {
      if (visti.has(alimento)) continue;
      visti.add(alimento);
      lista.push(alimento);
    }
  }
  return lista;
}

export function passoDialogo(messaggi) {
  const storia = storiaValida(messaggi);
  const alimenti = alimentiRaccolti(storia);
  const ultimoUtente = [...storia].reverse().find((msg) => msg.role === "user");
  const ultimoAssistente = [...storia].reverse().find((msg) => msg.role === "assistant");
  const inConferma = Boolean(ultimoAssistente && èConferma(ultimoAssistente.content));
  if (inConferma && ultimoUtente && èAffermativa(ultimoUtente.content) && alimenti.length >= 4) {
    return { fase: "cerca", alimenti };
  }
  if (inConferma) return { fase: "raccolta", alimenti };
  if (alimenti.length >= 4) return { fase: "conferma", alimenti };
  return { fase: "raccolta", alimenti };
}

export function domandaConferma(alimenti, nome) {
  return `${nome}, agente AI. Scrivi sì se questi alimenti sono quelli giusti: ${alimenti.join(", ")}?`;
}

export function assicuraDomanda(testo, fase, alimenti, nome) {
  if (fase === "conferma") {
    let frase = String(testo ?? "").trim();
    const fine = frase.indexOf("?");
    if (fine >= 0) frase = frase.slice(0, fine + 1);
    const haUna = (frase.match(/\?/g) || []).length === 1;
    const citaTutti = alimenti.every((alimento) => frase.toLowerCase().includes(alimento));
    if (haUna && /\bscrivi\b/i.test(frase) && /giusti/i.test(frase) && citaTutti) return frase;
    return domandaConferma(alimenti, nome);
  }
  let frase = String(testo ?? "").replace(/\s+/g, " ").trim();
  const fine = frase.indexOf("?");
  if (fine >= 0) frase = frase.slice(0, fine + 1);
  else if (frase) frase = `${frase.replace(/[.!]+$/, "")}?`;
  if (!frase || frase === "?") {
    frase = alimenti.length
      ? `Scrivi un altro alimento. Per ora ho: ${alimenti.join(", ")}?`
      : "Scrivi che cosa hai per questo pasto?";
  }
  if (!/\bscrivi\b/i.test(frase)) frase = `Scrivi: ${frase}`;
  return frase;
}

export function analizzaTurno(testo) {
  const pulito = String(testo ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = pulito.indexOf("{");
  const end = pulito.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(pulito.slice(start, end + 1));
      const detto = String(obj.testo ?? "").trim();
      const alimenti = String(obj.alimenti ?? "").trim();
      if (detto) return { testo: detto, alimenti };
    } catch {
      /* testo libero */
    }
  }
  return { testo: pulito, alimenti: "" };
}

function storiaValida(messaggi) {
  if (!Array.isArray(messaggi)) return [];
  return messaggi
    .filter((msg) => msg && (msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string")
    .slice(-20)
    .map((msg) => ({ role: msg.role, content: msg.content.trim().slice(0, 4000) }))
    .filter((msg) => msg.content);
}

function rispostaScritta(extra) {
  return { ok: true, kind: "dialogo", parla: false, voce: "", ...extra };
}

export async function turnoDialogo({ messaggi, impostazioni, canale = "scritto", env = process.env, fetchImpl }) {
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";
  const testoMancante = "Claude non è configurato: manca ANTHROPIC_API_KEY. Non posso fare le domande. Scrivi gli alimenti nel riquadro, almeno quattro, e crea il menù.";
  if (!apiKey) {
    return rispostaScritta({
      kind: "senza-chiave",
      stato: "domanda",
      testo: testoMancante,
      alimenti: "",
      voce: canale === "voce" ? testoMancante : "",
      parla: canale === "voce",
    });
  }

  const storia = storiaValida(messaggi);
  const { fase, alimenti } = passoDialogo(storia);
  const { nome } = normalizzaImpostazioni(impostazioni);
  if (fase === "cerca") {
    return rispostaScritta({
      stato: "definitivo",
      testo: `Elenco confermato: ${alimenti.join(", ")}.`,
      alimenti: alimenti.join(", "),
    });
  }

  const istruzione = fase === "conferma"
    ? `Chiedi una sola conferma. La frase deve contenere «scrivi» e «quelli giusti» e questi alimenti: ${alimenti.join(", ")}.`
    : `Alimenti già raccolti: ${alimenti.join(", ") || "nessuno"}. Fai la prossima domanda, una sola, e includi la parola «scrivi». Non chiedere se la lista è giusta: ci sono meno di 4 alimenti.`;
  const messages = storia.length > 0
    ? [...storia, { role: "user", content: istruzione }]
    : [{ role: "user", content: `${istruzione} L'utente non ha ancora scritto.` }];

  const raw = await chiamaClaude({
    apiKey,
    model: env.ANTHROPIC_MODEL,
    fetchImpl,
    system: `${RUOLO_DIALOGO} ${bloccoImpostazioni(impostazioni)}`,
    messages,
    maxTokens: 400,
  });
  const testo = assicuraDomanda(analizzaTurno(raw).testo, fase, alimenti, nome);
  const parlato = canale === "voce";
  return {
    ok: true,
    kind: "dialogo",
    stato: "domanda",
    testo,
    alimenti: alimenti.join(", "),
    voce: parlato ? testo : "",
    parla: parlato,
  };
}

import { chiamaClaude } from "./claude.mjs";
import { elencoTitoli } from "./agent.mjs";
import { eTestoStorico } from "./search.mjs";
import { caricaNote, normalizza } from "./vault.mjs";

const STOP = new Set([
  "il", "lo", "la", "i", "gli", "le", "un", "uno", "una",
  "di", "a", "da", "in", "con", "su", "per", "tra", "fra",
  "e", "ed", "o", "che", "non", "ho", "hai",
  "del", "dello", "della", "dei", "degli", "delle",
  "al", "allo", "alla",
  "poco", "po", "q", "b",
]);

const SEZIONE = [
  ["ricette/", 50],
  ["wikibooks/", 20],
  ["artusi/", 8],
  ["storici/", 8],
  ["ingredienti/", 4],
];

export const RUOLO_MENU = [
  "Sei l'agente menù della cucina italiana.",
  "Rispondi in italiano.",
  "Componi un menù con gli alimenti indicati usando soltanto le note allegate.",
  "Ogni piatto deve corrispondere a una nota di ricetta e va citato con il suo titolo.",
  "Non aggiungere ingredienti, dosi o piatti che non compaiono nelle note.",
  "Se un alimento non è usato da nessuna nota, dillo.",
  "Se non puoi coprire una portata, non inventarla.",
  "Le note in ingredienti/ sono schede dell'alimento, non piatti.",
  "Se una nota è un testo storico, dillo.",
].join(" ");

function bonusSezione(rel) {
  return SEZIONE.find(([prefix]) => rel.startsWith(prefix))?.[1] ?? 0;
}

function eScheda(rel) {
  return rel.startsWith("ingredienti/");
}

function ePiatto(rel) {
  return /^(ricette|wikibooks|artusi|storici)\//.test(rel);
}

export function estraiAlimenti(text) {
  const visti = new Set();
  const alimenti = [];
  for (const pezzo of String(text ?? "").split(/[,;\n]|\s+e\s+/i)) {
    const tokens = normalizza(pezzo)
      .split(" ")
      .filter((token) => token.length >= 3 && !STOP.has(token));
    if (tokens.length === 0) continue;
    const phrase = tokens.join(" ");
    if (visti.has(phrase)) continue;
    visti.add(phrase);
    alimenti.push(phrase);
  }
  return alimenti;
}

function contiene(hay, phrase) {
  return ` ${hay} `.includes(` ${phrase} `);
}

function testoNota(note) {
  return normalizza(
    `${note.title} ${note.frontmatter.ingredienti_principali ?? ""} ${note.body}`,
  );
}

export function cercaPiatti(notes, alimenti) {
  const piatti = [];
  const schede = [];
  for (const note of notes) {
    if (!ePiatto(note.rel) && !eScheda(note.rel)) continue;
    const hay = testoNota(note);
    const principali = normalizza(note.frontmatter.ingredienti_principali ?? "");
    const hits = alimenti.filter((alimento) => contiene(hay, alimento));
    if (hits.length === 0) continue;
    const inPrincipali = alimenti.filter((alimento) => contiene(principali, alimento)).length;
    const score = hits.length * 20 + inPrincipali * 15 + bonusSezione(note.rel);
    const voce = { note, score, scheda: eScheda(note.rel) };
    if (voce.scheda) schede.push(voce);
    else piatti.push(voce);
  }
  const ordina = (a, b) => b.score - a.score || a.note.rel.localeCompare(b.note.rel, "it");
  piatti.sort(ordina);
  schede.sort(ordina);
  return [...piatti.slice(0, 6), ...schede.slice(0, 2)].map((voce) => voce.note);
}

function messaggioMenu(alimenti, notes) {
  const blocchi = notes.map((note, index) => {
    const testo = note.text.length > 14_000
      ? `${note.text.slice(0, 14_000)}\n\n[nota troncata]`
      : note.text;
    let tipo = "ricetta del vault";
    if (note.scheda) tipo = "scheda ingrediente, non è un piatto";
    else if (note.storica) tipo = "testo storico del vault";
    return [`Nota ${index + 1}`, `Percorso: ${note.rel}`, `Titolo: ${note.title}`, `Tipo: ${tipo}`, testo].join("\n");
  });
  return [`Alimenti disponibili: ${alimenti.join(", ")}`, "", ...blocchi].join("\n");
}

export async function componiMenu({ vaultPath, alimenti, env = process.env, fetchImpl, notes }) {
  const lista = estraiAlimenti(alimenti);
  if (lista.length === 0) {
    return {
      ok: false,
      kind: "vuota",
      notes: [],
      text: "Scrivi gli alimenti che hai, separati da virgole.",
    };
  }

  let tutte = notes;
  if (!tutte) {
    try {
      tutte = await caricaNote(vaultPath);
    } catch (error) {
      if (error?.code === "VAULT_ASSENTE") {
        return { ok: false, kind: "vault", notes: [], text: error.message };
      }
      throw error;
    }
  }

  const trovate = cercaPiatti(tutte, lista).map((note) => ({
    ...note,
    storica: eTestoStorico(note.rel),
    scheda: eScheda(note.rel),
  }));
  if (trovate.length === 0) {
    return {
      ok: false,
      kind: "assente",
      notes: [],
      text: `Nel vault non ci sono piatti per questi alimenti: ${lista.join(", ")}.`,
    };
  }

  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return {
      ok: true,
      kind: "senza-chiave",
      notes: trovate,
      text: [
        "Claude non è configurato: manca ANTHROPIC_API_KEY.",
        "Note trovate nel vault per questi alimenti:",
        elencoTitoli(trovate),
      ].join("\n"),
    };
  }

  const reply = await chiamaClaude({
    apiKey,
    model: env.ANTHROPIC_MODEL,
    notes: trovate,
    fetchImpl,
    system: RUOLO_MENU,
    contenuto: messaggioMenu(lista, trovate),
    maxTokens: 1600,
  });
  return {
    ok: true,
    kind: "risposta",
    notes: trovate,
    text: ["Note usate:", elencoTitoli(trovate), "", reply].join("\n"),
  };
}

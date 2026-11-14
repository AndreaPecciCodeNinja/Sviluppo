import path from "node:path";
import { caricaNote, normalizza } from "./vault.mjs";

const STOP = new Set([
  "il", "lo", "la", "i", "gli", "le", "un", "uno", "una",
  "di", "a", "da", "in", "con", "su", "per", "tra", "fra",
  "e", "ed", "o", "che", "non", "mi", "ti", "si", "ci",
  "del", "dello", "della", "dei", "degli", "delle",
  "al", "allo", "alla", "ai", "agli", "alle",
  "dal", "dallo", "dalla", "dai", "dagli", "dalle",
  "nel", "nello", "nella", "nei", "negli", "nelle",
  "come", "fa", "fare", "fai", "vorrei", "voglio", "vuoi",
  "ricetta", "ricette", "piatto", "fammi", "favore", "grazie",
  "cucinare", "cucina", "italiana", "italiano",
]);

const SEZIONE = [
  ["ricette/", 50],
  ["wikibooks/", 20],
  ["artusi/", 8],
  ["storici/", 8],
];

export function tokenRichiesta(query) {
  return normalizza(query)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP.has(token));
}

function bonusSezione(rel) {
  return SEZIONE.find(([prefix]) => rel.startsWith(prefix))?.[1] ?? 0;
}

export function eTestoStorico(rel) {
  return rel.startsWith("artusi/") || rel.startsWith("storici/");
}

function bagaglio(note) {
  const file = path.basename(note.rel, ".md");
  return normalizza(
    `${note.title} ${file} ${note.frontmatter.ingredienti_principali ?? ""}`,
  );
}

export function cercaNote(notes, query) {
  const queryNorm = normalizza(query);
  const tokens = tokenRichiesta(query);
  if (!queryNorm) return [];

  const ranked = [];
  for (const note of notes) {
    const title = normalizza(note.title);
    const file = normalizza(path.basename(note.rel, ".md"));
    const bag = bagaglio(note);
    const exact = title === queryNorm || file === queryNorm;
    const phrase =
      queryNorm.length >= 4 &&
      (title.includes(queryNorm) || file.includes(queryNorm));
    const tokensOk = tokens.length > 0 && tokens.every((token) => bag.includes(token));
    if (!exact && !phrase && !tokensOk) continue;

    let score = bonusSezione(note.rel);
    if (title === queryNorm) score += 100;
    if (file === queryNorm) score += 40;
    if (phrase) score += 30;
    score += tokens.filter((token) => title.includes(token) || file.includes(token)).length * 10;
    ranked.push({ note, score });
  }

  ranked.sort((a, b) => b.score - a.score || a.note.rel.localeCompare(b.note.rel));
  if (ranked.length === 0) return [];
  const best = ranked[0].score;
  return ranked
    .filter((item, index) => index === 0 || best - item.score < 20)
    .slice(0, 2)
    .map((item) => item.note);
}

export async function cercaNelVault(vaultPath, query) {
  return cercaNote(await caricaNote(vaultPath), query);
}

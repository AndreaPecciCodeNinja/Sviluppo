import { completeWithClaude, completeWithOllama, extractJsonObject } from "./llm";
import {
  bareMealChoice,
  chosenMeal,
  ingredientsFromThread,
  isBareAffirmation,
  isMealAcceptanceQuestion,
  joinItalian,
  type MealName,
} from "./meal-choice";
import { provaFiammettaReply } from "./prova-reply";
import { withFiammettaIntro } from "./fiammetta";

/**
 * What the person supplies on the manual bench.
 * `question` is the line they just wrote. `prior` is the earlier lines,
 * person and agent, in order.
 *
 * When WhatsApp is connected later, an inbound message fills these same
 * two fields and calls `answerCustomer`. That connection is not here:
 * nothing in this module reads Bird or sends a message.
 */
export type CustomerTurn = {
  question: string;
  prior: readonly string[];
};

const COURSES = ["antipasto", "primo", "secondo", "contorno", "dolce"] as const;

const PANTRY = ["sale", "pepe", "olio", "acqua"];

const CHEF_PROMPT = [
  "Sei uno chef domestico: la persona chiede cosa cucinare con quello che ha.",
  "Usa SOLO gli alimenti dati, più sale, pepe, olio e acqua.",
  "Portate, in quest'ordine: antipasto, primo, secondo, contorno, dolce.",
  "Se manca una portata, piatto è null e note spiega perché. preparazione è vuota.",
  "Lo stesso alimento principale sta in al massimo due portate.",
  "Nei campi ingredienti, alimento_principale, alimenti_non_usati e nel testo del piatto copia i nomi esattamente come negli alimenti dati. Non cambiare le lettere.",
  "preparazione spiega in italiano come si cucina il piatto.",
  "Rispetta i vincoli.",
  "Non dedurre allergeni. Non scrivere avvertenze sugli allergeni.",
  "Output solo JSON: menu, alimenti_non_usati, note.",
  "Non fare domande.",
].join("\n");

const MENU_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["menu", "alimenti_non_usati", "note"],
  properties: {
    menu: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["portata", "piatto", "ingredienti", "alimento_principale", "preparazione", "note"],
        properties: {
          portata: { type: "string", enum: [...COURSES] },
          piatto: { type: ["string", "null"] },
          ingredienti: { type: "array", items: { type: "string" } },
          alimento_principale: { type: ["string", "null"] },
          preparazione: { type: "string" },
          note: { type: "string" },
        },
      },
    },
    alimenti_non_usati: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
};

type Course = {
  portata: string;
  piatto: string | null;
  ingredienti: string[];
  alimento_principale: string | null;
  preparazione: string;
  note: string;
};

type ChefMenu = {
  menu: Course[];
  alimenti_non_usati: string[];
  note: string;
};

const FOLLOW_PROMPT = [
  "Conosci già le risposte della persona. Non chiederle di nuovo.",
  "Non chiedere gli ingredienti. Non chiedere se è il pranzo o la cena.",
  "Usa solo gli alimenti scritti dalla persona, più sale, pepe, olio e acqua.",
  "Non dedurre allergeni.",
  "Rispondi in italiano alla nuova frase, con quel pasto e quegli alimenti.",
  "Non scrivere JSON.",
].join("\n");

function mealPhrase(question: string): "la cena" | "il pranzo" {
  return /per la cena|cena/iu.test(question) ? "la cena" : "il pranzo";
}

function wantsTheMenu(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[!?.…,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /(?:fammi|preparami|prepara|scrivi|voglio)\s+il\s+men[uù](?![\p{L}\p{N}])/iu.test(
    normalized,
  );
}

function ollamaError(err: unknown): string {
  const message = err instanceof Error ? err.message : "errore sconosciuto";
  return `Ollama non ha scritto il menù. ${message}`;
}

function claudeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "errore sconosciuto";
  return `Claude non ha scritto il menù. ${message}`;
}

function canonicalFood(item: string, allowed: readonly string[]): string | null {
  const value = item.trim().toLocaleLowerCase("it");
  if (!value) return null;
  return allowed.find((food) => food.toLocaleLowerCase("it") === value) ?? null;
}

function editDistance(left: string, right: string): number {
  const a = left.toLocaleLowerCase("it");
  const b = right.toLocaleLowerCase("it");
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] =
        a[i - 1] === b[j - 1]
          ? previous
          : Math.min(previous, row[j], row[j - 1]) + 1;
      previous = current;
    }
  }
  return row[b.length];
}

function nameMiss(token: string, allowed: readonly string[]): string | null {
  const value = token.trim();
  if (value.length < 4 || canonicalFood(value, allowed)) return null;
  let closest: string | null = null;
  let best = 3;
  for (const food of allowed) {
    if (food.length < 4) continue;
    const distance = editDistance(value, food);
    if (distance < best) {
      best = distance;
      closest = food;
    }
  }
  return closest;
}

function mismatchedNames(text: string, allowed: readonly string[]): string[] {
  const tokens = text.match(/[\p{L}][\p{L}'’]*/gu) ?? [];
  const problems: string[] = [];
  for (const token of tokens) {
    const expected = nameMiss(token, allowed);
    if (expected) problems.push(`Il nome «${token}» non combacia con «${expected}».`);
  }
  return problems;
}

function asCourse(value: unknown): Course | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const portata = typeof row.portata === "string" ? row.portata.trim() : "";
  const piatto =
    row.piatto === null
      ? null
      : typeof row.piatto === "string"
        ? row.piatto.trim() || null
        : null;
  const ingredienti = Array.isArray(row.ingredienti)
    ? row.ingredienti.filter((item): item is string => typeof item === "string")
    : [];
  const alimento =
    row.alimento_principale === null
      ? null
      : typeof row.alimento_principale === "string"
        ? row.alimento_principale.trim() || null
        : null;
  const note = typeof row.note === "string" ? row.note.trim() : "";
  const preparazione = typeof row.preparazione === "string" ? row.preparazione.trim() : "";
  return {
    portata,
    piatto,
    ingredienti,
    alimento_principale: alimento,
    preparazione,
    note,
  };
}

function readMenu(raw: string): ChefMenu | string {
  let parsed: { menu?: unknown; alimenti_non_usati?: unknown; note?: unknown };
  try {
    parsed = extractJsonObject(raw, "Ollama");
  } catch (err) {
    return err instanceof Error ? err.message : "JSON non valido";
  }
  const menu = Array.isArray(parsed.menu)
    ? parsed.menu.map(asCourse).filter((row): row is Course => row !== null)
    : [];
  const unused = Array.isArray(parsed.alimenti_non_usati)
    ? parsed.alimenti_non_usati.filter((item): item is string => typeof item === "string")
    : [];
  return {
    menu,
    alimenti_non_usati: unused,
    note: typeof parsed.note === "string" ? parsed.note.trim() : "",
  };
}

function menuProblems(menu: ChefMenu, ingredients: readonly string[]): string[] {
  const allowed = [...ingredients, ...PANTRY];
  const problems: string[] = [];
  const seen = new Set<string>();
  const mains = new Map<string, number>();
  for (const course of COURSES) {
    if (!menu.menu.some((row) => row.portata.toLocaleLowerCase("it") === course)) {
      problems.push(`Manca la portata ${course}.`);
    }
  }
  for (const row of menu.menu) {
    const key = row.portata.toLocaleLowerCase("it");
    if (seen.has(key)) problems.push(`Portata ripetuta: ${row.portata}.`);
    seen.add(key);
    if (row.piatto === null && !row.note) {
      problems.push(`La portata ${row.portata} ha piatto null senza note.`);
    }
    for (const item of row.ingredienti) {
      if (!canonicalFood(item, allowed)) {
        const expected = nameMiss(item, allowed);
        problems.push(
          expected
            ? `Il nome «${item}» non combacia con «${expected}».`
            : `Ingrediente non consentito: ${item}.`,
        );
      }
    }
    if (row.alimento_principale && !canonicalFood(row.alimento_principale, allowed)) {
      const expected = nameMiss(row.alimento_principale, allowed);
      problems.push(
        expected
          ? `Il nome «${row.alimento_principale}» non combacia con «${expected}».`
          : `Ingrediente non consentito: ${row.alimento_principale}.`,
      );
    }
    if (row.piatto) problems.push(...mismatchedNames(row.piatto, allowed));
    if (row.preparazione) problems.push(...mismatchedNames(row.preparazione, allowed));
    if (row.piatto && row.alimento_principale) {
      const main = row.alimento_principale.toLocaleLowerCase("it");
      mains.set(main, (mains.get(main) ?? 0) + 1);
    }
  }
  for (const item of menu.alimenti_non_usati) {
    if (!canonicalFood(item, ingredients)) {
      const expected = nameMiss(item, ingredients);
      problems.push(
        expected
          ? `Il nome «${item}» non combacia con «${expected}».`
          : `Ingrediente non consentito: ${item}.`,
      );
    }
  }
  if (menu.note) problems.push(...mismatchedNames(menu.note, allowed));
  for (const [main, count] of mains) {
    if (count > 2) {
      problems.push(`Alimento principale «${main}» in più di due portate.`);
    }
  }
  return problems;
}

function formatMenu(menu: ChefMenu, ingredients: readonly string[]): string {
  const allowed = [...ingredients, ...PANTRY];
  const lines: string[] = [];
  for (const course of COURSES) {
    const row = menu.menu.find((item) => item.portata.toLocaleLowerCase("it") === course);
    const title = course.charAt(0).toLocaleUpperCase("it") + course.slice(1);
    if (!row || row.piatto === null) {
      const why = row?.preparazione || row?.note || "Portata non prevista.";
      lines.push(title, "Piatto: nessuno", "Ingredienti: nessuno", `Preparazione: ${why}`, "");
      continue;
    }
    const foods = row.ingredienti
      .map((item) => canonicalFood(item, allowed) ?? item.trim())
      .filter(Boolean);
    const steps = row.preparazione || row.note || "nessuna";
    lines.push(
      title,
      `Piatto: ${row.piatto}`,
      `Ingredienti: ${foods.length ? foods.join(", ") : "nessuno"}`,
      `Preparazione: ${steps}`,
      "",
    );
  }
  if (menu.alimenti_non_usati.length) {
    const unused = menu.alimenti_non_usati
      .map((item) => canonicalFood(item, ingredients) ?? item.trim())
      .filter(Boolean);
    lines.push(`Alimenti non usati: ${unused.join(", ")}`, "");
  }
  if (menu.note) lines.push(menu.note);
  return lines.join("\n").trim();
}

async function askChef(
  meal: MealName,
  ingredients: readonly string[],
  correction?: string,
): Promise<string> {
  const listed = joinItalian(ingredients);
  const userText = [
    `Pasto: ${meal}`,
    `Alimenti dati: ${listed}`,
    "Puoi aggiungere solo: sale, pepe, olio, acqua.",
    correction ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  const completed = await completeWithClaude({
    system: CHEF_PROMPT,
    userText,
    schema: MENU_SCHEMA,
  });
  return completed.raw;
}

async function chefMenu(
  meal: MealName,
  ingredients: readonly string[],
): Promise<string> {
  if (ingredients.length < 2) {
    return "Claude non ha scritto il menù. Manca la lista degli alimenti scritti dalla persona.";
  }
  let raw: string;
  try {
    raw = await askChef(meal, ingredients);
  } catch (err) {
    return claudeError(err);
  }
  const first = readMenu(raw);
  const firstProblems = typeof first === "string" ? [first] : menuProblems(first, ingredients);
  if (typeof first !== "string" && firstProblems.length === 0) {
    return formatMenu(first, ingredients);
  }
  let secondRaw: string;
  try {
    secondRaw = await askChef(
      meal,
      ingredients,
      [
        `Errore da correggere: ${firstProblems.join(" ")}`,
        "JSON precedente:",
        raw.trim(),
        "Riscrivi il JSON. Usa solo gli alimenti dati, più sale, pepe, olio e acqua.",
      ].join("\n"),
    );
  } catch (err) {
    return claudeError(err);
  }
  const second = readMenu(secondRaw);
  const secondProblems =
    typeof second === "string" ? [second] : menuProblems(second, ingredients);
  if (typeof second !== "string" && secondProblems.length === 0) {
    return formatMenu(second, ingredients);
  }
  return `Claude non ha scritto il menù. ${secondProblems.join(" ")}`;
}

function confirmedMeal(prior: readonly string[]): {
  meal: "la cena" | "il pranzo";
  ingredients: string[];
  saidYes: boolean;
} | null {
  const ingredients = ingredientsFromThread(prior);
  if (ingredients.length < 2) return null;
  const choice = [...prior].reverse().find((line) => bareMealChoice(line));
  const acceptance = [...prior].reverse().find((line) => isMealAcceptanceQuestion(line));
  const hasMenu = prior.some((line) => /alimenti_non_usati/iu.test(line));
  const saidYes = prior.some((line) => isBareAffirmation(line) || wantsTheMenu(line));
  if (!choice && !hasMenu && !(acceptance && saidYes)) return null;
  const meal: "la cena" | "il pranzo" = choice
    ? bareMealChoice(choice) === "pranzo"
      ? "il pranzo"
      : "la cena"
    : acceptance
      ? mealPhrase(acceptance)
      : "la cena";
  return { meal, ingredients, saidYes };
}

async function followUpFromOllama(
  question: string,
  remembered: { meal: string; ingredients: readonly string[]; saidYes: boolean },
): Promise<string> {
  const listed = joinItalian(remembered.ingredients);
  try {
    const completed = await completeWithOllama({
      system: FOLLOW_PROMPT,
      userText: [
        `Pasto già scelto: ${remembered.meal}`,
        `Alimenti già scritti, e solo questi: ${listed}`,
        remembered.saidYes ? "Ha già detto sì." : "Il pasto è già stato scelto.",
        `Nuova frase: ${question}`,
      ].join("\n"),
      json: false,
    });
    const answer = completed.raw.trim();
    if (!answer) return "Ollama non ha scritto il menù. Risposta vuota.";
    return answer;
  } catch (err) {
    return ollamaError(err);
  }
}

function mealJustChosen(
  question: string,
  prior: readonly string[],
): { meal: MealName; ingredients: string[] } | null {
  const meal = bareMealChoice(question) ?? chosenMeal(question);
  if (!meal) return null;
  const ingredients = ingredientsFromThread(prior);
  if (ingredients.length < 2) return null;
  return { meal, ingredients };
}

/** Agent reply for one customer question. Depends only on that turn. */
export async function answerCustomer(turn: CustomerTurn): Promise<string> {
  const question = turn.question.trim();
  const prior = turn.prior.filter((item) => item.trim().length > 0);
  const chosen = mealJustChosen(question, prior);
  if (chosen) return chefMenu(chosen.meal, chosen.ingredients);
  if (isBareAffirmation(question) || wantsTheMenu(question)) {
    const acceptance = [...prior].reverse().find((item) =>
      isMealAcceptanceQuestion(item),
    );
    if (acceptance) {
      const ingredients = ingredientsFromThread(prior);
      const meal: MealName = /cena/iu.test(acceptance) ? "cena" : "pranzo";
      return chefMenu(meal, ingredients);
    }
  }
  const sequenced = provaFiammettaReply(question, prior);
  if (sequenced?.draft) return sequenced.draft;
  const remembered = confirmedMeal(prior);
  if (remembered) return followUpFromOllama(question, remembered);
  const asked = question.replace(/\s+/g, " ").trim();
  return withFiammettaIntro(
    `Sulla tua domanda «${asked}»: se mi elenchi gli alimenti, ti chiedo se è il pranzo o la cena.`,
  );
}

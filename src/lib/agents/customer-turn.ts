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
  "Se manca una portata, piatto è null e note spiega perché.",
  "Lo stesso alimento principale sta in al massimo due portate.",
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
        required: ["portata", "piatto", "ingredienti", "alimento_principale", "note"],
        properties: {
          portata: { type: "string", enum: [...COURSES] },
          piatto: { type: ["string", "null"] },
          ingredienti: { type: "array", items: { type: "string" } },
          alimento_principale: { type: ["string", "null"] },
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

function stem(value: string): string {
  return value.toLocaleLowerCase("it").trim().replace(/[aeio]$/u, "");
}

function sameFood(left: string, right: string): boolean {
  if (left === right) return true;
  const a = stem(left);
  const b = stem(right);
  return a.length >= 3 && a === b;
}

function isAllowedFood(item: string, allowed: readonly string[]): boolean {
  const value = item.toLocaleLowerCase("it").trim();
  if (!value) return true;
  return allowed.some((food) => {
    const name = food.toLocaleLowerCase("it").trim();
    if (sameFood(value, name)) return true;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(
      value,
    );
  });
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
  return {
    portata,
    piatto,
    ingredienti,
    alimento_principale: alimento,
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
  for (const course of COURSES) {
    if (!menu.menu.some((row) => row.portata.toLocaleLowerCase("it") === course)) {
      problems.push(`Manca la portata ${course}.`);
    }
  }
  const mains = new Map<string, number>();
  for (const row of menu.menu) {
    const key = row.portata.toLocaleLowerCase("it");
    if (seen.has(key)) problems.push(`Portata ripetuta: ${row.portata}.`);
    seen.add(key);
    if (row.piatto === null && !row.note) {
      problems.push(`La portata ${row.portata} ha piatto null senza note.`);
    }
    for (const item of row.ingredienti) {
      if (!isAllowedFood(item, allowed)) {
        problems.push(`Ingrediente non consentito: ${item}.`);
      }
    }
    if (row.alimento_principale && !isAllowedFood(row.alimento_principale, allowed)) {
      problems.push(`Ingrediente non consentito: ${row.alimento_principale}.`);
    }
    if (row.piatto && row.alimento_principale) {
      const main = stem(row.alimento_principale);
      mains.set(main, (mains.get(main) ?? 0) + 1);
    }
  }
  for (const item of menu.alimenti_non_usati) {
    if (!isAllowedFood(item, allowed)) {
      problems.push(`Ingrediente non consentito: ${item}.`);
    }
  }
  for (const [main, count] of mains) {
    if (count > 2) {
      problems.push(`Alimento principale «${main}» in più di due portate.`);
    }
  }
  return problems;
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
    return JSON.stringify(first, null, 2);
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
    return JSON.stringify(second, null, 2);
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

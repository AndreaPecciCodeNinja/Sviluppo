/**
 * Food follow-up when the contact agrees but does not pick lunch or dinner.
 * Deterministic: no model call, and nothing is sent.
 */

export const MEAL_CHOICE_DRAFT = "Perfetto. Preferisci il pranzo o la cena?";

const MEAL_WORD =
  /(?<![\p{L}\p{N}])(pranzo|cena)(?![\p{L}\p{N}])/iu;

const AFFIRMATIONS = new Set([
  "si",
  "sì",
  "ok",
  "okay",
  "okk",
  "va bene",
  "va benissimo",
  "va bene così",
  "ok va bene",
  "certo",
  "perfetto",
  "d'accordo",
  "daccordo",
  "d accordo",
  "yes",
  "yep",
  "yeah",
  "confermo",
  "assolutamente",
  "ottimo",
  "si grazie",
  "sì grazie",
  "ok grazie",
]);

export function mentionsMeal(text: string): boolean {
  return MEAL_WORD.test(text);
}

export function normalizeAffirmation(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[!?.…,;:]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole message is a short yes, and it does not name pranzo or cena. */
export function isBareAffirmation(text: string): boolean {
  if (mentionsMeal(text)) return false;
  const normalized = normalizeAffirmation(text);
  if (!normalized || mentionsMeal(normalized)) return false;
  return AFFIRMATIONS.has(normalized);
}

export function looksLikeMealQuestion(text: string): boolean {
  if (!/(?<![\p{L}\p{N}])pranzo(?![\p{L}\p{N}])/iu.test(text)) return false;
  if (!/(?<![\p{L}\p{N}])cena(?![\p{L}\p{N}])/iu.test(text)) return false;
  return /preferisci|vuoi|quale|\?/iu.test(text);
}

/** Ingredient list, or the outbound line that repeats one. Not a bare pranzo/cena. */
export function looksLikeIngredientList(text: string): boolean {
  if (/ingredient/iu.test(text)) return true;
  const stripped = text.replace(MEAL_WORD, " ");
  const parts = stripped
    .split(/[,;\n•]+|\s+e\s+/iu)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 1 && part.length < 32 && part.split(/\s+/).length <= 4,
    );
  return parts.length >= 3;
}

/**
 * Draft asking which meal, or null when this inbound should keep the normal path
 * (including any message that already says pranzo or cena).
 */
export function mealChoiceFollowUp(
  inbound: string,
  priorTexts: readonly string[],
): string | null {
  if (!isBareAffirmation(inbound)) return null;
  const earlier = priorTexts.map((text) => text.trim()).filter(Boolean);
  const hasContext = earlier.some(
    (text) => looksLikeMealQuestion(text) || looksLikeIngredientList(text),
  );
  if (!hasContext) return null;
  return MEAL_CHOICE_DRAFT;
}

const MEAL_FILLER = new Set([
  "per",
  "la",
  "il",
  "lo",
  "l",
  "a",
  "al",
  "alla",
  "vorrei",
  "voglio",
  "facciamo",
  "grazie",
  "si",
  "sì",
  "ok",
  "okay",
  "pure",
  "allora",
  "va",
  "bene",
  "una",
  "un",
  "di",
  "da",
  "che",
  "sia",
  "anche",
  "solo",
  "proprio",
  "magari",
]);

export type MealName = "pranzo" | "cena";

export type MealDishContext = {
  meal: MealName;
  ingredients: string[];
  /** Known dish phrase with article, or null when a model should name it. */
  dish: string | null;
};

function mealHits(text: string): MealName[] {
  return [
    ...text.matchAll(/(?<![\p{L}\p{N}])(pranzo|cena)(?![\p{L}\p{N}])/giu),
  ].map((match) => match[1].toLowerCase() as MealName);
}

/**
 * The inbound picks exactly one meal. Extra words are allowed only when they
 * are filler ("per la cena") or an ingredient list in the same message.
 */
export function chosenMeal(text: string): MealName | null {
  const hits = [...new Set(mealHits(text))];
  if (hits.length !== 1) return null;
  const stripped = text.replace(
    /(?<![\p{L}\p{N}])(pranzo|cena)(?![\p{L}\p{N}])/giu,
    " ",
  );
  const leftovers = stripped
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !MEAL_FILLER.has(word.toLowerCase()));
  if (leftovers.length === 0) return hits[0];
  if (looksLikeIngredientList(stripped)) return hits[0];
  return null;
}

function splitItems(text: string): string[] {
  return text
    .replace(/\*([^*]+)\*/g, "$1")
    .split(/[,;\n•]+|\s+e\s+/iu)
    .map((part) => part.replace(/^[\s:.-]+|[\s.?!]+$/g, "").trim())
    .filter(
      (part) =>
        part.length > 1 &&
        part.length < 32 &&
        part.split(/\s+/).length <= 3 &&
        !/pranzo|cena|vuoi|elencat|ingredient|prepar|preferisci|quest[aei]|con questi/iu.test(
          part,
        ),
    );
}

export function ingredientsFromThread(priorTexts: readonly string[]): string[] {
  const found: string[] = [];
  for (const text of priorTexts) {
    const labeled = text.match(/ingredienti\s*:\s*([^\n]+)/iu);
    if (labeled) {
      found.push(...splitItems(labeled[1]));
      continue;
    }
    if (looksLikeIngredientList(text) && !looksLikeMealQuestion(text)) {
      found.push(...splitItems(text));
    }
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of found) {
    const key = item.toLocaleLowerCase("it");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

export function joinItalian(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** A few obvious home dishes. Anything else is left to the model. */
export function heuristicDish(ingredients: readonly string[]): string | null {
  const blob = ingredients.join(" ");
  if (
    /cacao|cioccolat/iu.test(blob) &&
    /farina/iu.test(blob) &&
    /uov/iu.test(blob)
  ) {
    return "una torta al cacao";
  }
  return null;
}

export function mealDishContext(
  inbound: string,
  priorTexts: readonly string[],
): MealDishContext | null {
  const meal = chosenMeal(inbound);
  if (!meal) return null;
  const stripped = inbound.replace(
    /(?<![\p{L}\p{N}])(pranzo|cena)(?![\p{L}\p{N}])/giu,
    " ",
  );
  const ingredients = ingredientsFromThread([...priorTexts, stripped]);
  if (ingredients.length < 2) return null;
  return { meal, ingredients, dish: heuristicDish(ingredients) };
}

export function buildDishDraft(
  meal: MealName,
  dish: string,
  ingredients: readonly string[],
): string {
  const mealPhrase = meal === "cena" ? "la cena" : "il pranzo";
  const name = dish.trim().replace(/[.?!]+$/g, "");
  return `Per ${mealPhrase} ti propongo ${name}. Userò ${joinItalian(ingredients)}.`;
}

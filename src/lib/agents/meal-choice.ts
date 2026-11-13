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
 * The inbound names exactly one meal, including phrases such as
 * "preparami il pranzo". Both meals in one text is not a choice.
 */
export function chosenMeal(text: string): MealName | null {
  const hits = [...new Set(mealHits(text))];
  if (hits.length !== 1) return null;
  return hits[0];
}

/**
 * The message is only "cena" or "pranzo", or that word is the last line
 * (a quoted question can name both meals above it).
 */
export function bareMealChoice(text: string): MealName | null {
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const normalized = normalizeAffirmation(lines[lines.length - 1])
    .replace(/^(?:per\s+)?(?:il|la|lo)\s+/iu, "")
    .replace(/^(?:solo|soltanto)\s+/iu, "");
  if (normalized === "pranzo" || normalized === "cena") return normalized;
  return null;
}

const GREETING_WORD =
  "(?:ciao|salve|buongiorno|buonasera|buon\\s+pomeriggio|ehi|hey|hola)";

/** Drop "Ciao Andrea," so a greeting and a name are not ingredients. */
function stripLeadingGreeting(text: string): string {
  return text
    .replace(
      new RegExp(
        `^${GREETING_WORD}\\b(?:\\s+[^\\s,;.:]+)(?=\\s*[,;:]|\\s*$)[\\s,;.:]*`,
        "iu",
      ),
      "",
    )
    .replace(new RegExp(`^${GREETING_WORD}\\b[\\s,;.:]*`, "iu"), "")
    .trim();
}

function isGreetingItem(part: string): boolean {
  return new RegExp(`^${GREETING_WORD}\\b`, "iu").test(part);
}

/** Our own meal question or dish draft. It echoes an older list, it is not one. */
export function isOwnFoodReply(text: string): boolean {
  return (
    /hai elencato questi ingredienti/iu.test(text) ||
    /ti propongo/iu.test(text) ||
    /^sono fiammetta\b/iu.test(text.trim()) ||
    /vuoi che ti prepari il\s+\*?pranzo/iu.test(text) ||
    /preferisci il pranzo o la cena/iu.test(text) ||
    /per (?:il pranzo|la cena) con /iu.test(text) ||
    /preparo (?:il pranzo|la cena|una |un )/iu.test(text)
  );
}

/**
 * Name for a customer-facing draft, if one is needed.
 * Only the WhatsApp contact display name. Never a fixed name, and never a
 * name copied from a greeting in the thread. Empty when Bird has no name.
 */
export function customerNameFromDisplay(
  displayName: string | null | undefined,
): string | null {
  const name = displayName?.replace(/\s+/g, " ").trim() ?? "";
  if (!name || /^unknown$/iu.test(name)) return null;
  if (/^[+\d][\d\s().-]{5,}$/.test(name)) return null;
  return name;
}

/**
 * First name when the WhatsApp display is several words.
 * "Tommaso Pelucchini" reads as Tommaso; a single word stays as it is.
 */
export function spokenCustomerName(
  displayName: string | null | undefined,
): string | null {
  const full = customerNameFromDisplay(displayName);
  if (!full) return null;
  const parts = full.split(" ").filter(Boolean);
  return parts.length >= 2 ? parts[0] : full;
}

function cleanIngredientPhrase(part: string): string {
  let text = part.replace(/\s+/g, " ").trim();
  text = text.replace(
    /^(?:mi\s+servirebbero|mi\s+servirebbe|mi\s+servono|vorrei|voglio|ho\s+bisogno\s+di|servirebbero|servono|serve)\s+/iu,
    "",
  );
  let previous = "";
  while (text && previous !== text) {
    previous = text;
    text = text
      .replace(
        /^(?:del|dello|della|dei|degli|delle|di|un|uno|una|il|lo|la|i|gli|le|due|tre|quattro|cinque|sei|qualche)\s+/iu,
        "",
      )
      .trim();
  }
  return text;
}

function splitItems(text: string): string[] {
  return stripLeadingGreeting(text)
    .replace(/\*([^*]+)\*/g, "$1")
    .split(/[,;\n•]+|\s+e\s+/iu)
    .map((part) =>
      cleanIngredientPhrase(part.replace(/^[\s:.-]+|[\s.?!]+$/g, "").trim()),
    )
    .filter(
      (part) =>
        part.length > 1 &&
        part.length < 32 &&
        part.split(/\s+/).length <= 3 &&
        !isGreetingItem(part) &&
        !/pranzo|cena|vuoi|elencat|ingredient|prepar|preferisci|quest[aei]|con questi/iu.test(
          part,
        ),
    );
}

/**
 * Ingredient list that does not name pranzo or cena.
 * The meal question is known: no model call.
 */
export function ingredientMealQuestion(text: string): string | null {
  if (mentionsMeal(text) || !looksLikeIngredientList(text)) return null;
  const items = splitItems(text);
  if (items.length < 2) return null;
  return `Hai elencato questi ingredienti: ${items.join(", ")}.\nVuoi che ti prepari il pranzo o la cena con questi?`;
}

function withoutContactName(
  items: readonly string[],
  displayName: string | null | undefined,
): string[] {
  const contact = customerNameFromDisplay(displayName)?.toLocaleLowerCase("it");
  if (!contact) return [...items];
  return items.filter((item) => item.toLocaleLowerCase("it") !== contact);
}

/**
 * Ingredients for a dish draft: only the last customer list before the meal
 * choice. Older lists are not merged. Greetings and the contact name are not
 * ingredients.
 */
export function ingredientsFromThread(
  priorTexts: readonly string[],
  displayName?: string | null,
): string[] {
  let latest: string[] = [];
  for (const text of priorTexts) {
    const labeled = text.match(/ingredienti\s*:\s*([^\n]+)/iu);
    if (labeled) {
      const items = withoutContactName(splitItems(labeled[1]), displayName);
      if (items.length >= 2) latest = items;
      continue;
    }
    if (isOwnFoodReply(text)) continue;
    if (!looksLikeIngredientList(text) || looksLikeMealQuestion(text)) continue;
    const items = withoutContactName(splitItems(text), displayName);
    if (items.length >= 2) latest = items;
  }
  return latest;
}

export function joinItalian(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** A few obvious home dishes. Unknown lists still get a plate, not another question. */
export function heuristicDish(ingredients: readonly string[]): string | null {
  const blob = ingredients.join(" ");
  if (/uov/iu.test(blob) && /zucchin/iu.test(blob) && /salsicc/iu.test(blob)) {
    return "una frittata di zucchine e salsiccia";
  }
  if (
    /pomodor/iu.test(blob) &&
    /zucchin/iu.test(blob) &&
    /melanzan/iu.test(blob) &&
    /agli/iu.test(blob)
  ) {
    return "una caponata di verdure";
  }
  if (/carne/iu.test(blob) && /pane/iu.test(blob)) {
    return "un panino con carne";
  }
  if (
    /cacao|cioccolat/iu.test(blob) &&
    /farina/iu.test(blob) &&
    /uov/iu.test(blob)
  ) {
    return "una torta al cacao";
  }
  if (
    /pasta/iu.test(blob) &&
    /formagg/iu.test(blob) &&
    /rag[uù]/iu.test(blob) &&
    /peperonc/iu.test(blob)
  ) {
    return "una pasta al ragù piccante";
  }
  if (/pollo/iu.test(blob) && /riso/iu.test(blob) && /zucchin/iu.test(blob)) {
    return "un risotto di pollo e zucchine";
  }
  if (
    /uov/iu.test(blob) &&
    /pancett/iu.test(blob) &&
    /pecorin/iu.test(blob) &&
    /spaghetti/iu.test(blob)
  ) {
    return "una carbonara";
  }
  return null;
}

/**
 * One follow-up after the contact picks pranzo or cena.
 * Uses only the latest ingredient list and the WhatsApp display name.
 * Not a plate, and the list is not repeated.
 */
export function mealFollowUpQuestion(
  inbound: string,
  priorTexts: readonly string[],
  displayName?: string | null,
): string | null {
  const meal = bareMealChoice(inbound) ?? chosenMeal(inbound);
  if (!meal) return null;
  const ingredients = ingredientsFromThread(priorTexts, displayName);
  if (ingredients.length < 2) return null;
  const mealPhrase = meal === "cena" ? "la cena" : "il pranzo";
  const name = customerNameFromDisplay(displayName);
  const lead = name ? `${name}, per` : "Per";
  return `${lead} ${mealPhrase} con ${joinItalian(ingredients)} va bene?`;
}

/**
 * True when the composer holds the meal confirmation question
 * ("per la cena con … va bene?"), with or without the Fiammetta intro.
 */
export function isMealAcceptanceQuestion(text: string): boolean {
  return mealFromAcceptanceQuestion(text) !== null;
}

function mealFromAcceptanceQuestion(text: string): {
  meal: MealName;
  listed: string;
} | null {
  const stripped = text
    .replace(/^sono fiammetta\.\s*/iu, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = stripped.match(
    /^(?:[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,3},\s*)?per (il pranzo|la cena) con (.+?)\s+va bene\??$/iu,
  );
  if (!match) return null;
  return {
    meal: /cena/iu.test(match[1]) ? "cena" : "pranzo",
    listed: match[2],
  };
}

/**
 * One draft after a simulated «sì».
 * Names a dish from the latest list. Does not repeat that list.
 * A long WhatsApp display name is shortened to the first name.
 */
export function mealAcceptedDraft(
  question: string,
  priorTexts: readonly string[],
  displayName?: string | null,
): string | null {
  const parsed = mealFromAcceptanceQuestion(question);
  if (!parsed) return null;
  const fromThread = ingredientsFromThread(priorTexts, displayName);
  const fromQuestion = splitItems(parsed.listed);
  const ingredients = fromThread.length >= 2 ? fromThread : fromQuestion;
  if (ingredients.length < 2) return null;
  const mealPhrase = parsed.meal === "cena" ? "la cena" : "il pranzo";
  const name = spokenCustomerName(displayName);
  const lead = name ? `Perfetto, ${name}.` : "Perfetto.";
  const dish = heuristicDish(ingredients);
  if (!dish) return null;
  return `${lead} Per ${mealPhrase} preparo ${dish}.`;
}

export function proposedDishName(ingredients: readonly string[]): string {
  return heuristicDish(ingredients) ?? `un piatto con ${joinItalian(ingredients)}`;
}

export function mealDishContext(
  inbound: string,
  priorTexts: readonly string[],
  displayName?: string | null,
): MealDishContext | null {
  const meal = bareMealChoice(inbound) ?? chosenMeal(inbound);
  if (!meal) return null;
  const stripped = stripLeadingGreeting(
    inbound.replace(
      /(?<![\p{L}\p{N}])(pranzo|cena)(?![\p{L}\p{N}])/giu,
      " ",
    ),
  );
  const ingredients = ingredientsFromThread(
    [...priorTexts, stripped],
    displayName,
  );
  if (ingredients.length < 2) return null;
  return { meal, ingredients, dish: proposedDishName(ingredients) };
}

export function buildDishDraft(
  meal: MealName,
  dish: string,
  ingredients: readonly string[],
): string {
  const mealPhrase = meal === "cena" ? "la cena" : "il pranzo";
  const name = dish.trim().replace(/[.?!]+$/g, "");
  if (/frittata di zucchine e salsiccia/iu.test(name)) {
    return `Per ${mealPhrase} ti propongo ${name}. Con le uova e un goccio di latte la leghiamo in padella.`;
  }
  if (/caponata di verdure/iu.test(name)) {
    return `Per ${mealPhrase} ti propongo ${name}. Le stufiamo in padella con un filo d'olio.`;
  }
  return `Per ${mealPhrase} ti propongo ${name}. Userò ${joinItalian(ingredients)}.`;
}

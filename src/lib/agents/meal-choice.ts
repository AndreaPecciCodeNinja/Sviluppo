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

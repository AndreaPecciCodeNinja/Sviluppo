import { withFiammettaIntro } from "./fiammetta";
import {
  MEAL_CHOICE_DRAFT,
  ingredientMealQuestion,
  isBareAffirmation,
  isMealAcceptanceQuestion,
  isOwnFoodReply,
  looksLikeIngredientList,
  looksLikeMealQuestion,
  mealAcceptedDraft,
  mealFollowUpQuestion,
} from "./meal-choice";

export type ProvaReply = {
  draft: string;
  note: string;
};

export type FoodSequencePhase = "start" | "meal" | "which" | "confirm" | "done";

function isCustomerIngredientList(text: string): boolean {
  if (isOwnFoodReply(text) || isMealAcceptanceQuestion(text)) return false;
  if (/preferisci il pranzo o la cena/iu.test(text)) return false;
  if (/preparo (?:una |un )/iu.test(text)) return false;
  return looksLikeIngredientList(text) && !looksLikeMealQuestion(text);
}

/** Index of the latest customer ingredient list. Older dishes do not freeze a later list. */
function latestCustomerListIndex(priorTexts: readonly string[]): number {
  let index = -1;
  for (let i = 0; i < priorTexts.length; i++) {
    if (isCustomerIngredientList(priorTexts[i])) index = i;
  }
  return index;
}

/**
 * Phase of the latest ingredient list only. A dish from an older list
 * does not keep the thread stopped.
 */
export function foodSequencePhase(
  priorTexts: readonly string[],
): FoodSequencePhase {
  const index = latestCustomerListIndex(priorTexts);
  const tail = index < 0 ? priorTexts : priorTexts.slice(index + 1);
  if (
    tail.some(
      (text) => /preparo (?:una |un )/iu.test(text) && !/va bene/iu.test(text),
    )
  ) {
    return "done";
  }
  if (tail.some((text) => isMealAcceptanceQuestion(text))) return "confirm";
  if (tail.some((text) => /preferisci il pranzo o la cena/iu.test(text))) {
    return "which";
  }
  if (
    index >= 0 ||
    tail.some((text) => /vuoi che ti prepari il\s+\*?pranzo/iu.test(text))
  ) {
    return "meal";
  }
  return "start";
}

/** Food words the sequence owns. Other inbox messages stay on the normal reply path. */
export function isFoodSequenceTurn(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  return (
    isBareAffirmation(value) ||
    Boolean(ingredientMealQuestion(value)) ||
    /(?<![\p{L}\p{N}])(pranzo|cena)(?![\p{L}\p{N}])/iu.test(value)
  );
}

function reply(draft: string, note: string): ProvaReply {
  return { draft: withFiammettaIntro(draft), note };
}

/**
 * Reply for the separate agent bench. Local rules only: no Bird, no WhatsApp send.
 * The sequence runs once: ingredients, one meal question, one confirmation, one dish.
 */
export function provaFiammettaReply(
  inbound: string,
  priorTexts: readonly string[] = [],
  displayName?: string | null,
): ProvaReply | null {
  const text = inbound.trim();
  if (!text) return null;

  const listed = ingredientMealQuestion(text);
  if (listed) {
    const echoed = listed.split("\n")[0];
    if (!priorTexts.some((item) => item.includes(echoed))) {
      return reply(listed, "domanda pranzo o cena");
    }
    return null;
  }

  const phase = foodSequencePhase(priorTexts);
  if (phase === "done") return null;

  if (phase === "confirm") {
    if (!isBareAffirmation(text)) return null;
    const question = [...priorTexts].reverse().find((item) =>
      isMealAcceptanceQuestion(item),
    );
    if (!question) return null;
    const accepted = mealAcceptedDraft(question, priorTexts, displayName);
    if (!accepted) return null;
    return reply(accepted, "piatto nominato");
  }

  if (phase === "meal" || phase === "which") {
    const afterMeal = mealFollowUpQuestion(text, priorTexts, displayName);
    if (afterMeal) return reply(afterMeal, "conferma pasto");
    if (phase === "meal" && isBareAffirmation(text)) {
      return reply(MEAL_CHOICE_DRAFT, "scelta pasto");
    }
    return null;
  }

  return null;
}

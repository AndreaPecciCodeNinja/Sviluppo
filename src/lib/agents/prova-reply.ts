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

function hasIngredientContext(priorTexts: readonly string[]): boolean {
  return priorTexts.some((text) => {
    if (/vuoi che ti prepari il\s+\*?pranzo/iu.test(text)) return true;
    if (/hai elencato questi ingredienti/iu.test(text)) return true;
    if (isOwnFoodReply(text)) return false;
    return looksLikeIngredientList(text) && !looksLikeMealQuestion(text);
  });
}

/**
 * Each question is one phase. A later reply never asks an earlier question again.
 * An ingredient list already in the thread counts as the meal question having a context,
 * even before that question is stored.
 */
export function foodSequencePhase(
  priorTexts: readonly string[],
): FoodSequencePhase {
  if (
    priorTexts.some(
      (text) => /preparo (?:una |un )/iu.test(text) && !/va bene/iu.test(text),
    )
  ) {
    return "done";
  }
  if (priorTexts.some((text) => isMealAcceptanceQuestion(text))) return "confirm";
  if (priorTexts.some((text) => /preferisci il pranzo o la cena/iu.test(text))) {
    return "which";
  }
  if (priorTexts.some((text) => /vuoi che ti prepari il\s+\*?pranzo/iu.test(text))) {
    return "meal";
  }
  if (hasIngredientContext(priorTexts)) return "meal";
  return "start";
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

  const listed = ingredientMealQuestion(text);
  if (listed) return reply(listed, "domanda pranzo o cena");
  return null;
}

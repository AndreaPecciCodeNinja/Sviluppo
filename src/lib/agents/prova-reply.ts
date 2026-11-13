import { withFiammettaIntro } from "./fiammetta";
import {
  MEAL_CHOICE_DRAFT,
  ingredientMealQuestion,
  isBareAffirmation,
  isMealAcceptanceQuestion,
  mealAcceptedDraft,
  mealFollowUpQuestion,
} from "./meal-choice";

export type ProvaReply = {
  draft: string;
  note: string;
};

type ProvaPhase = "start" | "meal" | "which" | "confirm" | "done";

/**
 * Each question is one phase. A later reply never asks an earlier question again.
 */
function phaseOf(priorTexts: readonly string[]): ProvaPhase {
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
  if (priorTexts.some((text) => /vuoi che ti prepari il pranzo o la cena/iu.test(text))) {
    return "meal";
  }
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

  const phase = phaseOf(priorTexts);
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

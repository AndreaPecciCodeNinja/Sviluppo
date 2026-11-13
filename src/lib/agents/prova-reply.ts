import { withFiammettaIntro } from "./fiammetta";
import {
  ingredientMealQuestion,
  isBareAffirmation,
  isMealAcceptanceQuestion,
  mealAcceptedDraft,
  mealChoiceFollowUp,
  mealFollowUpQuestion,
} from "./meal-choice";

export type ProvaReply = {
  draft: string;
  note: string;
};

/**
 * Reply for the separate agent bench. Local rules only: no Bird, no WhatsApp send.
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
    return {
      draft: withFiammettaIntro(listed),
      note: "domanda pranzo o cena",
    };
  }

  const mealAsk = mealChoiceFollowUp(text, priorTexts);
  if (mealAsk) {
    return {
      draft: withFiammettaIntro(mealAsk),
      note: "scelta pasto",
    };
  }

  const afterMeal = mealFollowUpQuestion(text, priorTexts, displayName);
  if (afterMeal) {
    return {
      draft: withFiammettaIntro(afterMeal),
      note: "conferma pasto",
    };
  }

  if (isBareAffirmation(text)) {
    const question = [...priorTexts].reverse().find((item) =>
      isMealAcceptanceQuestion(item),
    );
    if (question) {
      const accepted = mealAcceptedDraft(question, priorTexts, displayName);
      if (accepted) {
        return {
          draft: withFiammettaIntro(accepted),
          note: "piatto nominato",
        };
      }
    }
  }

  return {
    draft: withFiammettaIntro(
      "Se mi elenchi gli alimenti, ti chiedo se è il pranzo o la cena.",
    ),
    note: "solo lettura",
  };
}

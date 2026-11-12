import type { RouterIntent } from "./types";

const APPOINTMENT_WORD =
  /\b(appuntament\w*|prenot(?:are|azione|a)?|fissare|fissiamo|ci vediamo|disponibil\w*|agenda)\b/i;
/**
 * Weekday / relative day. Lookaround instead of `\b` so a trailing accent
 * (`martedì`) still counts as a boundary.
 */
export const DAY_WORD =
  /(?<![\p{L}\p{N}])(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|domani|oggi|dopodomani)(?![\p{L}\p{N}])/iu;
const TIME_WORD =
  /\b(?:alle|ore)\s*\d{1,2}(?:[:.]\d{2})?\b|\b\d{1,2}:\d{2}\b/i;
const FOOD_WORD =
  /\b(pranzo|cena|ingredient\w*|ricett\w*|cucin\w*|mangiare|aliment\w*|spesa)\b/i;

function commaListScore(text: string): number {
  const parts = text
    .split(/[,;\n•]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1 && part.length < 40);
  if (parts.length >= 3 && !APPOINTMENT_WORD.test(text)) return 2;
  return 0;
}

/** Higher = more likely. 2+ is a strong match. */
export function appointmentScore(text: string): number {
  let score = 0;
  if (APPOINTMENT_WORD.test(text)) score += 2;
  if (DAY_WORD.test(text)) score += 1;
  if (TIME_WORD.test(text)) score += 1;
  return score;
}

export function foodScore(text: string): number {
  let score = 0;
  if (FOOD_WORD.test(text)) score += 2;
  score += commaListScore(text);
  return score;
}

export function matchAppointment(text: string): boolean {
  return appointmentScore(text) >= 2;
}

export function matchFood(text: string): boolean {
  return foodScore(text) >= 2 && appointmentScore(text) < 2;
}

export function heuristicIntent(
  text: string,
  enabled: ReadonlySet<RouterIntent>,
): { intent: RouterIntent; strong: boolean; rationale: string } {
  const appt = appointmentScore(text);
  const food = foodScore(text);
  if (appt >= 2 && appt >= food && enabled.has("appointment")) {
    return {
      intent: "appointment",
      strong: true,
      rationale: "parole di appuntamento, giorno o orario",
    };
  }
  if (food >= 2 && food > appt && enabled.has("food_meal")) {
    return {
      intent: "food_meal",
      strong: true,
      rationale: "pranzo/cena o lista ingredienti",
    };
  }
  return {
    intent: "generic",
    strong: false,
    rationale: "nessun intent specializzato evidente",
  };
}

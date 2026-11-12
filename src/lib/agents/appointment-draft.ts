export type AppointmentSlots = {
  date: string;
  time: string;
  purpose: string;
};

/** Same weekday list as `DAY_WORD` in match.ts (accent-safe boundary). */
const WEEKDAY_WORD =
  /(?<![\p{L}\p{N}])(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|domani|oggi|dopodomani)(?![\p{L}\p{N}])/iu;

const DAY_WORD =
  /(?<![\p{L}\p{N}])(\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?)(?![\p{L}\p{N}])/u;
const TIME_WORD =
  /\b(?:alle|ore)\s*(\d{1,2}(?:[:.]\d{2})?)\b|\b(\d{1,2}:\d{2})\b/i;

/** "15", "alle 15", "15.30" → "15:00" / "15:30". Other strings stay trimmed. */
export function normalizeTime(raw: string): string {
  const stripped = raw
    .trim()
    .toLowerCase()
    .replace(/^(?:alle|ore)\s+/, "");
  const match = stripped.match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!match) return raw.trim();
  const hour = Number.parseInt(match[1], 10);
  if (!Number.isFinite(hour) || hour > 23) return raw.trim();
  const minutes = match[2] ?? "00";
  return `${String(hour).padStart(2, "0")}:${minutes}`;
}

export function heuristicAppointmentSlots(text: string): AppointmentSlots {
  const weekday = text.match(WEEKDAY_WORD);
  const numeric = text.match(DAY_WORD);
  const time = text.match(TIME_WORD);
  return {
    date: (weekday?.[0] || numeric?.[0] || "").trim(),
    time: normalizeTime(time?.[1] || time?.[2] || ""),
    purpose: "",
  };
}

export function mergeAppointmentSlots(
  primary: AppointmentSlots,
  fallback: AppointmentSlots,
): AppointmentSlots {
  return {
    date: primary.date.trim() || fallback.date.trim(),
    time: normalizeTime(primary.time.trim() || fallback.time.trim()),
    purpose: primary.purpose.trim() || fallback.purpose.trim(),
  };
}

/**
 * Confirmation when day and time are present; otherwise a question for the gaps.
 * Does not invent a calendar event — the operator still sends the draft.
 */
export function buildAppointmentDraft(slots: AppointmentSlots): {
  draft: string;
  kind: "confirm" | "ask";
} {
  const date = slots.date.trim();
  const time = normalizeTime(slots.time);
  const purpose = slots.purpose.trim();
  const purposeBit = purpose ? ` per ${purpose}` : "";

  if (date && time) {
    return {
      kind: "confirm",
      draft: `Perfetto — segno un appuntamento${purposeBit} per ${date} alle ${time}. Confermi?`,
    };
  }

  const missing: string[] = [];
  if (!date) missing.push("il giorno");
  if (!time) missing.push("l'orario");
  const purposeAsk = purpose ? "" : " e di cosa si tratta";
  const what =
    missing.length > 0
      ? `${missing.join(" e ")}${purposeAsk}`
      : "il giorno e l'orario";
  return {
    kind: "ask",
    draft: `Volentieri. Per fissare l'appuntamento mi dici ${what}?`,
  };
}

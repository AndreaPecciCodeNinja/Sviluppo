export type FoodSendMode = "manual" | "automatic";

export type AutoSendOutcome = "sent" | "window" | "error";

export const FOOD_SEND_MODE_KEY = "food-send-mode";
export const FOOD_AUTO_SEND_TRIED_KEY = "food-auto-send-tried";
export const FOOD_AUTO_SENT_TEXTS_KEY = "food-auto-sent-texts";

/** Shown once when WhatsApp refuses a free-form reply. Not retried. */
export const WINDOW_CLOSED_MESSAGE =
  "Finestra di servizio WhatsApp (24h) chiusa — serve un messaggio in ingresso dal contatto, oppure un template approvato su Bird.";

const FOOD_CUSTOMER_TEMPLATES = new Set([
  "food_ingredients_meal",
  "food_meal_choice",
  "food_dish_proposal",
]);

export function isFoodCustomerDraft(
  templateId: string | null | undefined,
): boolean {
  return FOOD_CUSTOMER_TEMPLATES.has(templateId || "");
}

/** Missing or unknown values stay on Manuale. */
export function parseFoodSendMode(raw: string | null | undefined): FoodSendMode {
  return raw === "automatic" ? "automatic" : "manual";
}

export function parseTriedSends(
  raw: string | null | undefined,
): Record<string, AutoSendOutcome> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const tried: Record<string, AutoSendOutcome> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!id) continue;
      if (value === "sent" || value === "window" || value === "error") {
        tried[id] = value;
      }
    }
    return tried;
  } catch {
    return {};
  }
}

/** Same sentence, ignoring spacing and case, so a poll cannot send it again. */
export function normalizeOutboundText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase("it");
}

export function parseSentTexts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

/**
 * Automatic mode sends the food draft just built for this inbound once.
 * A later poll, reopen, or new id with the same text does not send again.
 */
export function shouldAutoSendFoodDraft(input: {
  mode: FoodSendMode;
  messageId: string | null | undefined;
  tried: Readonly<Record<string, AutoSendOutcome>>;
  text?: string | null;
  sentTexts?: ReadonlySet<string>;
}): boolean {
  if (input.mode !== "automatic") return false;
  const id = input.messageId?.trim();
  if (!id) return false;
  if (input.tried[id] != null) return false;
  const key = normalizeOutboundText(input.text || "");
  if (key && input.sentTexts?.has(key)) return false;
  return true;
}

export function isWindowClosedSendError(error: {
  message?: string | null;
  code?: string | null;
  name?: string | null;
}): boolean {
  if (error.code === "E15044") return true;
  if (error.name === "WhatsAppServiceWindowClosed") return true;
  const haystack = `${error.message || ""}`.toLowerCase();
  return (
    haystack.includes("service window") ||
    haystack.includes("customer service window") ||
    haystack.includes("finestra di servizio") ||
    haystack.includes("finestra 24")
  );
}

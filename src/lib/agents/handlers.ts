import {
  buildAppointmentDraft,
  heuristicAppointmentSlots,
  mergeAppointmentSlots,
  type AppointmentSlots,
} from "./appointment-draft";
import { completeWithReplyProvider, extractJsonObject } from "./llm";
import { rememberInbound } from "./memory-context";
import { suggestReplyFromText } from "../reply-agent";
import { replyProviderLabel } from "../reply-provider";
import type { DraftContext, SpecialistDraft } from "./types";

const FOOD_TEMPLATE_ID = "food_ingredients_meal";

const GENERIC_ACK = "Grazie per il messaggio — ti rispondo a breve.";

export const APPOINTMENT_EXTRACT_PROMPT = [
  "You extract appointment details from one inbound WhatsApp message.",
  "Respond with ONLY compact JSON (no markdown):",
  '{"date":"","time":"","purpose":"","rationale":""}',
  "Rules:",
  "- date: day or calendar date as written (e.g. martedì, domani, 12/11). Empty if absent.",
  "- time: 24h HH:MM when a clock time is present (15 or alle 15 → 15:00). Empty if absent.",
  "- purpose: short reason if the contact stated one, otherwise empty string.",
  "- Do not invent a date, time, or purpose.",
  "- rationale: one short Italian phrase.",
].join("\n");

type AppointmentModel = {
  date?: string;
  time?: string;
  purpose?: string;
  rationale?: string;
};

function asSlot(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Existing food flow: template catalog + slot fill.
 * Auto-draft only when the food template is actually chosen.
 */
export async function draftFood(ctx: DraftContext): Promise<SpecialistDraft> {
  const suggestion = await suggestReplyFromText(ctx.text, {
    contactKey: ctx.contactKey,
    conversationId: ctx.conversationId,
  });
  const food = suggestion.templateId === FOOD_TEMPLATE_ID;
  return {
    draft: suggestion.draft,
    autoEligible: food,
    handledBy: food ? "food" : "generic",
    rationale: suggestion.rationale,
    intentSummary: suggestion.intentSummary,
    slots: suggestion.slots,
    templateId: suggestion.templateId,
    templateLabel: suggestion.templateLabel,
    model: suggestion.model,
    provider: suggestion.provider,
  };
}

export async function draftAppointment(
  ctx: DraftContext,
): Promise<SpecialistDraft> {
  const memoryBlock = await rememberInbound(ctx);
  const system = memoryBlock
    ? `${APPOINTMENT_EXTRACT_PROMPT}\n\nContact memory (do not invent beyond it + the message):\n${memoryBlock}`
    : APPOINTMENT_EXTRACT_PROMPT;

  let modelSlots: AppointmentSlots = { date: "", time: "", purpose: "" };
  let rationale = "";
  let model = ctx.classification.model;
  let provider = ctx.classification.provider;

  try {
    const completed = await completeWithReplyProvider({
      system,
      userText: ctx.text,
      leadIn: "Inbound WhatsApp message — extract appointment slots:",
    });
    model = completed.model;
    provider = completed.provider;
    const parsed = extractJsonObject<AppointmentModel>(
      completed.raw,
      replyProviderLabel(completed.provider),
    );
    modelSlots = {
      date: asSlot(parsed.date),
      time: asSlot(parsed.time),
      purpose: asSlot(parsed.purpose),
    };
    rationale = asSlot(parsed.rationale);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const badJson = /did not return valid JSON/i.test(message);
    if (!badJson) throw err;
    rationale = "estrazione modello non valida, uso il testo";
  }

  const slots = mergeAppointmentSlots(
    modelSlots,
    heuristicAppointmentSlots(ctx.text),
  );
  const built = buildAppointmentDraft(slots);
  const summary = [
    slots.date && `giorno ${slots.date}`,
    slots.time && `ore ${slots.time}`,
    slots.purpose && slots.purpose,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    draft: built.draft,
    autoEligible: true,
    handledBy: "appointments",
    rationale: rationale || built.kind,
    intentSummary: summary || "appuntamento senza data/ora",
    slots: {
      date: slots.date,
      time: slots.time,
      purpose: slots.purpose,
      kind: built.kind,
    },
    model,
    provider,
  };
}

export async function draftGeneric(ctx: DraftContext): Promise<SpecialistDraft> {
  await rememberInbound(ctx);
  return {
    draft: GENERIC_ACK,
    autoEligible: false,
    handledBy: "generic",
    rationale: "Nessuno specialista dedicato — ack corto solo se premi Suggerisci",
    intentSummary: ctx.classification.rationale,
    slots: {},
    templateId: "generic_ack",
    templateLabel: "Conferma generica",
    model: ctx.classification.model,
    provider: ctx.classification.provider,
  };
}

import {
  FIAMMETTA_ROLE,
  fiammettaRouteLabel,
  withFiammettaIntro,
} from "./fiammetta";
import { extractJsonObject, completeWithReplyProvider } from "./llm";
import { bareMealChoice, chosenMeal } from "./meal-choice";
import { foodSequencePhase, provaFiammettaReply } from "./prova-reply";
import { heuristicIntent } from "./match";
import { getReplyProvider } from "../reply-provider";
import {
  enabledIntents,
  getSpecialist,
  isEnvEnabled,
  resolveSpecialist,
} from "./specialists";
import type {
  Classification,
  DraftContext,
  RouterIntent,
  RoutedDraft,
} from "./types";

const INTENT_ALIASES: Record<string, RouterIntent> = {
  appointment: "appointment",
  appointments: "appointment",
  appuntamento: "appointment",
  appuntamenti: "appointment",
  food: "food_meal",
  food_meal: "food_meal",
  foodmeal: "food_meal",
  meal: "food_meal",
  pranzo: "food_meal",
  cena: "food_meal",
  generic: "generic",
  generic_ack: "generic",
  other: "generic",
  altro: "generic",
};

type RouterModel = {
  intent?: string;
  rationale?: string;
};

function normalizeIntent(
  value: unknown,
  enabled: ReadonlySet<RouterIntent>,
): RouterIntent | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const intent = INTENT_ALIASES[key];
  if (!intent || !enabled.has(intent)) return null;
  return intent;
}

function routerPrompt(enabled: ReadonlySet<RouterIntent>): string {
  const lines = [
    FIAMMETTA_ROLE,
    "Classify the inbound WhatsApp message and hand it to exactly one specialist.",
    "Do not write the specialist reply.",
    "Choose exactly one intent:",
  ];
  if (enabled.has("appointment")) {
    lines.push(
      '- "appointment": booking, meeting, a time to meet, "ci vediamo", scheduling.',
    );
  }
  if (enabled.has("food_meal")) {
    lines.push(
      '- "food_meal": a list of ingredients or a lunch/dinner (pranzo/cena) request.',
    );
  }
  lines.push('- "generic": anything else, including greetings and unclear text.');
  lines.push(
    "Respond with ONLY compact JSON (no markdown):",
    '{"intent":"<intent>","rationale":"<short Italian>"}',
    "Do not draft the reply. Do not invent details.",
  );
  return lines.join("\n");
}

export async function classifyIntent(text: string): Promise<Classification> {
  const enabled = enabledIntents();
  const heuristic = heuristicIntent(text, enabled);
  const completed = await completeWithReplyProvider({
    system: routerPrompt(enabled),
    userText: text,
    leadIn: "Inbound WhatsApp message to route:",
  });
  let parsed: RouterModel = {};
  try {
    parsed = extractJsonObject<RouterModel>(
      completed.raw,
      completed.provider === "ollama" ? "Ollama" : "Claude",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!/did not return valid JSON/i.test(message)) throw err;
  }
  let intent = normalizeIntent(parsed.intent, enabled);
  let rationale = parsed.rationale?.trim() || "";
  let heuristicOverride = false;

  if (!intent) {
    intent = heuristic.intent;
    rationale = rationale || heuristic.rationale;
  } else if (
    intent === "generic" &&
    heuristic.strong &&
    heuristic.intent !== "generic"
  ) {
    intent = heuristic.intent;
    heuristicOverride = true;
    rationale = [rationale, `override: ${heuristic.rationale}`]
      .filter(Boolean)
      .join(" · ");
  }

  return {
    intent,
    rationale: rationale || heuristic.rationale,
    model: completed.model,
    provider: completed.provider,
    heuristicOverride,
  };
}

export type RouteOptions = {
  contactKey?: string | null;
  conversationId?: string | null;
  /** Earlier thread texts (not the inbound being routed). */
  priorTexts?: readonly string[] | null;
  /** Bird contact display name. Used only when a draft addresses the customer. */
  contactDisplayName?: string | null;
};

/**
 * Router reads the inbound text, picks one specialist, and returns a draft.
 * Nothing here sends WhatsApp — the composer only shows the draft.
 */
const FOOD_SEQUENCE_TEMPLATE: Record<
  string,
  { id: string; label: string; rationale: string }
> = {
  "domanda pranzo o cena": {
    id: "food_ingredients_meal",
    label: "Pranzo o cena con ingredienti",
    rationale: "Lista ingredienti senza pasto: chiedo pranzo o cena, una volta",
  },
  "scelta pasto": {
    id: "food_meal_choice",
    label: "Scelta pranzo o cena",
    rationale: "Sì senza pasto: chiedo pranzo o cena, una volta",
  },
  "conferma pasto": {
    id: "food_meal_followup",
    label: "Conferma pasto e ingredienti",
    rationale: "Pasto scelto: una sola conferma, senza ripetere la domanda",
  },
  "piatto nominato": {
    id: "food_named_dish",
    label: "Piatto nominato",
    rationale: "Sì alla conferma: nomino il piatto e mi fermo",
  },
};

function foodSequenceTemplate(note: string): {
  id: string;
  label: string;
  rationale: string;
} {
  return (
    FOOD_SEQUENCE_TEMPLATE[note] ?? {
      id: "food_named_dish",
      label: "Piatto nominato",
      rationale: note,
    }
  );
}

export async function routeInboundMessage(
  inboundText: string,
  options: RouteOptions = {},
): Promise<RoutedDraft> {
  const text = inboundText.trim();
  if (!text) {
    throw new Error("Empty text — select a message or paste content first");
  }

  const food = getSpecialist("food");
  const priorTexts = (options.priorTexts ?? []).filter(
    (item) => typeof item === "string" && item.trim().length > 0,
  );
  if (food && isEnvEnabled(food.envFlag)) {
    const sequenced = provaFiammettaReply(
      text,
      priorTexts,
      options.contactDisplayName,
    );
    if (sequenced) {
      const template = foodSequenceTemplate(sequenced.note);
      return {
        draft: sequenced.draft,
        autoEligible: true,
        specialistId: "food",
        specialistLabel: food.label,
        routeLabel: fiammettaRouteLabel(food.label),
        intent: "food_meal",
        rationale: template.rationale,
        intentSummary: sequenced.note,
        slots: {},
        templateId: template.id,
        templateLabel: template.label,
        model: "heuristic",
        provider: getReplyProvider(),
      };
    }

    if (
      foodSequencePhase(priorTexts) !== "start" ||
      bareMealChoice(text) ||
      chosenMeal(text)
    ) {
      return {
        draft: "",
        autoEligible: false,
        specialistId: "food",
        specialistLabel: food.label,
        routeLabel: fiammettaRouteLabel(food.label),
        intent: "food_meal",
        rationale:
          foodSequencePhase(priorTexts) === "done"
            ? "Piatto già nominato: la sequenza è ferma"
            : "Domanda già fatta, oppure pasto senza una lista nuova",
        intentSummary: "sequenza cibo ferma",
        slots: {},
        templateId: "food_sequence_hold",
        templateLabel: "Sequenza già avanzata",
        model: "heuristic",
        provider: getReplyProvider(),
        skipped: true,
      };
    }
  }

  const classification = await classifyIntent(text);
  const specialist = resolveSpecialist(classification.intent);
  const ctx: DraftContext = {
    text,
    contactKey: options.contactKey,
    conversationId: options.conversationId,
    classification,
  };
  const drafted = await specialist.draft(ctx);
  const owner =
    (drafted.handledBy && getSpecialist(drafted.handledBy)) || specialist;
  const autoEligible = owner.id === "generic" ? false : drafted.autoEligible;

  return {
    draft: withFiammettaIntro(drafted.draft),
    autoEligible,
    specialistId: owner.id,
    specialistLabel: owner.label,
    routeLabel: fiammettaRouteLabel(owner.label),
    intent: classification.intent,
    rationale: [classification.rationale, drafted.rationale]
      .filter(Boolean)
      .join(" · "),
    intentSummary: drafted.intentSummary || classification.rationale,
    slots: drafted.slots,
    templateId: drafted.templateId,
    templateLabel: drafted.templateLabel,
    model: drafted.model || classification.model,
    provider: drafted.provider,
    skipped: drafted.skipped,
  };
}

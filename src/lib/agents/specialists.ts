import { draftAppointment, draftFood, draftGeneric, APPOINTMENT_EXTRACT_PROMPT } from "./handlers";
import { matchAppointment, matchFood } from "./match";
import type { RouterIntent, SpecialistDefinition, SpecialistId } from "./types";

const OFF = new Set(["0", "false", "off", "no"]);

/**
 * Unset or empty env = enabled. `0` / `false` / `off` / `no` disables.
 * Generic has no flag: it is the fallback and never auto-sends a draft.
 */
export function isEnvEnabled(name: string | undefined): boolean {
  if (!name) return true;
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return true;
  return !OFF.has(raw.trim().toLowerCase());
}

/**
 * Add a specialist = one entry (id, match, prompt, draft handler) + intent on the router.
 * Wire `envFlag` to skip it without deleting the entry.
 */
export const specialistRegistry: SpecialistDefinition[] = [
  {
    id: "food",
    label: "Cibo",
    intent: "food_meal",
    envFlag: "SPECIALIST_FOOD",
    match: matchFood,
    prompt:
      "Flusso suggest-reply esistente: template food_ingredients_meal (lista ingredienti → pranzo o cena). Auto-bozza solo se quel template viene scelto.",
    draft: draftFood,
  },
  {
    id: "appointments",
    label: "Appuntamenti",
    intent: "appointment",
    envFlag: "SPECIALIST_APPOINTMENTS",
    match: matchAppointment,
    prompt: APPOINTMENT_EXTRACT_PROMPT,
    draft: draftAppointment,
  },
  {
    id: "generic",
    label: "Generico",
    intent: "generic",
    match: () => true,
    prompt:
      "Ack corto. Nessuna auto-bozza: il testo inbound resta nel composer finché l'operatore preme Suggerisci.",
    draft: draftGeneric,
  },
];

export function listSpecialistCatalog() {
  return specialistRegistry.map((specialist) => ({
    id: specialist.id,
    label: specialist.label,
    intent: specialist.intent,
    enabled: isEnvEnabled(specialist.envFlag),
    routeLabel: `Router → ${specialist.label}`,
    envFlag: specialist.envFlag ?? null,
  }));
}

export function enabledIntents(): Set<RouterIntent> {
  const enabled = new Set<RouterIntent>(["generic"]);
  for (const specialist of specialistRegistry) {
    if (specialist.intent === "generic") continue;
    if (isEnvEnabled(specialist.envFlag)) enabled.add(specialist.intent);
  }
  return enabled;
}

export function getSpecialist(id: SpecialistId): SpecialistDefinition | undefined {
  return specialistRegistry.find((specialist) => specialist.id === id);
}

export function resolveSpecialist(intent: RouterIntent): SpecialistDefinition {
  const match = specialistRegistry.find(
    (specialist) =>
      specialist.intent === intent && isEnvEnabled(specialist.envFlag),
  );
  if (match) return match;
  const fallback = getSpecialist("generic");
  if (!fallback) {
    throw new Error("Specialist registry is missing generic");
  }
  return fallback;
}

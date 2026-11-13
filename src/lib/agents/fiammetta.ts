/** Coordinator name shown in prompts, drafts, and the composer badge. */
export const FIAMMETTA_NAME = "Fiammetta";

/** Role the coordinator must follow. She routes; specialists do the work. */
export const FIAMMETTA_ROLE =
  "Sei Fiammetta, il coordinatore. Ricevi ogni messaggio WhatsApp in arrivo, capisci di che tipo di richiesta si tratta e la affidi all'agente specializzato giusto. Non svolgi tu il lavoro specialistico.";

export function fiammettaRouteLabel(specialistLabel: string): string {
  return `${FIAMMETTA_NAME} → ${specialistLabel}`;
}

/**
 * Customer-facing draft: Fiammetta introduces herself, then the specialist text.
 * Specialist wording stays unchanged. Empty text stays empty.
 */
export function withFiammettaIntro(specialistDraft: string): string {
  const body = specialistDraft.trim();
  if (!body) return body;
  if (/^sono fiammetta\b/iu.test(body)) return body;
  return `Sono ${FIAMMETTA_NAME}. ${body}`;
}

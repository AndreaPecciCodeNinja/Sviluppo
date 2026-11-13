import type { ReplyProvider } from "../reply-provider";

/** Intents the inbound router can emit. */
export type RouterIntent = "appointment" | "food_meal" | "generic";

export type SpecialistId = "food" | "appointments" | "generic";

export type Classification = {
  intent: RouterIntent;
  rationale: string;
  model: string;
  provider: ReplyProvider;
  /** True when a strong keyword match replaced a generic model intent. */
  heuristicOverride: boolean;
};

export type DraftContext = {
  text: string;
  contactKey?: string | null;
  conversationId?: string | null;
  classification: Classification;
};

/** Draft produced by one specialist. The router adds the UI label. */
export type SpecialistDraft = {
  draft: string;
  /** Auto path may fill the composer. Manual Suggerisci still applies a non-empty draft. */
  autoEligible: boolean;
  /** Specialist that actually owns this draft (fallback when a handler declines). */
  handledBy?: SpecialistId;
  rationale: string;
  intentSummary: string;
  slots: Record<string, string>;
  templateId?: string;
  templateLabel?: string;
  model: string;
  provider: ReplyProvider;
  /** No draft text and nothing to apply (disabled specialist). */
  skipped?: boolean;
};

export type RoutedDraft = {
  draft: string;
  autoEligible: boolean;
  specialistId: SpecialistId;
  specialistLabel: string;
  /** Composer badge, e.g. "Fiammetta → Appuntamenti". */
  routeLabel: string;
  intent: RouterIntent;
  rationale: string;
  intentSummary: string;
  slots: Record<string, string>;
  templateId?: string;
  templateLabel?: string;
  model: string;
  provider: ReplyProvider;
  skipped?: boolean;
};

export type SpecialistDefinition = {
  id: SpecialistId;
  /** Short Italian name shown after "Fiammetta →". */
  label: string;
  intent: RouterIntent;
  /**
   * Optional env flag. Unset or empty = enabled.
   * `0` / `false` / `off` / `no` disables the specialist.
   */
  envFlag?: string;
  /** Keyword hint used when the model JSON is missing or weakly generic. */
  match: (text: string) => boolean;
  /** Prompt or note stored on the registry entry (handlers may use their own). */
  prompt: string;
  draft: (ctx: DraftContext) => Promise<SpecialistDraft>;
};

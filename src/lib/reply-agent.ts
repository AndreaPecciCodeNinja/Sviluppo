import { completeWithReplyProvider, extractJsonObject } from "./agents/llm";
import { chosenMeal } from "./agents/meal-choice";
import {
  getReplyTemplate,
  listReplyTemplates,
  renderTemplate,
  type ReplyTemplate,
} from "./reply-templates";
import { replyProviderLabel, type ReplyProvider } from "./reply-provider";

export type { ReplyProvider } from "./reply-provider";
export {
  getClaudeConfig,
  getOllamaConfig,
  getOpenAIReplyConfig,
  getReplyAgentStatus,
  getReplyProvider,
  replyProviderLabel,
} from "./reply-provider";

export type SuggestReplyResult = {
  draft: string;
  templateId: string;
  templateLabel: string;
  slots: Record<string, string>;
  rationale: string;
  model: string;
  provider: ReplyProvider;
  intentSummary: string;
};

type ModelChoice = {
  template_id?: string;
  slots?: Record<string, string>;
  rationale?: string;
  intent_summary?: string;
};

export type { OllamaHealth } from "./ollama-health";
export { checkOllamaHealth } from "./ollama-health";

function buildSystemPrompt(templates: ReplyTemplate[]): string {
  const catalog = templates.map((t) => ({
    id: t.id,
    label: t.label,
    intent: t.intent,
    when_to_use: t.when_to_use,
    slots: t.slots,
  }));

  return [
    "You are a WhatsApp reply router for a small business inbox.",
    "Given an inbound customer message (possibly a voice transcription), choose exactly one reply template from the catalog and fill its slots.",
    "Prefer Italian for slot values when the inbound text is Italian.",
    "Respond with ONLY compact JSON (no markdown fences) matching:",
    '{"template_id":"<id>","slots":{"name":"value"},"rationale":"<short>","intent_summary":"<short>"}',
    "Rules:",
    "- template_id MUST be one of the catalog ids.",
    "- Include every slot the chosen template declares; use empty string if unknown.",
    "- Do not invent facts beyond the inbound text.",
    "- If unsure, use template_id generic_ack with empty slots.",
    "",
    "Catalog:",
    JSON.stringify(catalog),
  ].join("\n");
}

function renderChoice(
  choice: ModelChoice,
  inboundText: string,
  model: string,
  provider: ReplyProvider,
): SuggestReplyResult {
  const templateId = choice.template_id?.trim() || "generic_ack";
  const template =
    getReplyTemplate(templateId) || getReplyTemplate("generic_ack");
  if (!template) {
    throw new Error(`Unknown template_id from model: ${templateId}`);
  }

  const slots: Record<string, string> = {};
  for (const slot of template.slots) {
    const value = choice.slots?.[slot.name];
    slots[slot.name] = typeof value === "string" ? value.trim() : "";
  }

  if (template.id === "food_ingredients_meal" && chosenMeal(inboundText)) {
    const generic = getReplyTemplate("generic_ack");
    if (generic) {
      return {
        draft: renderTemplate(generic, {}).trim(),
        templateId: generic.id,
        templateLabel: generic.label,
        slots: {},
        rationale:
          choice.rationale?.trim() ||
          "Il pasto è già scelto: non ripetere la domanda pranzo/cena",
        intentSummary: choice.intent_summary?.trim() || "",
        model,
        provider,
      };
    }
  }

  if (
    template.id === "food_ingredients_meal" &&
    !slots.ingredients &&
    inboundText.length > 0
  ) {
    slots.ingredients = inboundText
      .split(/[\n,;•\-]+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .join(", ");
  }

  return {
    draft: renderTemplate(template, slots).trim(),
    templateId: template.id,
    templateLabel: template.label,
    slots,
    rationale: choice.rationale?.trim() || "",
    intentSummary: choice.intent_summary?.trim() || "",
    model,
    provider,
  };
}

export type SuggestReplyOptions = {
  /** Contact key for local SQLite memory (phone E.164 or conversation id). */
  contactKey?: string | null;
  conversationId?: string | null;
};

/**
 * Classify inbound text with Claude or local Ollama and render a reply template.
 * When `contactKey` is set, LangChain/SQLite memory facts + snippets are injected.
 */
export async function suggestReplyFromText(
  inboundText: string,
  options: SuggestReplyOptions = {},
): Promise<SuggestReplyResult> {
  const text = inboundText.trim();
  if (!text) {
    throw new Error("Empty text — select a message or paste content first");
  }

  const templates = listReplyTemplates();
  if (templates.length === 0) {
    throw new Error("No reply templates configured in config/reply-templates.json");
  }

  const contactKey = options.contactKey?.trim() || "";
  let memoryBlock = "";
  if (contactKey) {
    // Import store only — avoid barrel pull of optional LangChain history.
    const { buildMemoryPromptBlock, appendMessage } = await import(
      "@/lib/memory/store"
    );
    memoryBlock = buildMemoryPromptBlock(contactKey);
    // Persist the inbound text we're classifying as a human snippet.
    try {
      appendMessage({
        contactKey,
        conversationId: options.conversationId,
        role: "human",
        content: text,
      });
    } catch {
      /* memory write-back is best-effort */
    }
  }

  const system = [
    buildSystemPrompt(templates),
    memoryBlock
      ? `\nUse this contact memory when filling slots (do not invent beyond it + inbound text):\n${memoryBlock}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const completed = await completeWithReplyProvider({ system, userText: text });
  const choice = extractJsonObject<ModelChoice>(
    completed.raw,
    replyProviderLabel(completed.provider),
    "valid JSON for template choice",
  );
  return renderChoice(choice, text, completed.model, completed.provider);
}

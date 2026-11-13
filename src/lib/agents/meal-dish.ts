import { completeWithReplyProvider, extractJsonObject } from "./llm";
import {
  buildDishDraft,
  joinItalian,
  mealDishContext,
  type MealDishContext,
} from "./meal-choice";
import { getReplyProvider, type ReplyProvider } from "../reply-provider";

const DISH_PROMPT = [
  "You name one Italian home dish for a WhatsApp draft.",
  "Respond with ONLY compact JSON (no markdown):",
  '{"dish":"una pasta al pomodoro"}',
  "Rules:",
  "- dish is a short Italian noun phrase that already includes the article (una, un, uno).",
  "- It must be plausible with the given ingredients.",
  "- Do not ask pranzo or cena. Do not write a question.",
].join("\n");

export type MealDishDraft = {
  draft: string;
  meal: MealDishContext["meal"];
  dish: string;
  ingredients: string[];
  model: string;
  provider: ReplyProvider;
};

function genericDish(ingredients: readonly string[]): string {
  return `un piatto con ${joinItalian(ingredients)}`;
}

function acceptableDish(dish: string): boolean {
  const name = dish.trim();
  if (!name || name.length > 80) return false;
  return !/pranzo|cena|vuoi|preferisci|\?/iu.test(name);
}

async function dishFromModel(ctx: MealDishContext): Promise<{
  dish: string;
  model: string;
  provider: ReplyProvider;
} | null> {
  const completed = await completeWithReplyProvider({
    system: DISH_PROMPT,
    userText: `Pasto: ${ctx.meal}\nIngredienti: ${ctx.ingredients.join(", ")}`,
    leadIn: "Name one dish for this meal and these ingredients:",
  });
  try {
    const parsed = extractJsonObject<{ dish?: string }>(
      completed.raw,
      completed.provider === "ollama" ? "Ollama" : "Claude",
    );
    const dish = typeof parsed.dish === "string" ? parsed.dish.trim() : "";
    if (!acceptableDish(dish)) return null;
    return { dish, model: completed.model, provider: completed.provider };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!/did not return valid JSON/i.test(message)) throw err;
    return null;
  }
}

/**
 * Dish draft when the contact already picked pranzo or cena and the thread
 * has ingredients. Null keeps the normal router path.
 */
export async function resolveMealDishDraft(
  inbound: string,
  priorTexts: readonly string[],
  options?: { displayName?: string | null },
): Promise<MealDishDraft | null> {
  const ctx = mealDishContext(inbound, priorTexts, options?.displayName);
  if (!ctx) return null;

  if (ctx.dish) {
    return {
      draft: buildDishDraft(ctx.meal, ctx.dish, ctx.ingredients),
      meal: ctx.meal,
      dish: ctx.dish,
      ingredients: ctx.ingredients,
      model: "heuristic",
      provider: getReplyProvider(),
    };
  }

  const named = await dishFromModel(ctx);
  const dish = named?.dish || genericDish(ctx.ingredients);
  return {
    draft: buildDishDraft(ctx.meal, dish, ctx.ingredients),
    meal: ctx.meal,
    dish,
    ingredients: ctx.ingredients,
    model: named?.model ?? "heuristic",
    provider: named?.provider ?? getReplyProvider(),
  };
}

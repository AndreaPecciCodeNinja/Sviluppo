import { withFiammettaIntro } from "./fiammetta";
import { completeWithOllama, extractJsonObject } from "./llm";
import {
  heuristicDish,
  ingredientsFromThread,
  isBareAffirmation,
  isMealAcceptanceQuestion,
  joinItalian,
} from "./meal-choice";
import { provaFiammettaReply } from "./prova-reply";

/**
 * What the person supplies on the manual bench.
 * `question` is the line they just wrote. `prior` is the earlier lines,
 * person and agent, in order.
 *
 * When WhatsApp is connected later, an inbound message fills these same
 * two fields and calls `answerCustomer`. That connection is not here:
 * nothing in this module reads Bird or sends a message.
 */
export type CustomerTurn = {
  question: string;
  prior: readonly string[];
};

const MENU_PROMPT = [
  "Scrivi il menù di un pasto.",
  "Usa solo gli alimenti scritti dalla persona.",
  "Non aggiungere peperoni, pomodoro, olio o qualsiasi altro alimento che non è nella lista.",
  "Rispondi solo con JSON compatto, senza markdown:",
  '{"menu":"Per la cena preparo un piatto con gli alimenti elencati."}',
  "Il campo menu è una sola frase italiana. Nomina un piatto. Non fare domande.",
].join("\n");

const EXTRA_FOODS = [
  "peperoni",
  "peperone",
  "pomodoro",
  "pomodori",
  "olio",
  "burro",
  "pancetta",
  "guanciale",
  "aglio",
  "cipolla",
];

function mealPhrase(question: string): "la cena" | "il pranzo" {
  return /per la cena/iu.test(question) ? "la cena" : "il pranzo";
}

function addsUnlistedFood(menu: string, ingredients: readonly string[]): boolean {
  const allowed = ingredients.join(" ").toLocaleLowerCase("it");
  const text = menu.toLocaleLowerCase("it");
  return EXTRA_FOODS.some(
    (food) => text.includes(food) && !allowed.includes(food),
  );
}

function localMenu(meal: string, ingredients: readonly string[]): string {
  const listed = joinItalian(ingredients);
  const dish = heuristicDish(ingredients);
  const plate = dish ? `${dish} con ${listed}` : listed;
  return `Perfetto. Per ${meal} preparo ${plate}.`;
}

async function menuFromOllama(
  question: string,
  prior: readonly string[],
): Promise<string | null> {
  const ingredients = ingredientsFromThread([...prior, question]);
  if (ingredients.length < 2) return null;
  const meal = mealPhrase(question);
  const listed = joinItalian(ingredients);
  try {
    const completed = await completeWithOllama({
      system: MENU_PROMPT,
      userText: `Pasto: ${meal}\nAlimenti scritti dalla persona: ${listed}`,
    });
    const parsed = extractJsonObject<{ menu?: string }>(
      completed.raw,
      "Ollama",
    );
    const menu = typeof parsed.menu === "string" ? parsed.menu.trim() : "";
    if (!menu || /[?]/.test(menu) || addsUnlistedFood(menu, ingredients)) {
      return localMenu(meal, ingredients);
    }
    const body = /^perfetto\b/iu.test(menu) ? menu : `Perfetto. ${menu}`;
    return body;
  } catch {
    return localMenu(meal, ingredients);
  }
}

/** Agent reply for one customer question. Depends only on that turn. */
export async function answerCustomer(turn: CustomerTurn): Promise<string> {
  const question = turn.question.trim();
  const prior = turn.prior.filter((item) => item.trim().length > 0);
  if (isBareAffirmation(question)) {
    const acceptance = [...prior].reverse().find((item) =>
      isMealAcceptanceQuestion(item),
    );
    if (acceptance) {
      const menu = await menuFromOllama(acceptance, prior);
      if (menu) return withFiammettaIntro(menu);
    }
  }
  const sequenced = provaFiammettaReply(question, prior);
  if (sequenced?.draft) return sequenced.draft;
  const asked = question.replace(/\s+/g, " ").trim();
  return withFiammettaIntro(
    `Sulla tua domanda «${asked}»: se mi elenchi gli alimenti, ti chiedo se è il pranzo o la cena.`,
  );
}

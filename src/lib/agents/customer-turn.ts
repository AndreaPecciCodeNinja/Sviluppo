import { completeWithOllama } from "./llm";
import {
  ingredientsFromThread,
  isBareAffirmation,
  isMealAcceptanceQuestion,
  joinItalian,
} from "./meal-choice";
import { provaFiammettaReply } from "./prova-reply";
import { withFiammettaIntro } from "./fiammetta";

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
  "Scrivi il menù del pasto, in italiano, come testo da leggere.",
  "Usa solo gli alimenti scritti dalla persona. Non aggiungerne altri.",
  "Niente peperoni, pomodoro, olio, burro, sale, aglio, pancetta, guanciale, né altri cibi assenti dalla lista.",
  "Il menù è il testo completo: i piatti e come sono fatti, solo con quegli alimenti.",
  "Non ridurlo a un titolo di una riga. Non fare domande. Non scrivere JSON.",
].join("\n");

function mealPhrase(question: string): "la cena" | "il pranzo" {
  return /per la cena/iu.test(question) ? "la cena" : "il pranzo";
}

/** «OK. Fammi il menù» after the confirmation, same step as a bare sì. */
function wantsTheMenu(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[!?.…,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /(?:fammi|preparami|prepara|scrivi|voglio)\s+il\s+men[uù](?![\p{L}\p{N}])/iu.test(
    normalized,
  );
}

function ollamaError(err: unknown): string {
  const message = err instanceof Error ? err.message : "errore sconosciuto";
  return `Ollama non ha scritto il menù. ${message}`;
}

async function menuFromOllama(
  question: string,
  prior: readonly string[],
): Promise<string> {
  const ingredients = ingredientsFromThread([...prior, question]);
  if (ingredients.length < 2) {
    return "Ollama non ha scritto il menù. Manca la lista degli alimenti scritti dalla persona.";
  }
  const meal = mealPhrase(question);
  const listed = joinItalian(ingredients);
  try {
    const completed = await completeWithOllama({
      system: MENU_PROMPT,
      userText: `Pasto: ${meal}\nAlimenti scritti dalla persona, e solo questi: ${listed}`,
      json: false,
    });
    const menu = completed.raw.trim();
    if (!menu) return "Ollama non ha scritto il menù. Risposta vuota.";
    return menu;
  } catch (err) {
    return ollamaError(err);
  }
}

/** Agent reply for one customer question. Depends only on that turn. */
export async function answerCustomer(turn: CustomerTurn): Promise<string> {
  const question = turn.question.trim();
  const prior = turn.prior.filter((item) => item.trim().length > 0);
  if (isBareAffirmation(question) || wantsTheMenu(question)) {
    const acceptance = [...prior].reverse().find((item) =>
      isMealAcceptanceQuestion(item),
    );
    if (acceptance) return menuFromOllama(acceptance, prior);
  }
  const sequenced = provaFiammettaReply(question, prior);
  if (sequenced?.draft) return sequenced.draft;
  const asked = question.replace(/\s+/g, " ").trim();
  return withFiammettaIntro(
    `Sulla tua domanda «${asked}»: se mi elenchi gli alimenti, ti chiedo se è il pranzo o la cena.`,
  );
}

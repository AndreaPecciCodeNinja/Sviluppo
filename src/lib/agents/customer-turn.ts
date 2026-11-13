import { withFiammettaIntro } from "./fiammetta";
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

/** Agent reply for one customer question. Depends only on that turn. */
export function answerCustomer(turn: CustomerTurn): string {
  const question = turn.question.trim();
  const prior = turn.prior.filter((item) => item.trim().length > 0);
  const sequenced = provaFiammettaReply(question, prior);
  if (sequenced?.draft) return sequenced.draft;
  const asked = question.replace(/\s+/g, " ").trim();
  return withFiammettaIntro(
    `Sulla tua domanda «${asked}»: se mi elenchi gli alimenti, ti chiedo se è il pranzo o la cena.`,
  );
}

"use client";

import { useRef, useState } from "react";
import { provaFiammettaReply } from "@/lib/agents/prova-reply";

/**
 * Standalone bench. It never reads or selects a WhatsApp conversation.
 */
export function ProvaFiammetta() {
  const [questions, setQuestions] = useState("");
  const [draft, setDraft] = useState("");
  const [replies, setReplies] = useState("");
  const priorRef = useRef<string[]>([]);
  const questionsValue = questions ? `${questions}${draft}` : draft;

  function commitQuestion() {
    const text = draft.trim();
    if (!text) return;
    const next = provaFiammettaReply(text, priorRef.current);
    if (!next) return;
    priorRef.current = [...priorRef.current, text, next.draft];
    setQuestions((prev) => (prev ? `${prev}${text}\n\n` : `${text}\n\n`));
    setDraft("");
    setReplies((prev) => (prev ? `${prev}\n\n${next.draft}` : next.draft));
  }

  return (
    <main className="prova">
      <header className="prova-header">
        <h1>Prova Fiammetta</h1>
        <p className="muted">
          Due box, niente WhatsApp. Gli alimenti si scrivono qui: premi Invio e
          la domanda compare nel box risposte. Non serve aprire una chat.
        </p>
      </header>
      <label className="prova-box" htmlFor="prova-domande">
        <span>Domande a Fiammetta</span>
        <textarea
          id="prova-domande"
          rows={8}
          value={questionsValue}
          placeholder="Scrivi qui e premi Invio"
          onChange={(event) => {
            const value = event.target.value;
            if (!value.startsWith(questions)) return;
            setDraft(value.slice(questions.length));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              commitQuestion();
            }
          }}
        />
      </label>
      <label className="prova-box" htmlFor="prova-risposte">
        <span>Risposte di Fiammetta</span>
        <textarea
          id="prova-risposte"
          rows={8}
          readOnly
          value={replies}
          placeholder="Le risposte compaiono qui"
        />
      </label>
    </main>
  );
}

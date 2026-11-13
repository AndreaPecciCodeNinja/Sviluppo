"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { provaFiammettaReply } from "@/lib/agents/prova-reply";

type Turn = {
  role: "tu" | "fiammetta";
  text: string;
  step?: string;
};

export function ProvaFiammetta() {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const threadEndRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  function writeToFiammetta(event?: FormEvent) {
    event?.preventDefault();
    const text = message.trim();
    if (!text) return;
    const priorTexts = turns.map((turn) => turn.text);
    const next = provaFiammettaReply(text, priorTexts);
    if (!next) return;
    setTurns((prev) => [
      ...prev,
      { role: "tu", text },
      { role: "fiammetta", text: next.draft, step: next.note },
    ]);
    setMessage("");
  }

  return (
    <main className="prova">
      <header className="prova-header">
        <h1>Chat con Fiammetta</h1>
        <p className="muted">
          Scrivi e premi Invio. Fiammetta risponde subito nel thread. WhatsApp
          resta fuori: questa pagina non è collegata a Bird.
        </p>
      </header>
      <ol className="prova-thread" aria-live="polite">
        {turns.length === 0 ? (
          <li className="prova-empty">Scrivi un messaggio. Fiammetta risponde qui.</li>
        ) : (
          turns.map((turn, index) => (
            <li key={`${turn.role}-${index}`} className={`prova-turn is-${turn.role}`}>
              <span>{turn.role === "tu" ? "Tu" : "Fiammetta"}</span>
              {turn.step ? <em>{turn.step}</em> : null}
              <p>{turn.text}</p>
            </li>
          ))
        )}
        <li ref={threadEndRef} className="prova-end" aria-hidden="true" />
      </ol>
      <form className="prova-form" onSubmit={writeToFiammetta}>
        <label className="sr-only" htmlFor="prova-message">
          Scrivi a Fiammetta
        </label>
        <textarea
          id="prova-message"
          rows={3}
          value={message}
          placeholder="Scrivi a Fiammetta e premi Invio"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              writeToFiammetta();
            }
          }}
        />
      </form>
    </main>
  );
}

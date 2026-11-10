"use client";

import type { ChatMessage } from "@/lib/types";

type ThreadProps = {
  waId: string | null;
  displayName?: string;
  messages: ChatMessage[];
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Thread({ waId, displayName, messages }: ThreadProps) {
  if (!waId) {
    return (
      <div className="thread empty">
        <p className="muted">Select a chat</p>
      </div>
    );
  }

  return (
    <div className="thread">
      <header className="thread-header">
        <h2>{displayName || waId}</h2>
        <p className="muted mono">{waId}</p>
      </header>
      <div className="thread-messages" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <p className="muted center">No messages in this thread yet.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`bubble-row ${m.direction}`}
            >
              <div
                className={`bubble ${m.direction}${m.status === "failed" ? " failed" : ""}`}
              >
                <p>{m.text}</p>
                <footer>
                  <time dateTime={m.timestamp}>{formatTime(m.timestamp)}</time>
                  {m.direction === "outbound" ? (
                    <span className="status">{m.status}</span>
                  ) : null}
                </footer>
                {m.error ? <p className="error-text">{m.error}</p> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

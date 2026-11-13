"use client";

import type { ChatMessage } from "@/lib/types";

type ThreadProps = {
  conversationId: string | null;
  displayName?: string;
  contactAddress?: string;
  serviceWindowStatus?: string | null;
  messages: ChatMessage[];
  selectedMessageId?: string | null;
  onSelectMessage?: (message: ChatMessage) => void;
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function kindLabel(message: ChatMessage): string | null {
  if (message.kind === "audio") {
    return message.audio?.voice ? "Vocalino" : "Audio";
  }
  return null;
}

export function Thread({
  conversationId,
  displayName,
  contactAddress,
  serviceWindowStatus,
  messages,
  selectedMessageId,
  onSelectMessage,
}: ThreadProps) {
  if (!conversationId) {
    return (
      <div className="thread empty">
        <p className="muted">Select a chat</p>
      </div>
    );
  }

  return (
    <div className="thread">
      <header className="thread-header">
        <h2>{displayName || conversationId}</h2>
        <p className="muted mono">
          {contactAddress || conversationId}
          {serviceWindowStatus ? ` · CS window: ${serviceWindowStatus}` : ""}
        </p>
        <p className="hint thread-hint">
          Manuale: la bozza resta nel riquadro e parte solo con Send.
        </p>
      </header>
      <div className="thread-messages" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <p className="muted center">No messages in this thread yet.</p>
        ) : (
          messages.map((m) => {
            const selectable = m.direction === "inbound" && Boolean(onSelectMessage);
            const selected = m.id === selectedMessageId;
            const label = kindLabel(m);
            const bubbleClass = `bubble ${m.direction}${m.status === "failed" || m.status === "rejected" ? " failed" : ""}${selected ? " selected" : ""}${selectable ? " selectable" : ""}`;

            const body = (
              <>
                {label ? <span className="bubble-kind">{label}</span> : null}
                <p>{m.text}</p>
                <footer>
                  <time dateTime={m.timestamp}>{formatTime(m.timestamp)}</time>
                  {m.direction === "outbound" ? (
                    <span className="status">{m.status}</span>
                  ) : selectable ? (
                    <span className="status">seleziona</span>
                  ) : null}
                </footer>
                {m.error ? <p className="error-text">{m.error}</p> : null}
              </>
            );

            return (
              <div key={m.id} className={`bubble-row ${m.direction}`}>
                {selectable ? (
                  <button
                    type="button"
                    className={bubbleClass}
                    onClick={() => onSelectMessage?.(m)}
                    aria-pressed={selected}
                    aria-label={`Seleziona messaggio inbound ${m.id}`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={bubbleClass}>{body}</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

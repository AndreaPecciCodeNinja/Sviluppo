"use client";

import type { Conversation } from "@/lib/types";

type InboxProps = {
  conversations: Conversation[];
  selectedId: string | null;
  /** Conversations with a new message the operator has not opened yet. */
  unseenIds?: ReadonlySet<string>;
  onSelect: (id: string) => void;
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Inbox({
  conversations,
  selectedId,
  unseenIds,
  onSelect,
}: InboxProps) {
  if (conversations.length === 0) {
    return (
      <div className="inbox empty">
        <p className="muted">No conversations yet.</p>
        <p className="hint">
          Threads appear after a contact messages the CodeNinja Bird number
          (+393337802795). Conversations must be enabled on that number.
        </p>
      </div>
    );
  }

  return (
    <ul className="inbox-list" aria-label="Conversations">
      {conversations.map((c) => {
        const selected = c.id === selectedId;
        return (
          <li key={c.id}>
            <button
              type="button"
              className={`inbox-item${selected ? " selected" : ""}`}
              onClick={() => onSelect(c.id)}
              aria-current={selected ? "true" : undefined}
            >
              <div className="inbox-item-top">
                <span className="inbox-name">{c.displayName}</span>
                <time dateTime={c.lastMessageAt}>
                  {formatTime(c.lastMessageAt)}
                </time>
              </div>
              <div className="inbox-item-bottom">
                <span className="inbox-preview">
                  {c.contactAddress}
                  {c.serviceWindowStatus
                    ? ` · window ${c.serviceWindowStatus}`
                    : ""}
                </span>
                {unseenIds?.has(c.id) ? (
                  <span
                    className="badge badge-new"
                    role="status"
                    aria-label="Nuovo messaggio"
                    title="Nuovo messaggio"
                  />
                ) : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

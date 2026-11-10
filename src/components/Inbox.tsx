"use client";

import type { Conversation } from "@/lib/types";

type InboxProps = {
  conversations: Conversation[];
  selectedWaId: string | null;
  onSelect: (waId: string) => void;
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

export function Inbox({ conversations, selectedWaId, onSelect }: InboxProps) {
  if (conversations.length === 0) {
    return (
      <div className="inbox empty">
        <p className="muted">No conversations yet.</p>
        <p className="hint">
          Inbound WhatsApp messages appear here after Meta delivers them to{" "}
          <code>/api/webhook</code>.
        </p>
      </div>
    );
  }

  return (
    <ul className="inbox-list" aria-label="Conversations">
      {conversations.map((c) => {
        const selected = c.waId === selectedWaId;
        return (
          <li key={c.waId}>
            <button
              type="button"
              className={`inbox-item${selected ? " selected" : ""}`}
              onClick={() => onSelect(c.waId)}
              aria-current={selected ? "true" : undefined}
            >
              <div className="inbox-item-top">
                <span className="inbox-name">{c.displayName}</span>
                <time dateTime={c.lastMessageAt}>
                  {formatTime(c.lastMessageAt)}
                </time>
              </div>
              <div className="inbox-item-bottom">
                <span className="inbox-preview">{c.lastMessagePreview}</span>
                {c.unreadCount > 0 ? (
                  <span className="badge" aria-label={`${c.unreadCount} unread`}>
                    {c.unreadCount}
                  </span>
                ) : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

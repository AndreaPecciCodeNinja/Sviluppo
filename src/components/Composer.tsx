"use client";

import { FormEvent } from "react";

type ComposerProps = {
  disabled: boolean;
  sending: boolean;
  suggesting?: boolean;
  windowClosed?: boolean;
  text: string;
  onTextChange: (value: string) => void;
  selectedLabel?: string | null;
  statusLabel?: string | null;
  suggestionMeta?: string | null;
  onSend: (text: string) => Promise<void>;
  onSuggestReply?: () => Promise<void>;
  onClearSelection?: () => void;
};

export function Composer({
  disabled,
  sending,
  suggesting,
  windowClosed,
  text,
  onTextChange,
  selectedLabel,
  statusLabel,
  suggestionMeta,
  onSend,
  onSuggestReply,
  onClearSelection,
}: ComposerProps) {
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || disabled || sending || suggesting || statusLabel) return;
    await onSend(value);
  }

  const busy = Boolean(statusLabel) || Boolean(suggesting);
  const placeholder = disabled
    ? "Select a conversation to reply"
    : statusLabel
      ? statusLabel
      : suggesting
        ? "Reply agent sta scegliendo un template…"
        : windowClosed
          ? "Finestra 24h chiusa / window closed — serve inbound o template Bird"
          : "Type a reply — auto-bozza sull’ultimo inbound, o Suggerisci risposta…";

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-meta">
        <label className="composer-label" htmlFor="composer-input">
          {selectedLabel
            ? `Messaggio selezionato / Selected · ${selectedLabel}`
            : "Risposta / Reply"}
        </label>
        <div className="composer-meta-actions">
          {onSuggestReply ? (
            <button
              type="button"
              className="linkish composer-clear"
              onClick={() => void onSuggestReply()}
              disabled={disabled || busy || sending || !text.trim()}
            >
              {suggesting ? "Suggerisco…" : "Suggerisci risposta"}
            </button>
          ) : null}
          {selectedLabel && onClearSelection ? (
            <button
              type="button"
              className="linkish composer-clear"
              onClick={onClearSelection}
              disabled={busy || sending}
            >
              Deseleziona
            </button>
          ) : null}
        </div>
      </div>
      {statusLabel ? (
        <p className="composer-status" role="status">
          {statusLabel}
        </p>
      ) : null}
      {suggestionMeta ? (
        <p className="composer-suggestion-meta" role="status">
          {suggestionMeta}
        </p>
      ) : null}
      <textarea
        id="composer-input"
        rows={4}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled || sending || busy}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSubmit(e);
          }
        }}
      />
      <button
        type="submit"
        disabled={disabled || sending || busy || !text.trim()}
      >
        {sending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

"use client";

import { FormEvent } from "react";

type ComposerProps = {
  disabled: boolean;
  sending: boolean;
  windowClosed?: boolean;
  text: string;
  onTextChange: (value: string) => void;
  selectedLabel?: string | null;
  statusLabel?: string | null;
  onSend: (text: string) => Promise<void>;
  onClearSelection?: () => void;
};

export function Composer({
  disabled,
  sending,
  windowClosed,
  text,
  onTextChange,
  selectedLabel,
  statusLabel,
  onSend,
  onClearSelection,
}: ComposerProps) {
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || disabled || sending || statusLabel) return;
    await onSend(value);
  }

  const placeholder = disabled
    ? "Select a conversation to reply"
    : statusLabel
      ? statusLabel
      : windowClosed
        ? "Finestra 24h chiusa / window closed — serve inbound o template Bird"
        : "Type a reply — or click an inbound message above…";

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-meta">
        <label className="composer-label" htmlFor="composer-input">
          {selectedLabel
            ? `Messaggio selezionato / Selected · ${selectedLabel}`
            : "Risposta / Reply"}
        </label>
        {selectedLabel && onClearSelection ? (
          <button
            type="button"
            className="linkish composer-clear"
            onClick={onClearSelection}
          >
            Deseleziona
          </button>
        ) : null}
      </div>
      {statusLabel ? (
        <p className="composer-status" role="status">
          {statusLabel}
        </p>
      ) : null}
      <textarea
        id="composer-input"
        rows={3}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled || sending || Boolean(statusLabel)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSubmit(e);
          }
        }}
      />
      <button
        type="submit"
        disabled={
          disabled || sending || Boolean(statusLabel) || !text.trim()
        }
      >
        {sending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

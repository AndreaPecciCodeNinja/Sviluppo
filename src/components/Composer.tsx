"use client";

import { FormEvent } from "react";

type ComposerProps = {
  disabled: boolean;
  sending: boolean;
  suggesting?: boolean;
  windowClosed?: boolean;
  text: string;
  /** Changes when the conversation opens so the browser does not restore an old draft. */
  fieldName?: string;
  onTextChange: (value: string) => void;
  onFocus?: () => void;
  selectedLabel?: string | null;
  statusLabel?: string | null;
  suggestionMeta?: string | null;
  routeLabel?: string | null;
  specialistId?: string | null;
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
  fieldName,
  onTextChange,
  onFocus,
  selectedLabel,
  statusLabel,
  suggestionMeta,
  routeLabel,
  specialistId,
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
        ? "Fiammetta sta affidando lo specialista…"
        : windowClosed
          ? "Finestra 24h chiusa / window closed — serve inbound o template Bird"
          : "Type a reply — Fiammetta prepara la bozza, oppure Suggerisci risposta…";

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-meta">
        <div className="composer-label-wrap">
          <label className="composer-label" htmlFor="composer-input">
            {selectedLabel
              ? `Messaggio selezionato / Selected · ${selectedLabel}`
              : "Risposta / Reply"}
          </label>
          {routeLabel ? (
            <span
              className={`specialist-badge specialist-${
                specialistId === "food" ||
                specialistId === "appointments" ||
                specialistId === "generic"
                  ? specialistId
                  : "generic"
              }`}
              role="status"
            >
              {routeLabel}
            </span>
          ) : null}
        </div>
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
        name={fieldName || "composer-reply"}
        rows={4}
        value={text}
        autoComplete="off"
        onChange={(e) => onTextChange(e.target.value)}
        onFocus={onFocus}
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

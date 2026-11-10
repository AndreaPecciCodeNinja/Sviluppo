"use client";

import { FormEvent, useState } from "react";

type ComposerProps = {
  disabled: boolean;
  sending: boolean;
  windowClosed?: boolean;
  onSend: (text: string) => Promise<void>;
};

export function Composer({
  disabled,
  sending,
  windowClosed,
  onSend,
}: ComposerProps) {
  const [text, setText] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || disabled || sending) return;
    await onSend(value);
    setText("");
  }

  const placeholder = disabled
    ? "Select a conversation to reply"
    : windowClosed
      ? "Customer service window closed — free-form text may be refused (use a template in Bird)"
      : "Type a reply…";

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="composer-input">
        Message
      </label>
      <textarea
        id="composer-input"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        disabled={disabled || sending}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSubmit(e);
          }
        }}
      />
      <button type="submit" disabled={disabled || sending || !text.trim()}>
        {sending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

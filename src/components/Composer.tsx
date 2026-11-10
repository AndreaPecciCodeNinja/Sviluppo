"use client";

import { FormEvent, useState } from "react";

type ComposerProps = {
  disabled: boolean;
  sending: boolean;
  onSend: (text: string) => Promise<void>;
};

export function Composer({ disabled, sending, onSend }: ComposerProps) {
  const [text, setText] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || disabled || sending) return;
    await onSend(value);
    setText("");
  }

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
        placeholder={
          disabled ? "Select a conversation to reply" : "Type a reply…"
        }
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Composer } from "./Composer";
import { Inbox } from "./Inbox";
import { Thread } from "./Thread";
import type { ChatMessage, Conversation } from "@/lib/types";

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS || 3000);

export function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedWaId, setSelectedWaId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => conversations.find((c) => c.waId === selectedWaId),
    [conversations, selectedWaId],
  );

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) throw new Error(`Conversations HTTP ${res.status}`);
      const data = (await res.json()) as { conversations: Conversation[] };
      setConversations(data.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inbox");
    }
  }, []);

  const loadMessages = useCallback(async (waId: string) => {
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(waId)}/messages`,
      );
      if (!res.ok) throw new Error(`Messages HTTP ${res.status}`);
      const data = (await res.json()) as { messages: ChatMessage[] };
      setMessages(data.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load thread");
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    const id = window.setInterval(() => {
      void loadConversations();
      if (selectedWaId) void loadMessages(selectedWaId);
    }, Number.isFinite(POLL_MS) && POLL_MS > 500 ? POLL_MS : 3000);
    return () => window.clearInterval(id);
  }, [loadConversations, loadMessages, selectedWaId]);

  useEffect(() => {
    if (selectedWaId) {
      void loadMessages(selectedWaId);
    } else {
      setMessages([]);
    }
  }, [selectedWaId, loadMessages]);

  async function handleSend(text: string) {
    if (!selectedWaId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: selectedWaId, text }),
      });
      const data = (await res.json()) as {
        message?: ChatMessage;
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(data.error?.message || `Send failed (${res.status})`);
      }
      await Promise.all([loadMessages(selectedWaId), loadConversations()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="shell">
      <aside className="pane inbox-pane">
        <header className="pane-header">
          <h1>WhatsApp Inbox</h1>
          <p className="muted">Business Cloud API</p>
        </header>
        <Inbox
          conversations={conversations}
          selectedWaId={selectedWaId}
          onSelect={setSelectedWaId}
        />
      </aside>
      <section className="pane thread-pane">
        <Thread
          waId={selectedWaId}
          displayName={selected?.displayName}
          messages={messages}
        />
        {error ? <p className="banner-error" role="alert">{error}</p> : null}
        <Composer
          disabled={!selectedWaId}
          sending={sending}
          onSend={handleSend}
        />
      </section>
    </div>
  );
}

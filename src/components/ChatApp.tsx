"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Composer } from "./Composer";
import { Inbox } from "./Inbox";
import { Thread } from "./Thread";
import type {
  BirdConfigStatus,
  ChatMessage,
  Conversation,
} from "@/lib/types";

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS || 3000);
const INTERVAL =
  Number.isFinite(POLL_MS) && POLL_MS > 500 ? POLL_MS : 3000;

export function ChatApp() {
  const [status, setStatus] = useState<BirdConfigStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId),
    [conversations, selectedId],
  );

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`Status HTTP ${res.status}`);
      const data = (await res.json()) as BirdConfigStatus;
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      const data = (await res.json()) as {
        conversations?: Conversation[];
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(data.error?.message || `Conversations HTTP ${res.status}`);
        return;
      }
      setConversations(data.conversations || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inbox");
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      );
      const data = (await res.json()) as {
        messages?: ChatMessage[];
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(data.error?.message || `Messages HTTP ${res.status}`);
        return;
      }
      setMessages(data.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load thread");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.configured) return;
    void loadConversations();
    const id = window.setInterval(() => {
      void loadConversations();
      if (selectedId) void loadMessages(selectedId);
    }, INTERVAL);
    return () => window.clearInterval(id);
  }, [status?.configured, selectedId, loadConversations, loadMessages]);

  useEffect(() => {
    if (status?.configured && selectedId) {
      void loadMessages(selectedId);
    } else {
      setMessages([]);
    }
  }, [status?.configured, selectedId, loadMessages]);

  async function handleSend(text: string) {
    if (!selectedId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selectedId, text }),
      });
      const data = (await res.json()) as {
        message?: ChatMessage;
        error?: {
          message?: string;
          code?: string | null;
          name?: string | null;
          bird_message?: string | null;
          status?: number;
        };
      };
      if (!res.ok) {
        const parts = [
          data.error?.message,
          data.error?.code && !data.error?.message?.includes(data.error.code)
            ? `(${data.error.code})`
            : null,
        ].filter(Boolean);
        setError(
          parts.length > 0
            ? parts.join(" ")
            : `Send failed (HTTP ${res.status})`,
        );
      }
      await Promise.all([loadMessages(selectedId), loadConversations()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  if (status && !status.configured) {
    return (
      <div className="setup">
        <h1>Bird WhatsApp Inbox</h1>
        <p className="muted">
          Server-side Bird credentials are missing. Copy{" "}
          <code>.env.example</code> → <code>.env.local</code> and set:
        </p>
        <ul>
          {status.missing.map((name) => (
            <li key={name}>
              <code>{name}</code>
            </li>
          ))}
        </ul>
        <p className="hint">
          Point <code>BIRD_WHATSAPP_PHONE_NUMBER</code> at the existing CodeNinja
          number <strong>+393337802795</strong> (
          <code>{status.numberId}</code>). Create a workspace API key in Bird
          dashboard → Platform tools → API keys with{" "}
          <code>whatsapp:write</code>. Restart <code>npm run dev</code> after
          saving.
        </p>
        <p className="hint">
          Sentiment browse (offline, no API key):{" "}
          <Link href="/sentiment">/sentiment</Link>
        </p>
        {error ? (
          <p className="banner-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="pane inbox-pane">
        <header className="pane-header">
          <h1>WhatsApp Inbox</h1>
          <p className="muted">
            Bird · CodeNinja
            {status?.phoneNumber ? ` · ${status.phoneNumber}` : ""}
            {" · "}
            <Link href="/sentiment">Sentiment</Link>
          </p>
        </header>
        <Inbox
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </aside>
      <section className="pane thread-pane">
        <Thread
          conversationId={selectedId}
          displayName={selected?.displayName}
          contactAddress={selected?.contactAddress}
          serviceWindowStatus={selected?.serviceWindowStatus}
          messages={messages}
        />
        {error ? <p className="banner-error" role="alert">{error}</p> : null}
        <Composer
          disabled={!selectedId}
          sending={sending}
          windowClosed={selected?.serviceWindowStatus === "closed"}
          onSend={handleSend}
        />
      </section>
    </div>
  );
}

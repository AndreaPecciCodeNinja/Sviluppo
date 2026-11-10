"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Composer } from "./Composer";
import { Inbox } from "./Inbox";
import { QrLogin } from "./QrLogin";
import { Thread } from "./Thread";
import type {
  ChatMessage,
  Conversation,
  SessionSnapshot,
} from "@/lib/types";

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS || 2500);
const INTERVAL =
  Number.isFinite(POLL_MS) && POLL_MS > 500 ? POLL_MS : 2500;

export function ChatApp() {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedWaId, setSelectedWaId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = session?.status === "ready";

  const selected = useMemo(
    () => conversations.find((c) => c.waId === selectedWaId),
    [conversations, selectedWaId],
  );

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch("/api/session");
      if (!res.ok) throw new Error(`Session HTTP ${res.status}`);
      const data = (await res.json()) as SessionSnapshot;
      setSession(data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to reach WhatsApp session server",
      );
    }
  }, []);

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
    void loadSession();
    const id = window.setInterval(() => {
      void loadSession();
    }, INTERVAL);
    return () => window.clearInterval(id);
  }, [loadSession]);

  useEffect(() => {
    if (!ready) return;
    void loadConversations();
    const id = window.setInterval(() => {
      void loadConversations();
      if (selectedWaId) void loadMessages(selectedWaId);
    }, INTERVAL);
    return () => window.clearInterval(id);
  }, [ready, selectedWaId, loadConversations, loadMessages]);

  useEffect(() => {
    if (ready && selectedWaId) {
      void loadMessages(selectedWaId);
    } else {
      setMessages([]);
    }
  }, [ready, selectedWaId, loadMessages]);

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

  async function handleLogout() {
    setLoggingOut(true);
    setError(null);
    try {
      const res = await fetch("/api/session/logout", { method: "POST" });
      if (!res.ok) throw new Error(`Logout HTTP ${res.status}`);
      setSelectedWaId(null);
      setMessages([]);
      setConversations([]);
      await loadSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    } finally {
      setLoggingOut(false);
    }
  }

  if (!ready) {
    return (
      <>
        <QrLogin
          session={session}
          onLogout={handleLogout}
          loggingOut={loggingOut}
        />
        {error ? (
          <p className="banner-error fixed-error" role="alert">
            {error}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className="shell">
      <aside className="pane inbox-pane">
        <header className="pane-header">
          <h1>WhatsApp Inbox</h1>
          <p className="muted">
            Web session
            {session?.me?.id ? ` · ${session.me.name || session.me.id}` : ""}
          </p>
          <button
            type="button"
            className="linkish"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Logging out…" : "Logout / re-scan"}
          </button>
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

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Composer } from "./Composer";
import { Inbox } from "./Inbox";
import { MemoryPanel } from "./MemoryPanel";
import {
  OllamaStatusBadge,
  type OllamaHealthView,
} from "./OllamaStatusBadge";
import { Thread } from "./Thread";
import type {
  BirdConfigStatus,
  ChatMessage,
  Conversation,
} from "@/lib/types";

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS || 3000);
const INTERVAL =
  Number.isFinite(POLL_MS) && POLL_MS > 500 ? POLL_MS : 3000;
/** Ollama health poll — lighter than inbox polling. */
const OLLAMA_HEALTH_MS = 15000;

export function ChatApp() {
  const [status, setStatus] = useState<BirdConfigStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(
    null,
  );
  const [transcribing, setTranscribing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionMeta, setSuggestionMeta] = useState<string | null>(null);
  const [ollamaHealth, setOllamaHealth] = useState<OllamaHealthView | null>(
    null,
  );
  const [ollamaChecking, setOllamaChecking] = useState(false);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId),
    [conversations, selectedId],
  );

  /** Prefer E.164 phone; fall back to conversation id for SQLite memory key. */
  const memoryContactKey = selected?.contactAddress || selectedId;

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

  const loadOllamaHealth = useCallback(async () => {
    setOllamaChecking(true);
    try {
      const res = await fetch("/api/ollama/health", { cache: "no-store" });
      const data = (await res.json()) as OllamaHealthView;
      setOllamaHealth(data);
      return data;
    } catch {
      setOllamaHealth({
        provider: "ollama",
        active: true,
        reachable: false,
        model: "?",
        baseUrl: "?",
        modelPresent: false,
        ok: false,
        message:
          "Impossibile controllare Ollama (health API) — riprova tra poco",
      });
      return null;
    } finally {
      setOllamaChecking(false);
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
    void loadOllamaHealth();
    const id = window.setInterval(() => {
      void loadOllamaHealth();
    }, OLLAMA_HEALTH_MS);
    return () => window.clearInterval(id);
  }, [loadOllamaHealth]);

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
    setSelectedMessage(null);
    setDraft("");
    setTranscribing(false);
    setSuggesting(false);
    setSuggestionMeta(null);
  }, [status?.configured, selectedId, loadMessages]);

  async function rememberSnippet(params: {
    role: "human" | "ai";
    content: string;
    messageId?: string;
  }) {
    if (!memoryContactKey || !params.content.trim()) return;
    try {
      await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "message",
          contactKey: memoryContactKey,
          conversationId: selectedId,
          role: params.role,
          content: params.content,
          messageId: params.messageId,
        }),
      });
    } catch {
      /* best-effort */
    }
  }

  async function handleSelectMessage(message: ChatMessage) {
    if (message.direction !== "inbound") return;
    setSelectedMessage(message);
    setSuggestionMeta(null);
    setError(null);

    if (message.kind === "audio" && message.audio?.mediaId) {
      setDraft("");
      setTranscribing(true);
      try {
        const res = await fetch("/api/messages/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: message.id,
            mediaId: message.audio.mediaId,
            voiceNote: message.audio.voice,
            mimeType: message.audio.mimeType,
          }),
        });
        const data = (await res.json()) as {
          transcription?: { text?: string };
          error?: { message?: string };
        };
        if (!res.ok) {
          setError(
            data.error?.message ||
              `Transcription failed (HTTP ${res.status})`,
          );
          setDraft("");
          return;
        }
        const transcribed = data.transcription?.text?.trim() || "";
        setDraft(transcribed);
        if (transcribed) {
          void rememberSnippet({
            role: "human",
            content: transcribed,
            messageId: message.id,
          });
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Transcription failed",
        );
      } finally {
        setTranscribing(false);
      }
      return;
    }

    // Text (and other) inbound: put readable body in the editable box.
    const text =
      message.kind === "text"
        ? message.text
        : message.text.replace(/^\[.*?\]\s*/, "") || message.text;
    const boxText = text.startsWith("[") ? "" : text;
    setDraft(boxText);
    if (boxText) {
      void rememberSnippet({
        role: "human",
        content: boxText,
        messageId: message.id,
      });
    }
    if (message.kind !== "text") {
      setError(
        `Messaggio ${message.kind}: nessun testo da copiare. Solo testo e audio/vocali sono supportati nel box.`,
      );
    }
  }

  async function handleSuggestReply() {
    const text = draft.trim();
    if (!text || suggesting || transcribing) return;
    setSuggesting(true);
    setError(null);
    try {
      // Refresh Ollama badge; block suggest only when reply provider is Ollama and unhealthy.
      const health = await loadOllamaHealth();
      if (health?.provider === "ollama" && !health.ok) {
        setError(health.message);
        return;
      }
      const res = await fetch("/api/messages/suggest-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          contactKey: memoryContactKey,
          conversationId: selectedId,
        }),
      });
      const data = (await res.json()) as {
        suggestion?: {
          draft?: string;
          templateId?: string;
          templateLabel?: string;
          rationale?: string;
          intentSummary?: string;
          model?: string;
          provider?: string;
        };
        error?: { message?: string; provider?: string };
      };
      if (!res.ok) {
        setError(
          data.error?.message ||
            `Suggest reply failed (HTTP ${res.status})`,
        );
        return;
      }
      const suggestion = data.suggestion;
      if (!suggestion?.draft) {
        setError("Reply agent returned an empty draft");
        return;
      }
      setDraft(suggestion.draft);
      setSuggestionMeta(
        [
          suggestion.provider,
          suggestion.templateLabel || suggestion.templateId,
          suggestion.intentSummary,
          suggestion.model ? `model ${suggestion.model}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Suggest reply failed",
      );
    } finally {
      setSuggesting(false);
      void loadOllamaHealth();
    }
  }

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
      } else {
        void rememberSnippet({ role: "ai", content: text });
        setDraft("");
        setSelectedMessage(null);
        setSuggestionMeta(null);
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
          Vocali: <code>OPENAI_API_KEY</code>. Reply agent:{" "}
          <code>REPLY_PROVIDER=ollama|claude</code>. Sentiment:{" "}
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

  const selectedLabel = selectedMessage
    ? selectedMessage.kind === "audio"
      ? selectedMessage.audio?.voice
        ? "vocalino"
        : "audio"
      : "testo"
    : null;

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
        <div className="thread-toolbar">
          <OllamaStatusBadge
            health={ollamaHealth}
            checking={ollamaChecking && !ollamaHealth}
          />
        </div>
        <Thread
          conversationId={selectedId}
          displayName={selected?.displayName}
          contactAddress={selected?.contactAddress}
          serviceWindowStatus={selected?.serviceWindowStatus}
          messages={messages}
          selectedMessageId={selectedMessage?.id ?? null}
          onSelectMessage={(m) => {
            void handleSelectMessage(m);
          }}
        />
        {error ? <p className="banner-error" role="alert">{error}</p> : null}
        <Composer
          disabled={!selectedId}
          sending={sending}
          suggesting={suggesting}
          windowClosed={selected?.serviceWindowStatus === "closed"}
          text={draft}
          onTextChange={(value) => {
            setDraft(value);
            if (suggestionMeta) setSuggestionMeta(null);
          }}
          selectedLabel={selectedLabel}
          statusLabel={
            transcribing
              ? "Trascrizione…"
              : suggesting
                ? "Reply agent sta scegliendo un template…"
                : null
          }
          suggestionMeta={suggestionMeta}
          onClearSelection={() => {
            setSelectedMessage(null);
            setDraft("");
            setTranscribing(false);
            setSuggesting(false);
            setSuggestionMeta(null);
          }}
          onSuggestReply={handleSuggestReply}
          onSend={handleSend}
        />
        <MemoryPanel
          contactKey={memoryContactKey}
          conversationId={selectedId}
          draftText={draft}
        />
      </section>
    </div>
  );
}

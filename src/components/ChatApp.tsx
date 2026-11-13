"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./Composer";
import { Inbox } from "./Inbox";
import { MemoryPanel } from "./MemoryPanel";
import {
  OllamaStatusBadge,
  type OllamaHealthView,
} from "./OllamaStatusBadge";
import { Thread } from "./Thread";
import { fiammettaRouteLabel, withFiammettaIntro } from "@/lib/agents/fiammetta";
import {
  buildDishDraft,
  ingredientMealQuestion,
  mealChoiceFollowUp,
  mealDishContext,
} from "@/lib/agents/meal-choice";
import type {
  BirdConfigStatus,
  ChatMessage,
  Conversation,
} from "@/lib/types";

const SEEN_INBOX_KEY = "inbox-seen-message-at";

function readSeenInbox(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SEEN_INBOX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const seen: Record<string, string> = {};
    for (const [id, at] of Object.entries(parsed)) {
      if (typeof at === "string" && at) seen[id] = at;
    }
    return seen;
  } catch {
    return {};
  }
}

/** Dot only when a message arrived after the chat was last opened. */
function hasUnseenMessage(
  conversation: Conversation,
  seenAt: Readonly<Record<string, string>>,
  openId: string | null,
): boolean {
  if (conversation.id === openId) return false;
  const openedAt = seenAt[conversation.id];
  if (openedAt) {
    const latest = Date.parse(conversation.lastMessageAt);
    const seen = Date.parse(openedAt);
    return Number.isFinite(latest) && Number.isFinite(seen) && latest > seen;
  }
  return conversation.unreadCount > 0;
}

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS || 3000);
const INTERVAL =
  Number.isFinite(POLL_MS) && POLL_MS > 500 ? POLL_MS : 3000;
/** Ollama health poll — lighter than inbox polling. */
const OLLAMA_HEALTH_MS = 15000;

/** Templates safe to apply without a manual Suggerisci click. */
const AUTO_DRAFT_TEMPLATE_IDS = new Set([
  "food_ingredients_meal",
  "food_meal_choice",
  "food_dish_proposal",
]);
/**
 * Bump when auto-draft behavior changes so an inbound id already handled by
 * an older bundle is drafted again once (same browser session / HMR).
 */
const AUTO_DRAFT_VERSION = "food-dish-8";
const SUGGEST_TIMEOUT_MS = 25_000;
const OLLAMA_TIMEOUT_MESSAGE =
  "Ollama non risponde in tempo. Controlla che sia avviato, poi riprova con Suggerisci.";

function autoHandleKey(messageId: string): string {
  return `${AUTO_DRAFT_VERSION}:${messageId}`;
}

function visibleClientError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  if (isTimeoutError(err)) return OLLAMA_TIMEOUT_MESSAGE;
  if (/failed to fetch|networkerror|load failed/i.test(err.message)) {
    return "Non riesco a raggiungere il server per la bozza. Lo stato di generazione è stato fermato. Ricarica la pagina, poi riprova con Suggerisci.";
  }
  return err.message || fallback;
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name.toLowerCase();
  return (
    name === "timeouterror" ||
    name === "aborterror" ||
    /timeout|timed out|aborted/i.test(err.message)
  );
}

function findLatestInbound(messages: ChatMessage[]): ChatMessage | null {
  let latest: ChatMessage | null = null;
  for (const message of messages) {
    if (message.direction !== "inbound") continue;
    if (!latest) {
      latest = message;
      continue;
    }
    const a = Date.parse(message.timestamp);
    const b = Date.parse(latest.timestamp);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (a >= b) latest = message;
    } else {
      // Fallback: list is chronological oldest → newest.
      latest = message;
    }
  }
  return latest;
}

function inboundComposerText(message: ChatMessage): string {
  if (message.kind === "text") return message.text.trim();
  const stripped = message.text.replace(/^\[.*?\]\s*/, "").trim();
  if (stripped.startsWith("[")) return "";
  return stripped;
}

function shortPreview(text: string, max = 48): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

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
  const [routeBadge, setRouteBadge] = useState<{
    label: string;
    specialistId: string;
  } | null>(null);
  const [ollamaHealth, setOllamaHealth] = useState<OllamaHealthView | null>(
    null,
  );
  const [ollamaChecking, setOllamaChecking] = useState(false);
  /** Bumps when the inbox conversation is opened, including a re-click. */
  const [composerEpoch, setComposerEpoch] = useState(0);
  /** lastMessageAt already opened, so the inbox dot stays off until a newer message. */
  const [seenInboxAt, setSeenInboxAt] = useState<Record<string, string>>({});

  /** `${version}:${messageId}` already auto-drafted — avoid poll loops. */
  const autoHandledInboundIdRef = useRef<string | null>(null);
  /**
   * Draft just written by auto-open. Ignore a browser restore of the previous
   * textarea value until the operator focuses the box.
   */
  const programmaticDraftRef = useRef<string | null>(null);
  /** Which auto-draft rules already reset the handled ids in this session. */
  const autoDraftVersionRef = useRef<string | null>(null);
  /** Bumped on conversation change / clear so stale async work is ignored. */
  const suggestGenerationRef = useRef(0);
  const suggestInFlightRef = useRef(false);

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
      const res = await fetch("/api/ollama/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as OllamaHealthView;
      setOllamaHealth(data);
      return data;
    } catch (err) {
      const down: OllamaHealthView = {
        provider: "ollama",
        active: true,
        reachable: false,
        model: "?",
        baseUrl: "?",
        modelPresent: false,
        ok: false,
        message: isTimeoutError(err)
          ? OLLAMA_TIMEOUT_MESSAGE
          : "Impossibile controllare Ollama (health API) — riprova tra poco",
      };
      setOllamaHealth(down);
      return down;
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
    setSeenInboxAt(readSeenInbox());
  }, []);

  useEffect(() => {
    if (!selectedId || !selected?.lastMessageAt) return;
    const at = selected.lastMessageAt;
    setSeenInboxAt((prev) => {
      if (prev[selectedId] === at) return prev;
      const next = { ...prev, [selectedId]: at };
      try {
        window.localStorage.setItem(SEEN_INBOX_KEY, JSON.stringify(next));
      } catch {
        /* the dot still clears for this page load */
      }
      return next;
    });
  }, [selectedId, selected?.lastMessageAt]);

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
    autoHandledInboundIdRef.current = null;
    suggestInFlightRef.current = false;
    suggestGenerationRef.current += 1;
    if (status?.configured && selectedId) {
      void loadMessages(selectedId);
    } else {
      setMessages([]);
    }
    setSelectedMessage(null);
    programmaticDraftRef.current = null;
    setDraft("");
    setTranscribing(false);
    setSuggesting(false);
    setSuggestionMeta(null);
    setRouteBadge(null);
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

  /**
   * Select an inbound message into the composer (transcribe audio if needed).
   * Returns the text placed in the box, or "" when nothing usable.
   */
  async function prepareInboundSelection(
    message: ChatMessage,
  ): Promise<string> {
    if (message.direction !== "inbound") return "";
    setSelectedMessage(message);
    setSuggestionMeta(null);
    setRouteBadge(null);
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
          return "";
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
        return transcribed;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Transcription failed",
        );
        return "";
      } finally {
        setTranscribing(false);
      }
    }

    const boxText = inboundComposerText(message);
    setDraft(boxText);
    if (boxText) {
      void rememberSnippet({
        role: "human",
        content: boxText,
        messageId: message.id,
      });
    }
    if (message.kind !== "text" && message.kind !== "audio") {
      setError(
        `Messaggio ${message.kind}: nessun testo da copiare. Solo testo e audio/vocali sono supportati nel box.`,
      );
    }
    return boxText;
  }

  async function handleSelectMessage(message: ChatMessage) {
    if (message.direction !== "inbound") return;
    // Manual select is an override: do not auto-re-run for this id.
    autoHandledInboundIdRef.current = autoHandleKey(message.id);
    suggestGenerationRef.current += 1;
    suggestInFlightRef.current = false;
    await prepareInboundSelection(message);
  }

  function applyComposerDraft(next: string) {
    programmaticDraftRef.current = next;
    setDraft(next);
  }

  function foodLocalDraft(
    text: string,
    sourceMessage?: ChatMessage | null,
  ): {
    draft: string;
    label: string;
    summary: string;
  } | null {
    const priorTexts = messages
      .filter(
        (message) => !sourceMessage || message.id !== sourceMessage.id,
      )
      .map((message) => message.text.trim())
      .filter(Boolean)
      .slice(-40);
    const mealAsk = mealChoiceFollowUp(text, priorTexts);
    const dishCtx = mealDishContext(text, priorTexts, selected?.displayName);
    const listed = ingredientMealQuestion(text);
    if (listed) {
      return {
        draft: withFiammettaIntro(listed),
        label: "Pranzo o cena con ingredienti",
        summary: "lista ingredienti",
      };
    }
    if (mealAsk) {
      return {
        draft: withFiammettaIntro(mealAsk),
        label: "Scelta pranzo o cena",
        summary: "scelta pranzo o cena",
      };
    }
    if (!dishCtx?.dish) return null;
    return {
      draft: withFiammettaIntro(
        buildDishDraft(dishCtx.meal, dishCtx.dish, dishCtx.ingredients),
      ),
      label: "Proposta piatto",
      summary: `${dishCtx.meal} · ${dishCtx.dish}`,
    };
  }

  function showFoodLocalDraft(
    localDraft: { draft: string; label: string; summary: string },
    source: "auto" | "manual",
    preview: string,
  ) {
    const foodBadge = fiammettaRouteLabel("Cibo");
    applyComposerDraft(localDraft.draft);
    setRouteBadge({ label: foodBadge, specialistId: "food" });
    setSuggestionMeta(
      [
        source === "auto" ? "Bozza automatica" : null,
        foodBadge,
        preview ? `msg “${preview}”` : null,
        localDraft.label,
        localDraft.summary,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    setError(null);
    setSuggesting(false);
  }

  async function runSuggestReply(params: {
    text: string;
    source: "auto" | "manual";
    sourceMessage?: ChatMessage | null;
    generation: number;
  }) {
    const text = params.text.trim();
    if (!text || transcribing) return;

    const localDraft = foodLocalDraft(text, params.sourceMessage);
    if (localDraft) {
      const preview = shortPreview(
        params.sourceMessage
          ? inboundComposerText(params.sourceMessage) || text
          : text,
      );
      showFoodLocalDraft(localDraft, params.source, preview);
      return;
    }

    const priorTexts = messages
      .filter(
        (message) =>
          !params.sourceMessage || message.id !== params.sourceMessage.id,
      )
      .map((message) => message.text.trim())
      .filter(Boolean)
      .slice(-40);

    if (suggestInFlightRef.current) return;

    suggestInFlightRef.current = true;
    setSuggesting(true);
    setError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), SUGGEST_TIMEOUT_MS);
    try {
      const health = await loadOllamaHealth();
      if (params.generation !== suggestGenerationRef.current) return;
      if (!health || (health.provider === "ollama" && !health.ok)) {
        setError(health?.message || OLLAMA_TIMEOUT_MESSAGE);
        return;
      }
      const res = await fetch("/api/messages/suggest-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          contactKey: memoryContactKey,
          conversationId: selectedId,
          contactDisplayName: selected?.displayName,
          priorTexts,
        }),
        signal: controller.signal,
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
          autoEligible?: boolean;
          specialistId?: string;
          specialistLabel?: string;
          routeLabel?: string;
          skipped?: boolean;
        };
        error?: { message?: string; provider?: string };
      };
      if (params.generation !== suggestGenerationRef.current) return;
      if (!res.ok) {
        setError(
          data.error?.message ||
            `Suggest reply failed (HTTP ${res.status})`,
        );
        return;
      }
      const suggestion = data.suggestion;
      const templateId = suggestion?.templateId || "";
      const autoEligible =
        suggestion?.autoEligible === true ||
        (suggestion?.autoEligible == null &&
          AUTO_DRAFT_TEMPLATE_IDS.has(templateId));
      const badge = suggestion?.routeLabel
        ? {
            label: suggestion.routeLabel,
            specialistId: suggestion.specialistId || "generic",
          }
        : null;
      const preview = shortPreview(
        params.sourceMessage
          ? inboundComposerText(params.sourceMessage) || text
          : text,
      );

      if (!suggestion?.draft) {
        setRouteBadge(badge);
        if (suggestion?.skipped) {
          setSuggestionMeta(
            [badge?.label, "bozza non disponibile"].filter(Boolean).join(" · "),
          );
          return;
        }
        setError("Reply agent returned an empty draft");
        return;
      }

      if (params.source === "auto" && !autoEligible) {
        // Keep inbound text. Generic ack is manual-only.
        setRouteBadge(badge);
        setSuggestionMeta(
          [
            badge?.label,
            "Bozza automatica saltata",
            preview ? `msg “${preview}”` : null,
            suggestion.templateLabel || suggestion.specialistLabel || templateId,
            "nessuna auto-bozza — usa Suggerisci",
          ]
            .filter(Boolean)
            .join(" · "),
        );
        return;
      }

      setDraft(suggestion.draft);
      setRouteBadge(badge);
      setSuggestionMeta(
        [
          params.source === "auto" ? "Bozza automatica" : null,
          badge?.label,
          preview ? `msg “${preview}”` : null,
          suggestion.provider,
          suggestion.templateLabel || suggestion.specialistLabel,
          suggestion.intentSummary,
          suggestion.model ? `model ${suggestion.model}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (err) {
      if (params.generation !== suggestGenerationRef.current) return;
      setSuggesting(false);
      setError(visibleClientError(err, "Suggest reply failed"));
    } finally {
      window.clearTimeout(timer);
      if (params.generation === suggestGenerationRef.current) {
        suggestInFlightRef.current = false;
        setSuggesting(false);
      }
      void loadOllamaHealth();
    }
  }

  async function handleSuggestReply() {
    const text = draft.trim();
    if (!text) return;
    const generation = ++suggestGenerationRef.current;
    await runSuggestReply({
      text,
      source: "manual",
      sourceMessage: selectedMessage,
      generation,
    });
  }

  async function runAutoDraft(message: ChatMessage) {
    if (message.direction !== "inbound") return;
    const handleKey = autoHandleKey(message.id);
    if (autoHandledInboundIdRef.current === handleKey) return;
    autoHandledInboundIdRef.current = handleKey;
    const generation = ++suggestGenerationRef.current;

    const inbound = inboundComposerText(message);
    const localDraft = inbound ? foodLocalDraft(inbound, message) : null;
    if (localDraft) {
      if (generation !== suggestGenerationRef.current) return;
      setSelectedMessage(message);
      showFoodLocalDraft(
        localDraft,
        "auto",
        shortPreview(inbound),
      );
      return;
    }

    const text = await prepareInboundSelection(message);
    if (generation !== suggestGenerationRef.current) return;
    if (!text.trim()) return;

    await runSuggestReply({
      text,
      source: "auto",
      sourceMessage: message,
      generation,
    });
  }

  // Auto-select latest inbound + draft when conversation opens or a new inbound arrives.
  useEffect(() => {
    if (!selectedId || messages.length === 0) return;
    const versionChanged = autoDraftVersionRef.current !== AUTO_DRAFT_VERSION;
    if (versionChanged) {
      autoDraftVersionRef.current = AUTO_DRAFT_VERSION;
      autoHandledInboundIdRef.current = null;
      suggestGenerationRef.current += 1;
      suggestInFlightRef.current = false;
      setSuggesting(false);
    }
    if (!versionChanged && (suggesting || transcribing || sending)) return;
    if (transcribing || sending) return;

    const latest = findLatestInbound(messages);
    if (!latest) return;
    if (autoHandledInboundIdRef.current === autoHandleKey(latest.id)) return;

    void runAutoDraft(latest);
    // Intentionally omit runAutoDraft from deps — stable closure via refs/state above.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll-driven; guard via autoHandledInboundIdRef
  }, [messages, selectedId, composerEpoch, suggesting, transcribing, sending]);

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
        setRouteBadge(null);
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

  const generatingLabel =
    ollamaHealth?.provider === "claude"
      ? "Fiammetta sta generando…"
      : ollamaHealth?.provider === "openai"
        ? "Fiammetta sta generando… OpenAI sta scrivendo"
        : "Fiammetta sta generando… Ollama sta scrivendo";
  const statusLabel = transcribing
    ? "Trascrizione…"
    : suggesting
      ? generatingLabel
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
          unseenIds={
            new Set(
              conversations
                .filter((conversation) =>
                  hasUnseenMessage(conversation, seenInboxAt, selectedId),
                )
                .map((conversation) => conversation.id),
            )
          }
          onSelect={(id) => {
            autoHandledInboundIdRef.current = null;
            programmaticDraftRef.current = null;
            suggestInFlightRef.current = false;
            suggestGenerationRef.current += 1;
            setDraft("");
            setSuggestionMeta(null);
            setRouteBadge(null);
            setComposerEpoch((epoch) => epoch + 1);
            setSelectedId(id);
          }}
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
          fieldName={`reply-${selectedId ?? "none"}-${composerEpoch}`}
          onTextChange={(value) => {
            const locked = programmaticDraftRef.current;
            if (locked !== null && value !== locked) return;
            programmaticDraftRef.current = null;
            setDraft(value);
            if (suggestionMeta) setSuggestionMeta(null);
          }}
          onFocus={() => {
            programmaticDraftRef.current = null;
          }}
          selectedLabel={selectedLabel}
          statusLabel={statusLabel}
          suggestionMeta={suggestionMeta}
          routeLabel={routeBadge?.label ?? null}
          specialistId={routeBadge?.specialistId ?? null}
          onClearSelection={() => {
            suggestGenerationRef.current += 1;
            suggestInFlightRef.current = false;
            // Keep autoHandled id so poll does not immediately re-draft.
            setSelectedMessage(null);
            programmaticDraftRef.current = null;
            setDraft("");
            setTranscribing(false);
            setSuggesting(false);
            setSuggestionMeta(null);
            setRouteBadge(null);
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

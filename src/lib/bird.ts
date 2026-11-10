import crypto from "crypto";
import type {
  ChatMessage,
  Conversation,
  MessageStatus,
  ServiceWindowStatus,
} from "./types";

export type BirdErrorEnvelope = {
  type?: string;
  code?: string;
  name?: string;
  message?: string;
  doc_url?: string;
  request_id?: string;
  details?: Array<{ param?: string; message?: string }>;
  vendor_code?: string;
};

export class BirdApiError extends Error {
  status: number;
  body: unknown;
  code?: string;
  type?: string;
  errorName?: string;
  docUrl?: string;
  requestId?: string;
  details?: BirdErrorEnvelope["details"];
  /** Raw Bird `error.message` when present. */
  birdMessage?: string;

  constructor(
    message: string,
    status: number,
    body: unknown,
    fields?: Partial<
      Pick<
        BirdApiError,
        | "code"
        | "type"
        | "errorName"
        | "docUrl"
        | "requestId"
        | "details"
        | "birdMessage"
      >
    >,
  ) {
    super(message);
    this.name = "BirdApiError";
    this.status = status;
    this.body = body;
    this.code = fields?.code;
    this.type = fields?.type;
    this.errorName = fields?.errorName;
    this.docUrl = fields?.docUrl;
    this.requestId = fields?.requestId;
    this.details = fields?.details;
    this.birdMessage = fields?.birdMessage;
  }

  /** JSON shape returned by our Route Handlers. */
  toJson() {
    return {
      message: this.message,
      status: this.status,
      code: this.code ?? null,
      type: this.type ?? null,
      name: this.errorName ?? null,
      bird_message: this.birdMessage ?? null,
      doc_url: this.docUrl ?? null,
      request_id: this.requestId ?? null,
      details: this.details ?? null,
      body: this.body,
    };
  }
}

/** Pull Bird's nested `{ error: { code, message, ... } }` envelope from a response body. */
export function extractBirdErrorEnvelope(body: unknown): BirdErrorEnvelope | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const nested =
    root.error && typeof root.error === "object"
      ? (root.error as Record<string, unknown>)
      : root;

  const code = typeof nested.code === "string" ? nested.code : undefined;
  const message =
    typeof nested.message === "string" ? nested.message : undefined;
  const type = typeof nested.type === "string" ? nested.type : undefined;
  const name = typeof nested.name === "string" ? nested.name : undefined;
  if (!code && !message && !type && !name) return null;

  return {
    type,
    code,
    name,
    message,
    doc_url: typeof nested.doc_url === "string" ? nested.doc_url : undefined,
    request_id:
      typeof nested.request_id === "string" ? nested.request_id : undefined,
    details: Array.isArray(nested.details)
      ? (nested.details as BirdErrorEnvelope["details"])
      : undefined,
    vendor_code:
      typeof nested.vendor_code === "string" ? nested.vendor_code : undefined,
  };
}

export function isServiceWindowClosedError(
  err: Pick<BirdApiError, "code" | "errorName" | "birdMessage" | "message">,
): boolean {
  if (err.code === "E15044") return true;
  if (err.errorName === "WhatsAppServiceWindowClosed") return true;
  const haystack = `${err.birdMessage || ""} ${err.message || ""}`.toLowerCase();
  return (
    haystack.includes("service window") ||
    haystack.includes("customer service window")
  );
}

/**
 * User-facing send error. For E15044, bilingual IT/EN guidance.
 * Always includes Bird code when known.
 */
export function formatBirdSendError(err: BirdApiError): string {
  const codePart = err.code ? `[${err.code}]` : null;
  if (isServiceWindowClosedError(err)) {
    return [
      "IT: Finestra di servizio WhatsApp (24h) chiusa — serve un messaggio in ingresso dal contatto, oppure un template approvato su Bird.",
      "EN: 24-hour customer service window is closed — wait for an inbound message from the contact, or send an approved template from Bird.",
      [codePart, err.errorName, err.birdMessage].filter(Boolean).join(" — ") ||
        null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const birdPart = err.birdMessage || err.message || `Bird API HTTP ${err.status}`;
  const namePart = err.errorName ? ` (${err.errorName})` : "";
  const codeSuffix = codePart ? ` ${codePart}` : "";
  return `${birdPart}${namePart}${codeSuffix}`;
}

export function birdApiErrorFromResponse(
  status: number,
  body: unknown,
): BirdApiError {
  const envelope = extractBirdErrorEnvelope(body);
  const birdMessage = envelope?.message;
  const provisional = new BirdApiError(
    birdMessage || `Bird API HTTP ${status}`,
    status,
    body,
    {
      code: envelope?.code,
      type: envelope?.type,
      errorName: envelope?.name,
      docUrl: envelope?.doc_url,
      requestId: envelope?.request_id,
      details: envelope?.details,
      birdMessage,
    },
  );
  return new BirdApiError(formatBirdSendError(provisional), status, body, {
    code: provisional.code,
    type: provisional.type,
    errorName: provisional.errorName,
    docUrl: provisional.docUrl,
    requestId: provisional.requestId,
    details: provisional.details,
    birdMessage: provisional.birdMessage,
  });
}

export function getBirdConfig() {
  const apiKey = process.env.BIRD_API_KEY?.trim() || "";
  const explicitBase = process.env.BIRD_API_BASE_URL?.trim() || "";
  const phoneNumber =
    process.env.BIRD_WHATSAPP_PHONE_NUMBER?.trim() || "+393337802795";
  const numberId =
    process.env.BIRD_WHATSAPP_NUMBER_ID?.trim() ||
    "wan_01m5n2ffp9e019bnda2e60s4z9";
  const webhookSecret = process.env.BIRD_WEBHOOK_SECRET?.trim() || "";
  const workspaceId = process.env.BIRD_WORKSPACE_ID?.trim() || "";

  return {
    apiKey,
    baseUrl: explicitBase || deriveBaseUrl(apiKey),
    phoneNumber,
    numberId,
    webhookSecret,
    workspaceId,
  };
}

/** Derive regional host from `bk_{region}_…` / `bm_{region}_…` key prefixes. */
export function deriveBaseUrl(apiKey: string): string {
  const match = apiKey.match(/^b[km]_([a-z0-9]+)_/i);
  if (match?.[1]) {
    return `https://${match[1].toLowerCase()}.platform.bird.com`;
  }
  // Safe default for the Codeninja workspace region when key is missing.
  return "https://us1.platform.bird.com";
}

export function getConfigStatus() {
  const cfg = getBirdConfig();
  const missing: string[] = [];
  if (!cfg.apiKey) missing.push("BIRD_API_KEY");
  if (!cfg.phoneNumber) missing.push("BIRD_WHATSAPP_PHONE_NUMBER");
  return {
    configured: missing.length === 0,
    missing,
    phoneNumber: cfg.phoneNumber,
    numberId: cfg.numberId,
    baseUrl: cfg.baseUrl,
    workspaceHint: cfg.workspaceId || "bound by workspace API key",
  };
}

type BirdListResponse<T> = {
  data?: T[];
  next_cursor?: string | null;
  prev_cursor?: string | null;
  refresh_cursor?: string | null;
};

type BirdConversation = {
  id: string;
  business_phone_number?: string | null;
  recipient?: {
    bsuid?: string | null;
    phone_number?: string | null;
    display_name?: string | null;
    username?: string | null;
    group_id?: string;
  };
  inbox_status?: "open" | "resolved";
  service_window?: {
    status?: ServiceWindowStatus;
    ends_at?: string | null;
  } | null;
  last_message?: {
    id?: string;
    direction?: "inbound" | "outbound";
    created_at?: string;
  } | null;
  unread_count?: number;
  updated_at?: string;
  created_at?: string;
};

type BirdMessage = {
  id: string;
  direction?: "inbound" | "outbound";
  status?: string;
  created_at?: string;
  text?: { body?: string } | null;
  image?: { caption?: string | null } | null;
  document?: { caption?: string | null; filename?: string | null } | null;
  interactive?: unknown;
  template?: unknown;
  from?: {
    phone_number?: string | null;
    bsuid?: string | null;
    display_name?: string | null;
  };
  to?: {
    phone_number?: string | null;
    bsuid?: string | null;
  };
  error?: { message?: string; code?: string } | null;
};

async function birdFetch<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, string | undefined> },
): Promise<T> {
  const cfg = getBirdConfig();
  if (!cfg.apiKey) {
    throw new BirdApiError(
      "Missing BIRD_API_KEY — copy .env.example to .env.local and add a workspace API key with whatsapp:write",
      503,
      { code: "missing_bird_api_key" },
    );
  }

  const url = new URL(path, cfg.baseUrl.endsWith("/") ? cfg.baseUrl : `${cfg.baseUrl}/`);
  if (init?.query) {
    for (const [key, value] of Object.entries(init.query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }
  }

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${cfg.apiKey}`);
  headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (cfg.workspaceId) {
    headers.set("X-Workspace-Id", cfg.workspaceId);
  }

  const rest = { ...(init || {}) };
  delete rest.query;
  const response = await fetch(url, { ...rest, headers, cache: "no-store" });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    throw birdApiErrorFromResponse(response.status, body);
  }

  return body as T;
}

function contactAddress(conversation: BirdConversation): string {
  const r = conversation.recipient;
  return (
    r?.phone_number ||
    r?.bsuid ||
    r?.group_id ||
    conversation.id
  );
}

function contactDisplayName(conversation: BirdConversation): string {
  const r = conversation.recipient;
  return (
    r?.display_name ||
    r?.username ||
    r?.phone_number ||
    r?.bsuid ||
    r?.group_id ||
    "Unknown"
  );
}

function mapStatus(status: string | undefined): MessageStatus {
  switch (status) {
    case "received":
    case "accepted":
    case "sent":
    case "delivered":
    case "read":
    case "failed":
    case "rejected":
      return status;
    default:
      return status ? "unknown" : "unknown";
  }
}

function extractText(message: BirdMessage): string {
  if (message.text?.body) return message.text.body;
  if (message.image?.caption) return `[image] ${message.image.caption}`;
  if (message.document?.filename) {
    return `[document] ${message.document.filename}`;
  }
  if (message.document?.caption) return `[document] ${message.document.caption}`;
  if (message.template) return "[template message]";
  if (message.interactive) return "[interactive message]";
  return "[unsupported message type]";
}

export function mapConversation(raw: BirdConversation): Conversation {
  return {
    id: raw.id,
    contactAddress: contactAddress(raw),
    displayName: contactDisplayName(raw),
    lastMessageAt:
      raw.last_message?.created_at ||
      raw.updated_at ||
      raw.created_at ||
      new Date().toISOString(),
    lastMessagePreview: raw.last_message
      ? `${raw.last_message.direction === "inbound" ? "←" : "→"} ${raw.last_message.id}`
      : "No messages yet",
    unreadCount: raw.unread_count ?? 0,
    inboxStatus: raw.inbox_status || "open",
    serviceWindowStatus: raw.service_window?.status ?? null,
    serviceWindowEndsAt: raw.service_window?.ends_at ?? null,
  };
}

export function mapMessage(
  raw: BirdMessage,
  conversationId: string,
): ChatMessage {
  return {
    id: raw.id,
    conversationId,
    direction: raw.direction === "outbound" ? "outbound" : "inbound",
    text: extractText(raw),
    timestamp: raw.created_at || new Date().toISOString(),
    status: mapStatus(raw.status),
    error: raw.error?.message,
  };
}

export async function listConversations(options?: {
  limit?: number;
  startingAfter?: string;
  inboxStatus?: "open" | "resolved";
}): Promise<{ conversations: Conversation[]; nextCursor: string | null }> {
  const cfg = getBirdConfig();
  const response = await birdFetch<BirdListResponse<BirdConversation>>(
    "/v1/whatsapp/conversations",
    {
      method: "GET",
      query: {
        business_phone_number: cfg.phoneNumber,
        limit: String(options?.limit ?? 50),
        starting_after: options?.startingAfter,
        inbox_status: options?.inboxStatus,
      },
    },
  );

  const conversations = (response.data || []).map(mapConversation);
  return {
    conversations,
    nextCursor: response.next_cursor ?? null,
  };
}

export async function getConversation(
  conversationId: string,
): Promise<Conversation> {
  const raw = await birdFetch<BirdConversation>(
    `/v1/whatsapp/conversations/${encodeURIComponent(conversationId)}`,
    { method: "GET" },
  );
  return mapConversation(raw);
}

export async function listConversationMessages(
  conversationId: string,
  options?: { limit?: number; startingAfter?: string },
): Promise<{ messages: ChatMessage[]; nextCursor: string | null }> {
  const response = await birdFetch<BirdListResponse<BirdMessage>>(
    `/v1/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "GET",
      query: {
        limit: String(options?.limit ?? 50),
        starting_after: options?.startingAfter,
      },
    },
  );

  // Bird returns newest first; UI expects chronological oldest → newest.
  const messages = (response.data || [])
    .map((m) => mapMessage(m, conversationId))
    .reverse();

  return {
    messages,
    nextCursor: response.next_cursor ?? null,
  };
}

export async function sendTextMessage(params: {
  to: string;
  text: string;
  from?: string;
}): Promise<ChatMessage> {
  const cfg = getBirdConfig();
  const from = params.from || cfg.phoneNumber;
  const raw = await birdFetch<BirdMessage>("/v1/whatsapp/messages", {
    method: "POST",
    body: JSON.stringify({
      to: params.to,
      from,
      text: { body: params.text },
    }),
  });

  return {
    id: raw.id,
    conversationId: "",
    direction: "outbound",
    text: params.text,
    timestamp: raw.created_at || new Date().toISOString(),
    status: mapStatus(raw.status) || "accepted",
  };
}

/**
 * Standard Webhooks verification (Bird).
 * Signature is HMAC-SHA256 over `{id}.{timestamp}.{rawBody}` with key bytes
 * from `whsec_…` (base64 after the prefix). Skipped when secret is unset (local scaffold).
 */
export function verifyBirdWebhookSignature(params: {
  rawBody: string;
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
}): boolean {
  const { webhookSecret } = getBirdConfig();
  if (!webhookSecret) {
    console.warn(
      "[webhook] BIRD_WEBHOOK_SECRET not set — skipping signature check (dev only)",
    );
    return true;
  }
  if (
    !params.webhookId ||
    !params.webhookTimestamp ||
    !params.webhookSignature
  ) {
    return false;
  }

  const ageSec = Math.abs(
    Date.now() / 1000 - Number(params.webhookTimestamp),
  );
  if (!Number.isFinite(ageSec) || ageSec > 300) {
    return false;
  }

  const secret = webhookSecret.startsWith("whsec_")
    ? webhookSecret.slice("whsec_".length)
    : webhookSecret;
  let key: Buffer;
  try {
    key = Buffer.from(secret, "base64");
  } catch {
    return false;
  }

  const signed = `${params.webhookId}.${params.webhookTimestamp}.${params.rawBody}`;
  const expected = crypto.createHmac("sha256", key).update(signed).digest("base64");

  return params.webhookSignature.split(" ").some((part) => {
    const value = part.startsWith("v1,") ? part.slice(3) : part;
    try {
      const a = Buffer.from(value);
      const b = Buffer.from(expected);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

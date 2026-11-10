export type MessageDirection = "inbound" | "outbound";

export type MessageStatus =
  | "received"
  | "sent"
  | "failed"
  | "delivered"
  | "read";

export type SessionStatus =
  | "starting"
  | "qr"
  | "connecting"
  | "ready"
  | "disconnected"
  | "logged_out";

export interface ChatMessage {
  id: string;
  waId: string;
  direction: MessageDirection;
  text: string;
  timestamp: string;
  status: MessageStatus;
  error?: string;
}

export interface Conversation {
  waId: string;
  displayName: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
}

export interface SessionSnapshot {
  status: SessionStatus;
  qrDataUrl: string | null;
  me: { id: string; name?: string } | null;
  lastError: string | null;
}

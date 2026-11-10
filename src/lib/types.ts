export type MessageDirection = "inbound" | "outbound";

export type MessageStatus =
  | "received"
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "rejected"
  | "unknown";

export type ServiceWindowStatus = "open" | "closed";

export interface ChatMessage {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  text: string;
  timestamp: string;
  status: MessageStatus;
  error?: string;
}

export interface Conversation {
  id: string;
  /** Contact phone (E.164) when known; otherwise BSUID or group id. */
  contactAddress: string;
  displayName: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  inboxStatus: "open" | "resolved";
  serviceWindowStatus: ServiceWindowStatus | null;
  serviceWindowEndsAt: string | null;
}

export interface SendMessageRequest {
  /** Bird conversation id (`wacv_…`). Preferred when replying from the inbox. */
  conversationId?: string;
  /** Recipient E.164 or BSUID. Required when conversationId is omitted. */
  to?: string;
  text: string;
}

export interface BirdConfigStatus {
  configured: boolean;
  missing: string[];
  phoneNumber: string;
  numberId: string;
  baseUrl: string;
  workspaceHint: string;
}

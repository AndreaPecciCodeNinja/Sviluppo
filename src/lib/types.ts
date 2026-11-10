export type MessageDirection = "inbound" | "outbound";

export type MessageStatus = "received" | "sent" | "failed" | "delivered" | "read";

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

export interface StoreData {
  conversations: Conversation[];
  messages: ChatMessage[];
}

export interface SendMessageRequest {
  to: string;
  text: string;
}

export interface MetaTextSendResponse {
  messaging_product?: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
  error?: {
    message: string;
    type?: string;
    code?: number;
    error_data?: { details?: string };
  };
}

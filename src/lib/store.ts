import { promises as fs } from "fs";
import path from "path";
import type { ChatMessage, Conversation, StoreData } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const emptyStore = (): StoreData => ({
  conversations: [],
  messages: [],
});

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<StoreData> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoreData;
    return {
      conversations: parsed.conversations ?? [],
      messages: parsed.messages ?? [],
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return emptyStore();
    }
    throw err;
  }
}

async function writeStore(data: StoreData): Promise<void> {
  await ensureDir();
  await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export async function listConversations(): Promise<Conversation[]> {
  const store = await readStore();
  return [...store.conversations].sort((a, b) =>
    b.lastMessageAt.localeCompare(a.lastMessageAt),
  );
}

export async function listMessages(waId: string): Promise<ChatMessage[]> {
  const store = await readStore();
  return store.messages
    .filter((m) => m.waId === waId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function upsertInboundMessage(input: {
  id: string;
  waId: string;
  displayName?: string;
  text: string;
  timestamp: string;
}): Promise<ChatMessage | null> {
  const store = await readStore();
  if (store.messages.some((m) => m.id === input.id)) {
    return null;
  }

  const message: ChatMessage = {
    id: input.id,
    waId: input.waId,
    direction: "inbound",
    text: input.text,
    timestamp: input.timestamp,
    status: "received",
  };

  store.messages.push(message);

  const existing = store.conversations.find((c) => c.waId === input.waId);
  if (existing) {
    existing.lastMessageAt = input.timestamp;
    existing.lastMessagePreview = input.text;
    existing.unreadCount += 1;
    if (input.displayName) {
      existing.displayName = input.displayName;
    }
  } else {
    store.conversations.push({
      waId: input.waId,
      displayName: input.displayName || input.waId,
      lastMessageAt: input.timestamp,
      lastMessagePreview: input.text,
      unreadCount: 1,
    });
  }

  await writeStore(store);
  return message;
}

export async function appendOutboundMessage(input: {
  id: string;
  waId: string;
  text: string;
  timestamp: string;
  status: ChatMessage["status"];
  error?: string;
}): Promise<ChatMessage> {
  const store = await readStore();

  const message: ChatMessage = {
    id: input.id,
    waId: input.waId,
    direction: "outbound",
    text: input.text,
    timestamp: input.timestamp,
    status: input.status,
    error: input.error,
  };

  store.messages.push(message);

  const existing = store.conversations.find((c) => c.waId === input.waId);
  if (existing) {
    existing.lastMessageAt = input.timestamp;
    existing.lastMessagePreview = input.text;
  } else {
    store.conversations.push({
      waId: input.waId,
      displayName: input.waId,
      lastMessageAt: input.timestamp,
      lastMessagePreview: input.text,
      unreadCount: 0,
    });
  }

  await writeStore(store);
  return message;
}

export async function markConversationRead(waId: string): Promise<void> {
  const store = await readStore();
  const conversation = store.conversations.find((c) => c.waId === waId);
  if (!conversation) return;
  conversation.unreadCount = 0;
  await writeStore(store);
}

export async function updateMessageStatus(
  wamid: string,
  status: ChatMessage["status"],
): Promise<void> {
  const store = await readStore();
  const message = store.messages.find((m) => m.id === wamid);
  if (!message) return;
  message.status = status;
  await writeStore(store);
}

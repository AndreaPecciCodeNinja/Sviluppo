import { appendMessage, listRecentMessages } from "./store";
import { getMemoryMaxMessages } from "./db";

/**
 * Minimal chat message shape compatible with LangChain's BaseMessage.getType()
 * / .content usage. Avoids a hard runtime import of `@langchain/core` so API
 * routes (and Turbopack) do not fail when that package's export map mis-resolves.
 */
export type MemoryChatMessage = {
  getType: () => "human" | "ai" | "system";
  content: string;
};

function humanMessage(content: string): MemoryChatMessage {
  return { getType: () => "human", content };
}

function aiMessage(content: string): MemoryChatMessage {
  return { getType: () => "ai", content };
}

function systemMessage(content: string): MemoryChatMessage {
  return { getType: () => "system", content };
}

/**
 * LangChain-compatible chat message history backed by local SQLite
 * (`.data/memory.sqlite` by default).
 *
 * Duck-types `BaseListChatMessageHistory` (getMessages / addMessage / clear)
 * without extending `@langchain/core` classes — wire this into a real LangChain
 * chain later by mapping `MemoryChatMessage` ↔ LangChain `BaseMessage`.
 */
export class SqliteChatMessageHistory {
  lc_namespace = ["bird_inbox", "memory", "sqlite"];

  private contactKey: string;
  private conversationId: string | null;

  constructor(params: {
    contactKey: string;
    conversationId?: string | null;
  }) {
    this.contactKey = params.contactKey;
    this.conversationId = params.conversationId ?? null;
  }

  async getMessages(): Promise<MemoryChatMessage[]> {
    const rows = listRecentMessages(this.contactKey, getMemoryMaxMessages());
    return rows.map((row) => {
      if (row.role === "ai") return aiMessage(row.content);
      if (row.role === "system") return systemMessage(row.content);
      return humanMessage(row.content);
    });
  }

  async addMessage(message: MemoryChatMessage): Promise<void> {
    const type = message.getType();
    const role =
      type === "ai" ? "ai" : type === "system" ? "system" : "human";
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);

    appendMessage({
      contactKey: this.contactKey,
      conversationId: this.conversationId,
      role,
      content,
    });
  }

  async addUserMessage(message: string): Promise<void> {
    await this.addMessage(humanMessage(message));
  }

  async addAIMessage(message: string): Promise<void> {
    await this.addMessage(aiMessage(message));
  }

  async clear(): Promise<void> {
    const { getMemoryDb } = await import("./db");
    getMemoryDb()
      .prepare(`DELETE FROM memory_messages WHERE contact_key = ?`)
      .run(this.contactKey);
  }
}

export function createContactMemoryHistory(
  contactKey: string,
  conversationId?: string | null,
): SqliteChatMessageHistory {
  return new SqliteChatMessageHistory({ contactKey, conversationId });
}

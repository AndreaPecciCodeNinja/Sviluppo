import { BaseListChatMessageHistory } from "@langchain/core/chat_history";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { appendMessage, listRecentMessages } from "./store";
import { getMemoryMaxMessages } from "./db";

/**
 * LangChain-compatible chat message history backed by local SQLite
 * (`.data/memory.sqlite` by default).
 */
export class SqliteChatMessageHistory extends BaseListChatMessageHistory {
  lc_namespace = ["bird_inbox", "memory", "sqlite"];

  private contactKey: string;
  private conversationId: string | null;

  constructor(params: {
    contactKey: string;
    conversationId?: string | null;
  }) {
    super();
    this.contactKey = params.contactKey;
    this.conversationId = params.conversationId ?? null;
  }

  async getMessages(): Promise<BaseMessage[]> {
    const rows = listRecentMessages(this.contactKey, getMemoryMaxMessages());
    return rows.map((row) => {
      if (row.role === "ai") return new AIMessage(row.content);
      if (row.role === "system") return new SystemMessage(row.content);
      return new HumanMessage(row.content);
    });
  }

  async addMessage(message: BaseMessage): Promise<void> {
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
    await this.addMessage(new HumanMessage(message));
  }

  async addAIMessage(message: string): Promise<void> {
    await this.addMessage(new AIMessage(message));
  }

  async clear(): Promise<void> {
    // Soft clear: not exposed in UI v1; delete via raw SQL if needed later.
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

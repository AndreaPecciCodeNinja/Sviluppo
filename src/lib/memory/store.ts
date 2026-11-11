import {
  getMemoryDb,
  getMemoryMaxMessages,
  type MemoryFactRow,
  type MemoryMessageRow,
} from "./db";

export type MemoryFact = {
  id: number;
  contactKey: string;
  conversationId: string | null;
  fact: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemorySnippet = {
  id: number;
  contactKey: string;
  conversationId: string | null;
  role: "human" | "ai" | "system";
  content: string;
  messageId: string | null;
  createdAt: string;
};

function mapFact(row: MemoryFactRow): MemoryFact {
  return {
    id: row.id,
    contactKey: row.contact_key,
    conversationId: row.conversation_id,
    fact: row.fact,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MemoryMessageRow): MemorySnippet {
  return {
    id: row.id,
    contactKey: row.contact_key,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    messageId: row.message_id,
    createdAt: row.created_at,
  };
}

export function listFacts(contactKey: string): MemoryFact[] {
  const db = getMemoryDb();
  const rows = db
    .prepare(
      `SELECT * FROM memory_facts
       WHERE contact_key = ?
       ORDER BY updated_at DESC, id DESC`,
    )
    .all(contactKey) as MemoryFactRow[];
  return rows.map(mapFact);
}

export function createFact(params: {
  contactKey: string;
  conversationId?: string | null;
  fact: string;
  source?: string | null;
}): MemoryFact {
  const db = getMemoryDb();
  const fact = params.fact.trim();
  if (!fact) throw new Error("Fact text is required");

  const info = db
    .prepare(
      `INSERT INTO memory_facts (contact_key, conversation_id, fact, source)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      params.contactKey,
      params.conversationId ?? null,
      fact,
      params.source ?? null,
    );

  const row = db
    .prepare(`SELECT * FROM memory_facts WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as MemoryFactRow;
  return mapFact(row);
}

export function updateFact(id: number, fact: string): MemoryFact | null {
  const db = getMemoryDb();
  const trimmed = fact.trim();
  if (!trimmed) throw new Error("Fact text is required");

  const result = db
    .prepare(
      `UPDATE memory_facts
       SET fact = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(trimmed, id);
  if (result.changes === 0) return null;

  const row = db
    .prepare(`SELECT * FROM memory_facts WHERE id = ?`)
    .get(id) as MemoryFactRow;
  return mapFact(row);
}

export function deleteFact(id: number): boolean {
  const db = getMemoryDb();
  const result = db.prepare(`DELETE FROM memory_facts WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function listRecentMessages(
  contactKey: string,
  limit = getMemoryMaxMessages(),
): MemorySnippet[] {
  const db = getMemoryDb();
  const rows = db
    .prepare(
      `SELECT * FROM memory_messages
       WHERE contact_key = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(contactKey, limit) as MemoryMessageRow[];
  return rows.reverse().map(mapMessage);
}

export function appendMessage(params: {
  contactKey: string;
  conversationId?: string | null;
  role: "human" | "ai" | "system";
  content: string;
  messageId?: string | null;
}): MemorySnippet {
  const db = getMemoryDb();
  const content = params.content.trim();
  if (!content) throw new Error("Message content is required");

  if (params.messageId) {
    const existing = db
      .prepare(
        `SELECT * FROM memory_messages
         WHERE contact_key = ? AND message_id = ?`,
      )
      .get(params.contactKey, params.messageId) as MemoryMessageRow | undefined;
    if (existing) return mapMessage(existing);
  }

  const info = db
    .prepare(
      `INSERT INTO memory_messages
         (contact_key, conversation_id, role, content, message_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      params.contactKey,
      params.conversationId ?? null,
      params.role,
      content,
      params.messageId ?? null,
    );

  // Cap growth: keep last 200 per contact
  db.prepare(
    `DELETE FROM memory_messages
     WHERE contact_key = ?
       AND id NOT IN (
         SELECT id FROM memory_messages
         WHERE contact_key = ?
         ORDER BY id DESC
         LIMIT 200
       )`,
  ).run(params.contactKey, params.contactKey);

  const row = db
    .prepare(`SELECT * FROM memory_messages WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as MemoryMessageRow;
  return mapMessage(row);
}

/** Prompt block for the reply agent (facts + recent snippets). */
export function buildMemoryPromptBlock(contactKey: string): string {
  const facts = listFacts(contactKey);
  const messages = listRecentMessages(contactKey);

  if (facts.length === 0 && messages.length === 0) {
    return "";
  }

  const lines: string[] = ["Known memory for this contact (local SQLite):"];

  if (facts.length > 0) {
    lines.push("Facts:");
    for (const f of facts.slice(0, 30)) {
      lines.push(`- ${f.fact}`);
    }
  }

  if (messages.length > 0) {
    lines.push("Recent snippets:");
    for (const m of messages) {
      lines.push(`- [${m.role}] ${m.content}`);
    }
  }

  return lines.join("\n");
}

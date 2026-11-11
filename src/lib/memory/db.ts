import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export type MemoryFactRow = {
  id: number;
  contact_key: string;
  conversation_id: string | null;
  fact: string;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export type MemoryMessageRow = {
  id: number;
  contact_key: string;
  conversation_id: string | null;
  role: "human" | "ai" | "system";
  content: string;
  message_id: string | null;
  created_at: string;
};

let dbSingleton: Database.Database | null = null;

export function getMemoryDbPath(): string {
  return (
    process.env.MEMORY_SQLITE_PATH?.trim() ||
    path.join(process.cwd(), ".data", "memory.sqlite")
  );
}

export function getMemoryMaxMessages(): number {
  const n = Number(process.env.MEMORY_MAX_MESSAGES || 20);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 20;
}

export function getMemoryDb(): Database.Database {
  if (dbSingleton) return dbSingleton;

  const filePath = getMemoryDbPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_key TEXT NOT NULL,
      conversation_id TEXT,
      fact TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_facts_contact
      ON memory_facts(contact_key);

    CREATE TABLE IF NOT EXISTS memory_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_key TEXT NOT NULL,
      conversation_id TEXT,
      role TEXT NOT NULL CHECK(role IN ('human','ai','system')),
      content TEXT NOT NULL,
      message_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_messages_contact
      ON memory_messages(contact_key, id);
  `);

  dbSingleton = db;
  return db;
}

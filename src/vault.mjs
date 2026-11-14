import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Vault di Andrea. Non è nel git: è troppo grande. */
export const DEFAULT_VAULT_PATH =
  "/cursor/stores/bc-bf9078ee-bb07-4134-a754-d6efb764ca4c/internal/vault/Cucina Italiana";

const SKIP_DIRS = new Set([".obsidian", "_strumenti", "__pycache__", "node_modules"]);

export function normalizza(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unquote(value) {
  const trimmed = String(value ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseNota(rel, text) {
  let frontmatter = {};
  let body = text;
  if (text.startsWith("---\n") || text.startsWith("---\r\n")) {
    const end = text.search(/\r?\n---\r?\n/);
    if (end !== -1) {
      const raw = text.slice(text.indexOf("\n") + 1, end);
      body = text.slice(end).replace(/^\r?\n---\r?\n/, "");
      for (const line of raw.split(/\r?\n/)) {
        const match = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
        if (match) frontmatter[match[1]] = unquote(match[2]);
      }
    }
  }
  const heading = /^#\s+(.+)$/m.exec(body);
  const title =
    unquote(frontmatter.title) ||
    heading?.[1]?.trim() ||
    path.basename(rel, ".md");
  return { rel: rel.split(path.sep).join("/"), title, frontmatter, body, text };
}

export async function caricaNote(vaultPath) {
  const root = path.resolve(vaultPath);
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) {
    const error = new Error(`Vault non trovato: ${vaultPath}`);
    error.code = "VAULT_ASSENTE";
    throw error;
  }

  const notes = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (entry.name.toLowerCase() === "index.md") continue;
      const text = await readFile(full, "utf8");
      notes.push(parseNota(path.relative(root, full), text));
    }
  }

  await walk(root);
  return notes;
}

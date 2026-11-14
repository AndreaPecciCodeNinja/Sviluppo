import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `.env.local` accanto al package, non in base alla cartella da cui si lancia il comando. */
export const ENV_LOCAL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.env.local",
);

function valore(raw) {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Carica `.env.local` se esiste. Una variabile già presente in `env` resta com'è.
 * Non stampa i valori.
 */
export async function caricaEnvLocal(env = process.env, filePath = ENV_LOCAL_PATH) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (Object.hasOwn(env, key)) continue;
    env[key] = valore(trimmed.slice(eq + 1));
  }
  return true;
}

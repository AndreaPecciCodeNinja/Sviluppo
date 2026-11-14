import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { caricaEnvLocal } from "./env.mjs";
import { componiMenu } from "./menu.mjs";
import { DEFAULT_VAULT_PATH } from "./vault.mjs";

const pagina = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/index.html");
const html = await readFile(pagina, "utf8");

function leggiCorpo(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 20_000) {
        reject(Object.assign(new Error("Testo troppo lungo."), { code: "TROPPO" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function invia(res, status, body, type) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(body);
}

export function creaServer({ vaultPath, env = process.env, fetchImpl } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      invia(res, 200, html, "text/html; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/stato") {
      invia(res, 200, JSON.stringify({
        vaultPath,
        claude: Boolean(env.ANTHROPIC_API_KEY?.trim()),
      }), "application/json; charset=utf-8");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/menu") {
      try {
        const raw = await leggiCorpo(req);
        const payload = raw ? JSON.parse(raw) : {};
        const result = await componiMenu({
          vaultPath,
          alimenti: payload.alimenti,
          env,
          fetchImpl,
        });
        invia(res, result.ok ? 200 : 422, JSON.stringify({
          ok: result.ok,
          kind: result.kind,
          text: result.text,
          notes: result.notes.map((note) => ({ title: note.title, rel: note.rel })),
        }), "application/json; charset=utf-8");
      } catch (error) {
        const message = error?.code === "TROPPO" || error instanceof SyntaxError
          ? "La richiesta non è valida."
          : "Non sono riuscito a comporre il menù.";
        invia(res, 400, JSON.stringify({ ok: false, kind: "errore", text: message, notes: [] }), "application/json; charset=utf-8");
      }
      return;
    }
    invia(res, 404, "Non trovato", "text/plain; charset=utf-8");
  });
}

const avvioDiretto = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (avvioDiretto) {
  await caricaEnvLocal();
  const vaultPath = process.env.VAULT_PATH?.trim() || DEFAULT_VAULT_PATH;
  const port = Number(process.env.PORT) || 4173;
  const server = creaServer({ vaultPath });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Menù in ascolto su http://127.0.0.1:${port}\nVault: ${vaultPath}\n`);
  });
}

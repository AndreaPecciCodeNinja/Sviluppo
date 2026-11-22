import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BUSINESS_NUMBER, normalizePhone, recipientAddress } from "./phone.mjs";
import { presentAccount, presentConversation, presentMessage } from "./present.mjs";

const CONVERSATION_ID = /^wacv_[A-Za-z0-9]+$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:/-]{8,200}$/;
const MAX_TEXT = 4096;

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
  });
  res.end(JSON.stringify(body));
}

function sendError(res, error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 502;
  sendJson(res, status, { error: error?.message || "Richiesta non riuscita." });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > 16_384) {
        failed = true;
        reject(Object.assign(new Error("Corpo della richiesta troppo grande."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (failed) return;
      if (size === 0) {
        resolve({});
        return;
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          reject(Object.assign(new Error("Il corpo deve essere un oggetto JSON."), { status: 400 }));
          return;
        }
        resolve(value);
      } catch {
        reject(Object.assign(new Error("JSON non valido."), { status: 400 }));
      }
    });
    req.on("error", () => {
      if (!failed) reject(Object.assign(new Error("Richiesta interrotta."), { status: 400 }));
    });
  });
}

function cleanCursor(value) {
  if (value == null || value === "") return undefined;
  const cursor = String(value);
  if (cursor.length > 4000 || /[\u0000-\u001F]/.test(cursor)) {
    throw Object.assign(new Error("Cursore non valido."), { status: 400 });
  }
  return cursor;
}

function cleanQuery(value) {
  if (value == null || value === "") return undefined;
  const query = String(value).trim();
  if (!query) return undefined;
  if (query.length > 200 || /[\u0000-\u001F]/.test(query)) {
    throw Object.assign(new Error("Ricerca non valida."), { status: 400 });
  }
  return query;
}

function cleanText(value) {
  if (typeof value !== "string") {
    throw Object.assign(new Error("Scrivi un messaggio prima di inviarlo."), { status: 400 });
  }
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text) {
    throw Object.assign(new Error("Scrivi un messaggio prima di inviarlo."), { status: 400 });
  }
  if (text.length > MAX_TEXT) {
    throw Object.assign(new Error("Il messaggio supera i 4096 caratteri."), { status: 400 });
  }
  return text;
}

function assertOwnConversation(conversation) {
  if (normalizePhone(conversation?.business_phone_number) !== BUSINESS_NUMBER) {
    throw Object.assign(
      new Error("Questa conversazione non appartiene al numero +39 333 7802795."),
      { status: 403 },
    );
  }
}

async function ownConversation(client, conversationId) {
  let conversation;
  try {
    conversation = await client.getConversation(conversationId);
  } catch (error) {
    if (error.status === 404) {
      throw Object.assign(new Error("Conversazione non trovata."), { status: 404 });
    }
    throw error;
  }
  assertOwnConversation(conversation);
  return conversation;
}

async function serveStatic(res, publicDir, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(publicDir, relative);
  const extension = path.extname(filePath);
  if (!filePath.startsWith(`${publicDir}${path.sep}`) || !STATIC_TYPES[extension]) {
    sendJson(res, 404, { error: "Pagina non trovata." });
    return;
  }
  try {
    await access(filePath);
  } catch {
    sendJson(res, 404, { error: "Pagina non trovata." });
    return;
  }
  res.writeHead(200, {
    "Content-Type": STATIC_TYPES[extension],
    "Content-Language": "it",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
  });
  createReadStream(filePath).pipe(res);
}

export function createHandler({ client, publicDir }) {
  return async function handler(req, res) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/api/session") {
        const account = presentAccount(await client.confirmBusinessNumber());
        sendJson(res, 200, { account });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/conversations") {
        const page = await client.listConversations({
          q: cleanQuery(url.searchParams.get("q")),
          startingAfter: cleanCursor(url.searchParams.get("starting_after")),
          limit: 30,
        });
        sendJson(res, 200, {
          data: (page.data || []).map(presentConversation),
          next_cursor: page.next_cursor || null,
        });
        return;
      }

      const thread = url.pathname.match(/^\/api\/conversations\/([^/]+)(?:\/messages)?$/);
      if (thread) {
        const conversationId = decodeURIComponent(thread[1]);
        if (!CONVERSATION_ID.test(conversationId)) {
          sendJson(res, 400, { error: "Identificativo conversazione non valido." });
          return;
        }
        const messagesRoute = url.pathname.endsWith("/messages");

        if (req.method === "GET" && !messagesRoute) {
          const conversation = await ownConversation(client, conversationId);
          sendJson(res, 200, { conversation: presentConversation(conversation) });
          return;
        }

        if (req.method === "GET" && messagesRoute) {
          await ownConversation(client, conversationId);
          const page = await client.listMessages(conversationId, {
            startingAfter: cleanCursor(url.searchParams.get("starting_after")),
            limit: 40,
          });
          sendJson(res, 200, {
            data: (page.data || []).map(presentMessage),
            next_cursor: page.next_cursor || null,
          });
          return;
        }

        if (req.method === "POST" && messagesRoute) {
          const body = await readJson(req);
          const text = cleanText(body.text);
          const idempotencyKey = body.idempotency_key
            ? String(body.idempotency_key)
            : `whatsapp-text/${randomUUID()}`;
          if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
            sendJson(res, 400, { error: "Chiave di invio non valida." });
            return;
          }

          const account = await client.confirmBusinessNumber();
          if (account.conversations_enabled === false) {
            sendJson(res, 409, { error: "Le conversazioni non sono attive su questo numero." });
            return;
          }
          const conversation = await ownConversation(client, conversationId);
          if (conversation.service_window?.status !== "open") {
            sendJson(res, 422, {
              error: "La finestra di 24 ore è chiusa. Il testo libero si può inviare solo dopo un messaggio del contatto.",
            });
            return;
          }
          const to = recipientAddress(conversation.recipient);
          if (!to) {
            sendJson(res, 422, { error: "Questo contatto non ha un destinatario utilizzabile." });
            return;
          }

          const sent = await client.sendText({ to, body: text, idempotencyKey });
          sendJson(res, 202, { message: presentMessage(sent) });
          return;
        }

        sendJson(res, 405, { error: "Metodo non consentito." });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 404, { error: "Pagina non trovata." });
        return;
      }
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Metodo non consentito." });
        return;
      }
      await serveStatic(res, publicDir, url.pathname);
    } catch (error) {
      if (!res.headersSent) sendError(res, error);
      else res.destroy();
    }
  };
}

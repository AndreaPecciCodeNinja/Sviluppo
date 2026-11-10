import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  getContentType,
  isJidBroadcast,
  isJidGroup,
  isJidStatusBroadcast,
  jidNormalizedUser,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { promises as fs } from "fs";
import path from "path";
import pino from "pino";
import QRCode from "qrcode";
import {
  appendOutboundMessage,
  upsertInboundMessage,
} from "./store";
import type { SessionSnapshot, SessionStatus } from "./types";

const AUTH_DIR =
  process.env.WA_AUTH_DIR || path.join(process.cwd(), ".data", "wa-auth");

const logger = pino({ level: process.env.WA_LOG_LEVEL || "warn" });

let sock: WASocket | null = null;
let starting = false;
let shouldRun = true;
let status: SessionStatus = "starting";
let qrDataUrl: string | null = null;
let me: SessionSnapshot["me"] = null;
let lastError: string | null = null;

function waIdFromJid(jid: string): string {
  return jidNormalizedUser(jid).replace(/@.*$/, "");
}

function toJid(to: string): string {
  const trimmed = to.trim();
  if (trimmed.includes("@")) return jidNormalizedUser(trimmed);
  const digits = trimmed.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

function extractText(message: WAMessage): string | null {
  const content = message.message;
  if (!content) return null;

  if (content.conversation) return content.conversation;
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
  if (content.imageMessage?.caption) return content.imageMessage.caption;
  if (content.videoMessage?.caption) return content.videoMessage.caption;
  if (content.documentMessage?.caption) return content.documentMessage.caption;

  const type = getContentType(content);
  if (!type) return null;
  return `[${String(type).replace(/Message$/, "")}]`;
}

async function handleIncoming(message: WAMessage): Promise<void> {
  const remoteJid = message.key.remoteJid;
  if (!remoteJid) return;
  if (
    isJidGroup(remoteJid) ||
    isJidBroadcast(remoteJid) ||
    isJidStatusBroadcast(remoteJid)
  ) {
    return;
  }
  if (message.key.fromMe) return;

  const text = extractText(message);
  if (!text) return;

  const waId = waIdFromJid(remoteJid);
  const timestampSeconds =
    typeof message.messageTimestamp === "number"
      ? message.messageTimestamp
      : Number(message.messageTimestamp || Date.now() / 1000);

  const displayName = message.pushName || undefined;

  await upsertInboundMessage({
    id: message.key.id || `${waId}-${timestampSeconds}`,
    waId,
    displayName,
    text,
    timestamp: new Date(timestampSeconds * 1000).toISOString(),
  });
}

async function clearAuthDir(): Promise<void> {
  await fs.rm(AUTH_DIR, { recursive: true, force: true });
}

export function getSessionSnapshot(): SessionSnapshot {
  return { status, qrDataUrl, me, lastError };
}

export async function startWhatsApp(): Promise<void> {
  if (starting || sock) return;
  starting = true;
  shouldRun = true;
  status = "starting";
  lastError = null;

  try {
    await fs.mkdir(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      browser: ["Sviluppo Inbox", "Chrome", "1.0.0"],
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        status = "qr";
        qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 2,
          width: 320,
          errorCorrectionLevel: "M",
        });
      }

      if (connection === "connecting") {
        status = qrDataUrl ? "qr" : "connecting";
      }

      if (connection === "open") {
        status = "ready";
        qrDataUrl = null;
        lastError = null;
        const user = sock?.user;
        me = user
          ? { id: waIdFromJid(user.id), name: user.name || user.verifiedName }
          : null;
        logger.info({ me }, "WhatsApp session ready");
      }

      if (connection === "close") {
        const boom = lastDisconnect?.error as Boom | undefined;
        const code = boom?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        sock = null;
        me = loggedOut ? null : me;

        if (loggedOut) {
          status = "logged_out";
          qrDataUrl = null;
          lastError = "Logged out. Scan a new QR code.";
          await clearAuthDir();
          if (shouldRun) {
            starting = false;
            void startWhatsApp();
          }
          return;
        }

        status = "disconnected";
        lastError =
          boom?.message ||
          `Disconnected (code ${code ?? "unknown"}). Reconnecting…`;

        if (shouldRun) {
          starting = false;
          setTimeout(() => {
            void startWhatsApp();
          }, 1500);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const message of messages) {
        try {
          await handleIncoming(message);
        } catch (err) {
          logger.warn({ err }, "Failed to ingest inbound message");
        }
      }
    });
  } catch (err) {
    status = "disconnected";
    lastError = err instanceof Error ? err.message : "Failed to start WhatsApp";
    sock = null;
    throw err;
  } finally {
    starting = false;
  }
}

export async function sendTextMessage(input: {
  to: string;
  text: string;
}): Promise<{ messageId: string; waId: string }> {
  if (!sock || status !== "ready") {
    throw new Error("WhatsApp session is not ready. Scan the QR code first.");
  }

  const text = input.text.trim();
  if (!text) throw new Error("Message text is required");

  const jid = toJid(input.to);
  const waId = waIdFromJid(jid);
  const timestamp = new Date().toISOString();

  try {
    const result = await sock.sendMessage(jid, { text });
    const messageId = result?.key?.id || `out-${Date.now()}`;
    await appendOutboundMessage({
      id: messageId,
      waId,
      text,
      timestamp,
      status: "sent",
    });
    return { messageId, waId };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Send failed";
    await appendOutboundMessage({
      id: `failed-${Date.now()}`,
      waId,
      text,
      timestamp,
      status: "failed",
      error,
    });
    throw err;
  }
}

export async function logoutWhatsApp(): Promise<void> {
  shouldRun = false;
  try {
    if (sock) {
      await sock.logout();
    }
  } catch {
    // ignore logout errors; still wipe local auth
  }
  sock = null;
  me = null;
  qrDataUrl = null;
  status = "logged_out";
  lastError = "Logged out locally.";
  await clearAuthDir();
  shouldRun = true;
  void startWhatsApp();
}

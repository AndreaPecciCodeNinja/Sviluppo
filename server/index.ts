import { config as loadEnv } from "dotenv";
import cors from "cors";
import express from "express";
import {
  getSessionSnapshot,
  logoutWhatsApp,
  sendTextMessage,
  startWhatsApp,
} from "./wa-client";
import {
  listConversations,
  listMessages,
  markConversationRead,
} from "./store";

loadEnv({ path: ".env.local" });
loadEnv();

const PORT = Number(process.env.WA_SERVER_PORT || 3001);
const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "whatsapp-web-session" });
});

app.get("/api/session", (_req, res) => {
  res.json(getSessionSnapshot());
});

app.post("/api/session/logout", async (_req, res) => {
  try {
    await logoutWhatsApp();
    res.json({ ok: true, session: getSessionSnapshot() });
  } catch (err) {
    res.status(500).json({
      error: {
        message: err instanceof Error ? err.message : "Logout failed",
      },
    });
  }
});

app.get("/api/conversations", async (_req, res) => {
  try {
    const conversations = await listConversations();
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({
      error: {
        message:
          err instanceof Error ? err.message : "Failed to list conversations",
      },
    });
  }
});

app.get("/api/conversations/:waId/messages", async (req, res) => {
  try {
    const waId = decodeURIComponent(req.params.waId);
    const messages = await listMessages(waId);
    await markConversationRead(waId);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({
      error: {
        message: err instanceof Error ? err.message : "Failed to list messages",
      },
    });
  }
});

app.post("/api/messages", async (req, res) => {
  try {
    const to = String(req.body?.to || "").trim();
    const text = String(req.body?.text || "").trim();
    if (!to || !text) {
      res.status(400).json({
        error: { message: "Both `to` and `text` are required" },
      });
      return;
    }

    const result = await sendTextMessage({ to, text });
    const messages = await listMessages(result.waId);
    const message = messages.find((m) => m.id === result.messageId) || null;
    res.status(201).json({ message, waId: result.waId });
  } catch (err) {
    res.status(502).json({
      error: {
        message: err instanceof Error ? err.message : "Send failed",
      },
    });
  }
});

async function main() {
  await startWhatsApp();
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`[wa-server] listening on http://127.0.0.1:${PORT}`);
    console.log(
      "[wa-server] unofficial WhatsApp Web session — local-dev only; ToS risk",
    );
  });
}

main().catch((err) => {
  console.error("[wa-server] fatal", err);
  process.exit(1);
});

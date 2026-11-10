# WhatsApp Web Session Inbox

Local web inbox that chats through an **unofficial WhatsApp Web multi-device session** (QR login via [Baileys](https://github.com/WhiskeySockets/Baileys)).

This is **not** the Meta WhatsApp Business Cloud API. A separate Cloud API scaffold lives on another branch/PR.

Stack: **Next.js (UI) + Express (long-lived Baileys session) + TypeScript**.

## Caveats

- **Unofficial client** — reverse-engineered multi-device protocol; can break when WhatsApp changes.
- **ToS / ban risk** — may violate WhatsApp Terms of Service. Use a non-critical number.
- **Multi-device** — links as a secondary device; the phone remains primary.
- **Local-only session** — credentials live under `.data/wa-auth/` (gitignored). Do not commit or share them.
- **No UI auth** — anyone who can reach the UI can send as the linked account. Bound to `127.0.0.1` by default.

## Features

- QR login shown in the browser UI
- Personal chat inbox + thread + text send/receive
- Session persistence across restarts (`useMultiFileAuthState`)
- Logout / re-scan from the UI

## Quick start

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Wait for the QR code.
2. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**.
3. Scan the QR. When status becomes `ready`, the inbox unlocks.
4. Message the linked number from another WhatsApp account (or reply in an existing personal chat).

`npm run dev` starts both processes:

| Process | Port | Role |
|---------|------|------|
| `dev:wa` (Express + Baileys) | `3001` | Holds the WhatsApp socket |
| `dev:web` (Next.js) | `3000` | UI; rewrites `/api/*` → WA server |

## Environment variables

Copy `.env.example` → `.env.local`. **Never commit real session files or secrets.**

| Variable | Default | Purpose |
|----------|---------|---------|
| `WA_SERVER_PORT` | `3001` | Express session server port |
| `WA_SERVER_URL` | `http://127.0.0.1:3001` | Next.js rewrite target |
| `WA_AUTH_DIR` | `.data/wa-auth` | Baileys multi-file auth |
| `WA_STORE_PATH` | `.data/store.json` | Inbox JSON cache |
| `WA_LOG_LEVEL` | `warn` | Baileys/pino level |
| `NEXT_PUBLIC_POLL_INTERVAL_MS` | `2500` | UI poll interval |

No Meta tokens are required.

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/session` | `{ status, qrDataUrl, me, lastError }` |
| `POST` | `/api/session/logout` | Logout + wipe local auth + show new QR |
| `GET` | `/api/conversations` | Inbox list |
| `GET` | `/api/conversations/:waId/messages` | Thread |
| `POST` | `/api/messages` | `{ to, text }` send via Baileys |

## Project layout

```
server/                 Express + Baileys session process
  index.ts              HTTP API
  wa-client.ts          QR, connect, send/receive
  store.ts              .data/store.json helpers
src/components/         QrLogin, Inbox, Thread, Composer
src/app/                Next.js UI
.data/                  runtime auth + store (gitignored)
```

## Library choice

**Baileys** was chosen over `whatsapp-web.js` so local-dev does **not** need Chromium/Puppeteer. See the project plan for the full comparison and caveats.

## Why not Cloud API?

Meta Business Cloud API is the official path (webhooks + Graph send). This scaffold is an experiment for personal chats via Linked Devices. Prefer Cloud API for anything business / production-facing.

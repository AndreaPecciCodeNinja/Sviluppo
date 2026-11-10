# Bird WhatsApp Inbox

Browser web inbox for **Bird’s WhatsApp API** on the existing **CodeNinja** number.

This is **not** Meta Cloud API Graph calls and **not** Baileys / WhatsApp Web. Those scaffolds live on separate PRs (#1 / #2).

Stack: **Next.js App Router + TypeScript**. Bird credentials stay **server-side** in Route Handlers.

## CodeNinja number (already connected)

| Field | Value |
|-------|--------|
| Name | CodeNinja |
| Phone | `+393337802795` |
| Bird number id | `wan_01m5n2ffp9e019bnda2e60s4z9` |
| WABA | `1053584521038483` |
| Conversations | enabled |
| Meta Business Agent | not eligible on this number |

Set `BIRD_WHATSAPP_PHONE_NUMBER=+393337802795` so list/send calls scope to this line.

## Features

- Conversation list via `GET /v1/whatsapp/conversations` (filtered by business phone)
- Thread via `GET /v1/whatsapp/conversations/{id}/messages`
- Send text via `POST /v1/whatsapp/messages` (`from` = CodeNinja E.164)
- Optional webhook receiver at `/api/webhook` (scaffold acknowledges; UI polls)
- Setup screen when `BIRD_API_KEY` is missing (no invented secrets)
- **Offline sentiment browse** at [`/sentiment`](http://localhost:3200/sentiment) — charts + urgency callouts + filterable list from `data/sentiment.json` (no Bird API key)

## Quick start

```bash
cp .env.example .env.local
# set BIRD_API_KEY from Bird dashboard → Platform tools → API keys
# keep BIRD_WHATSAPP_PHONE_NUMBER=+393337802795

npm install
npm run dev
```

Open [http://localhost:3200](http://localhost:3200) for the live Bird inbox.

### Sentiment UI (offline, no API key)

```bash
npm install
npm run dev
```

Then open **[http://localhost:3200/sentiment](http://localhost:3200/sentiment)**.

The page reads committed static data in `data/sentiment.json` (derived from the project sentiment markdown report). You get:

1. Donut + bar distribution (positive / neutral / negative / mixed / insufficient)
2. Visual urgency callouts for negative / urgent chats
3. Searchable / filterable conversation table (label, contact, theme)

No `BIRD_API_KEY` is required for `/sentiment`.

Create the key with at least **`whatsapp:write`** for the live inbox. Workspace keys use `bk_{region}_…`; the app derives `https://{region}.platform.bird.com` when `BIRD_API_BASE_URL` is omitted.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `BIRD_API_KEY` | yes | Workspace bearer key |
| `BIRD_API_BASE_URL` | no | Override regional host |
| `BIRD_WHATSAPP_PHONE_NUMBER` | yes (defaulted in example) | CodeNinja E.164 filter / send `from` |
| `BIRD_WHATSAPP_NUMBER_ID` | no | Documentation / ops (`wan_…`) |
| `BIRD_WORKSPACE_ID` | no | Only if using a master key |
| `BIRD_WEBHOOK_SECRET` | no | `whsec_…` for Standard Webhooks verify |
| `NEXT_PUBLIC_POLL_INTERVAL_MS` | no | UI poll interval (default 3000) |

**Never commit real keys.** `.env*` is gitignored except `.env.example`.

## API overview (this app)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/status` | Configured? missing env vars |
| `GET` | `/api/conversations` | Inbox list (Bird) |
| `GET` | `/api/conversations/:id/messages` | Thread (Bird) |
| `POST` | `/api/messages` | `{ conversationId, text }` send via Bird |
| `POST` | `/api/webhook` | Optional Bird event receiver |

## Realtime: polling vs webhooks

- **Default:** the UI polls Bird every few seconds (good for local dev).
- **Optional:** register `https://<public-host>/api/webhook` in Bird → Webhooks for `whatsapp.received` (and status events). Expose HTTPS with ngrok/cloudflared. Signature verification uses `BIRD_WEBHOOK_SECRET` when set.

Free-form replies require an open **24-hour customer service window**. Outside the window Bird refuses text (`E15044` / `WhatsAppServiceWindowClosed`); the UI and `POST /api/messages` error JSON surface Bird’s `code`, `name`, and message, plus IT/EN guidance to wait for an inbound message or send a template from Bird.

## Project layout

```
src/lib/bird.ts              Bird REST client (server-only)
src/lib/sentiment.ts         Sentiment types / label helpers
data/sentiment.json          Offline sentiment snapshot (no Bird calls)
src/app/api/                 Next.js Route Handlers
src/app/sentiment/           Offline sentiment charts + browse UI
src/components/              Inbox, Thread, Composer, SentimentView
```

## Related PRs

- PR #1 — Meta Cloud API scaffold
- PR #2 — Baileys QR / Web session scaffold (UI patterns reused here)

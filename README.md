# WhatsApp Business Inbox

Web app for a **business WhatsApp inbox** using the official **Meta WhatsApp Business Cloud API** (not WhatsApp Web / Baileys).

Stack: **Next.js (App Router) + TypeScript**. Messages are stored locally in `.data/store.json` for the scaffold — swap this for a real database before production.

## Features

- Webhook endpoint for Meta verification + inbound messages (`GET`/`POST /api/webhook`)
- Send text replies via Graph API (`POST /api/messages`)
- Browser UI: conversation list, thread, composer
- Signature validation with `X-Hub-Signature-256` when `WHATSAPP_APP_SECRET` is set

## Quick start

```bash
cp .env.example .env.local
# fill in Meta credentials (see below)

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For Meta to reach your webhook locally, expose HTTPS (examples):

```bash
# ngrok
ngrok http 3000

# or Cloudflare Tunnel
cloudflared tunnel --url http://localhost:3000
```

Set the Meta callback URL to `https://<your-tunnel-host>/api/webhook`.

## Environment variables

Copy `.env.example` → `.env.local` (gitignored). **Never commit real tokens.**

| Variable | Description |
|----------|-------------|
| `WHATSAPP_ACCESS_TOKEN` | Permanent / system-user access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID used when sending |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA ID (ops / debugging) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Shared secret you invent for webhook GET verify |
| `WHATSAPP_APP_SECRET` | App secret for HMAC signature checks |
| `META_GRAPH_API_VERSION` | Default `v21.0` |
| `NEXT_PUBLIC_POLL_INTERVAL_MS` | UI refresh interval (default `3000`) |

Without credentials the UI still loads with an empty inbox; send/receive against Meta will fail until env is filled.

## Meta Developer Console setup

1. Go to [Meta for Developers](https://developers.facebook.com/) → **My Apps** → **Create App** (type: Business).
2. Add the **WhatsApp** product to the app.
3. Open **WhatsApp → API setup**:
   - Copy **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - Copy **WhatsApp Business Account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - Generate / copy a lasting **access token** (system user token recommended for production) → `WHATSAPP_ACCESS_TOKEN`
4. Open **App settings → Basic** → copy **App secret** → `WHATSAPP_APP_SECRET`.
5. Choose a long random verify string → `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
6. Configure the webhook (WhatsApp → Configuration):
   - **Callback URL:** `https://<public-host>/api/webhook`
   - **Verify token:** same value as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to the **`messages`** field (and optionally message status updates)
7. Save. Meta sends a `GET` challenge; this app echoes `hub.challenge` when the token matches.
8. Send a WhatsApp message to the test / business number — it should appear in the inbox UI.

### Test send (optional)

```bash
curl -sS -X POST http://localhost:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"to":"<customer_wa_id>","text":"Hello from the inbox"}'
```

Free-form replies work inside the **24-hour customer service window** after the last inbound message. Outside that window Meta requires approved **message templates** (not included in this scaffold).

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/webhook` | Meta subscription verification |
| `POST` | `/api/webhook` | Inbound messages + delivery statuses |
| `GET` | `/api/conversations` | Inbox list |
| `GET` | `/api/conversations/:waId/messages` | Thread messages |
| `POST` | `/api/messages` | Send text via Cloud API |

## Project layout

```
src/app/api/webhook/          Meta webhook
src/app/api/messages/         Send message
src/app/api/conversations/    Inbox + thread reads
src/components/               Inbox, Thread, Composer UI
src/lib/meta.ts               Graph client + signature verify
src/lib/store.ts              JSON file persistence (.data/)
```

## Production notes

- Replace `.data/` JSON store with a shared database.
- Add authentication before exposing the UI.
- Keep `WHATSAPP_APP_SECRET` set so webhook signatures are enforced.
- Use a permanent system-user token with least privilege.
- Deploy behind HTTPS only.

## License

Private — Sviluppo.

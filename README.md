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
- **Select inbound message** → editable composer box; **voice notes / audio** download via Bird media API and transcribe with OpenAI Whisper (`language=it`)
- **Reply agent (Claude or local Ollama)** — classifies the box text, picks a template from `config/reply-templates.json`, fills slots (e.g. food ingredients → pranzo/cena ask), shows editable draft before Bird send
- **Local chat memory (LangChain + SQLite)** — per-contact facts + recent snippets in `.data/memory.sqlite` (no cloud keys); injected into suggest-reply; UI panel to view/edit / **Salva fatto**

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

### Select message + voice transcription

1. Open a conversation in the inbox.
2. Click an **inbound** bubble.
3. Text fills the editable composer box (edit before Send).
4. A **vocalino / audio** shows **Trascrizione…**, downloads media from Bird (`GET /v1/whatsapp/messages/{id}/media/{media_id}`), then fills the box with Whisper text (Italian preferred).

Requires `OPENAI_API_KEY` in `.env.local` for step 4. Without it, text selection still works; audio shows a clear missing-key error.

### Reply agent (templates) — Claude or Ollama

1. Put inbound text in the composer (select message or after Whisper).
2. Click **Suggerisci risposta**.
3. The active provider (`REPLY_PROVIDER`) chooses a template from `config/reply-templates.json` and fills slots.
4. The composer shows the draft (editable). Review, then **Send** via Bird.

Example food flow: inbound “pomodori, mozzarella, basilico, olio” → template `food_ingredients_meal` →  
“Hai elencato questi ingredienti: pomodori, mozzarella, basilico, olio. Vuoi che ti prepari il pranzo o la cena…?”

Add more templates by editing `config/reply-templates.json` (`id`, `intent`, `when_to_use`, `body` with `{{slots}}`).

#### Provider: Claude (default)

```env
REPLY_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-…
ANTHROPIC_MODEL=claude-haiku-4-5
```

#### Provider: local Ollama

Same machine as Next.js (port 3200):

```bash
ollama pull qwen2.5:7b
# ensure the daemon is up (often automatic as a service)
ollama serve
```

```env
REPLY_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
```

If Ollama is down or the model is missing, the UI shows a clear error (start Ollama / `ollama pull …`). No cloud API key needed for this path.

When `REPLY_PROVIDER=ollama`, the thread pane shows a status pill above the chat: green **Ollama disponibile** when `GET /api/tags` succeeds and `OLLAMA_MODEL` is installed; amber warning otherwise. Health is checked on load, every ~15s (`GET /api/ollama/health`), and again before **Suggerisci risposta**.

### Local memory (LangChain + SQLite)

No cloud keys for memory. SQLite file defaults to `.data/memory.sqlite` (gitignored).

1. Open a conversation → **Memoria (SQLite)** panel under the composer.
2. Select inbound text (or Whisper) → optional auto-snippet write-back.
3. Click **Salva fatto dal box** to store a durable fact for that contact.
4. **Suggerisci risposta** loads facts + recent snippets into the Claude/Ollama prompt.
5. Outbound Send also appends an `ai` snippet.

Optional env:

```env
MEMORY_SQLITE_PATH=.data/memory.sqlite
MEMORY_MAX_MESSAGES=20
```

Plan: project store `docs/langchain-sqlite-memory-plan.md`.

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
| `OPENAI_API_KEY` | for voice STT | Whisper transcription of inbound audio |
| `OPENAI_TRANSCRIBE_MODEL` | no | default `whisper-1` |
| `OPENAI_TRANSCRIBE_LANGUAGE` | no | default `it` (Italian) |
| `REPLY_PROVIDER` | no | `claude` (default) or `ollama` |
| `ANTHROPIC_API_KEY` | when provider=claude | Claude Messages API |
| `ANTHROPIC_MODEL` | no | default `claude-haiku-4-5` |
| `OLLAMA_BASE_URL` | no | default `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | no | default `qwen2.5:7b` |
| `MEMORY_SQLITE_PATH` | no | default `.data/memory.sqlite` (local, no API key) |
| `MEMORY_MAX_MESSAGES` | no | snippets injected into reply prompts (default 20) |

**Never commit real keys.** `.env*` is gitignored except `.env.example`.

## API overview (this app)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/status` | Configured? missing env vars |
| `GET` | `/api/conversations` | Inbox list (Bird) |
| `GET` | `/api/conversations/:id/messages` | Thread (Bird) |
| `POST` | `/api/messages` | `{ conversationId, text }` send via Bird |
| `POST` | `/api/messages/transcribe` | `{ messageId, mediaId }` → Whisper text |
| `GET`/`POST` | `/api/messages/suggest-reply` | Reply agent (Claude/Ollama) → `{ suggestion.draft }` |
| `GET` | `/api/ollama/health` | Ollama up? + model present (UI badge) |
| `GET`/`POST` | `/api/memory` | List/create facts or message snippets |
| `PATCH`/`DELETE` | `/api/memory/:id` | Edit/delete a fact |
| `POST` | `/api/webhook` | Optional Bird event receiver |

## Realtime: polling vs webhooks

- **Default:** the UI polls Bird every few seconds (good for local dev).
- **Optional:** register `https://<public-host>/api/webhook` in Bird → Webhooks for `whatsapp.received` (and status events). Expose HTTPS with ngrok/cloudflared. Signature verification uses `BIRD_WEBHOOK_SECRET` when set.

Free-form replies require an open **24-hour customer service window**. Outside the window Bird refuses text (`E15044` / `WhatsAppServiceWindowClosed`); the UI and `POST /api/messages` error JSON surface Bird’s `code`, `name`, and message, plus IT/EN guidance to wait for an inbound message or send a template from Bird.

## Project layout

```
src/lib/bird.ts              Bird REST client + media download (server-only)
src/lib/transcribe.ts        Bird media → OpenAI Whisper
src/lib/reply-agent.ts       Claude / Ollama template router (+ memory inject)
src/lib/reply-templates.ts   Load/render config/reply-templates.json
src/lib/memory/              LangChain SQLite history + facts store
config/reply-templates.json  Editable reply templates (no code change to add)
.data/memory.sqlite          Local memory DB (gitignored, created at runtime)
src/lib/sentiment.ts         Sentiment types / label helpers
data/sentiment.json          Offline sentiment snapshot (no Bird calls)
src/app/api/                 Next.js Route Handlers
src/app/sentiment/           Offline sentiment charts + browse UI
src/components/              Inbox, Thread, Composer, SentimentView
```


## Related PRs

- PR #1 — Meta Cloud API scaffold
- PR #2 — Baileys QR / Web session scaffold (UI patterns reused here)

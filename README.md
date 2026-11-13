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
- **Auto-bozza ultimo inbound** — opening a chat (or a new inbound on poll) selects the latest inbound and asks the **message router** for a specialist draft. **Invio cibo** defaults to **Manuale** (draft stays in the composer). **Automatica** sends that food draft once per inbound id. **Suggerisci risposta** remains a manual override for the text
- **Fiammetta + specialists** — Fiammetta classifies each inbound (`appointment`, `food_meal`, `generic`) and hands it to one specialist. She does not do that specialist work. The composer badge is `Fiammetta → Appuntamenti` or `Fiammetta → Cibo`. Customer drafts start with “Sono Fiammetta.” and then the specialist text. Food reuses the existing ingredient template; appointments draft a confirmation or a question; generic never auto-fills
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

1. Put inbound text in the composer (select message or after Whisper), **or** open a chat and let auto-bozza run on the latest inbound.
2. Click **Suggerisci risposta** for a manual override (any template, including generic ack).
3. The active provider (`REPLY_PROVIDER`) chooses a template from `config/reply-templates.json` and fills slots.
4. The composer shows the draft (editable). With **Invio cibo → Manuale** (the default), review and press **Send**. With **Automatica**, a food draft (meal question or dish) is sent once for that inbound id.

**Auto-bozza:** on conversation open / new inbound (poll), the UI selects the latest inbound once per message id and Fiammetta hands it to a specialist. An ingredient list that does not name pranzo or cena fills the composer at once with the meal question — no Ollama call. While a model call is actually running, the composer says “Fiammetta sta generando… Ollama sta scrivendo” (or the active provider). The status clears when the draft arrives, or after 25s if the provider does not answer. A draft is applied only when the specialist allows it (`food_ingredients_meal`, the meal-choice question, the dish proposal, or the appointments specialist). Generic stays in the box until **Suggerisci risposta**. The composer badge is `Fiammetta → Cibo`, `Fiammetta → Appuntamenti`, or `Fiammetta → Generico`. A customer-facing draft starts with “Sono Fiammetta.” The inbox shows a dot only on a conversation with a new message that has not been opened yet. Opening it clears the dot until a later message arrives. There is no unread count. **Invio cibo** is **Manuale** unless you switch it to **Automatica**. Manuale never sends. Automatica sends only the food draft just generated for that message id, once, and does not send it again if you reopen the chat. If the 24h window is closed, the error stays on screen and the send is not retried. Appointments and generic replies stay in the composer.

Example food flow: inbound “pomodori, mozzarella, basilico, olio” → template `food_ingredients_meal` →  
“Hai elencato questi ingredienti: pomodori, mozzarella, basilico, olio. Vuoi che ti prepari il pranzo o la cena…?”

If the latest inbound is only a yes (`sì`, `ok`, `va bene`, …) and it does **not** say pranzo or cena, and the thread already has that meal question or an ingredient list, the composer gets one draft: “Perfetto. Preferisci il pranzo o la cena?”. Once per message id. In **Automatica** that question is sent once; in **Manuale** it stays in the composer.

If the latest inbound names **pranzo** or **cena** (also inside a phrase such as “preparami il pranzo”) and the thread already has ingredients, opening the chat (or the new inbound on poll) fills the composer with a dish draft — no **Suggerisci** click and no paste. It does not ask the meal question again. The dish uses only the last ingredient list before that choice, not older lists. A greeting such as “Ciao Andrea” is not an ingredient. The draft does not address the customer by a name taken from the thread; a name is used only when the sentence needs one, and then only the Bird contact display name. Example: `uova, farina, zucchero, cacao` then `Cena` → “Per la cena ti propongo una torta al cacao. Userò uova, farina, zucchero e cacao.” A later list `carne, pane, pomodori, insalata` then “preparami il pranzo” proposes a sandwich with those four items, not the cocoa cake. Opening the conversation again replaces the composer with that draft. A previous cake draft is not left in the box. Auto-draft runs once per message id after that open; a new auto-draft version (`food-dish-7`) runs once more for an id already handled by an older page. «Sì, preparami il pranzo» after latte, uova, zucchine e salsiccia fills a named dish locally: “una frittata di zucchine e salsiccia”, with a short cooking line instead of repeating the ingredient list. It does not call suggest-reply. In **Manuale** it waits for **Send**. In **Automatica** that frittata text is the message sent once for the inbound id. Fiammetta does not propose a plate that repeats the ingredient list. On a new inbound, or when that message is selected, she reads that text and asks the fitting question. A food list becomes “Hai elencato questi ingredienti: … Vuoi che ti prepari il pranzo o la cena con questi?” — the ingredients appear once. A message that is only “cena” or “pranzo”, or that already names the meal, does not stay as that single word and does not become “ti propongo un piatto con … Userò …”. Fiammetta asks one follow-up from that choice and the latest ingredient list. The WhatsApp display name is used when Bird has one: “Tommaso, per la cena con pomodori, zucchine, melanzane e aglio va bene?”. **Manuale** (the default) keeps the draft in the composer until **Send**. **Automatica** sends that same draft on WhatsApp without **Send**, once per message id. To try this without a new inbound and without sending, leave **Invio cibo** on **Manuale** and select messages already in the chat: a food list fills the meal question, then «cena» or «pranzo» fills one follow-up. Selecting in **Manuale** does not send. Do not swap the two modes. After the composer shows “per la cena con … va bene?”, **Simula sì** is a chat control, not a WhatsApp message. It reads that yes, the chosen meal, and the latest list, and replaces the composer with one named dish. Pasta, formaggio, ragù di carne and peperoncino become “una pasta al ragù piccante”, not “Preparo la cena con” plus the list. A long WhatsApp display name is shortened to the first name (Tommaso Pelucchini → Tommaso). It does not send. Leave **Automatica** off for that try. **Simula in chat** is a separate box: type an ingredient list, press **Leggi alimenti**, and the pranzo/cena question fills the composer, linked to the open conversation’s message. That box does not send.

Add more templates by editing `config/reply-templates.json` (`id`, `intent`, `when_to_use`, `body` with `{{slots}}`).

### Router and specialists

`POST /api/messages/suggest-reply` classifies the inbound text, then runs one specialist from `src/lib/agents/specialists.ts`.

| Specialist | Intent | Auto-draft |
|------------|--------|------------|
| `food` | ingredient list, a bare yes, or pranzo/cena after that list | yes: ask which meal, or propose a dish once the meal is chosen |
| `appointments` | appointment, time, “ci vediamo” | yes — confirmation if day and time are present, otherwise a question |
| `generic` | anything else | no — short ack only if you press **Suggerisci risposta** |

Example: inbound “Vorrei un appuntamento martedì alle 15” → badge `Fiammetta → Appuntamenti` → editable draft “Sono Fiammetta. Perfetto — segno un appuntamento per martedì alle 15:00. Confermi?”. Review, then Send.

Add a specialist by appending an entry (`id`, `match`, `prompt`, `draft`) in `src/lib/agents/specialists.ts`. Optional env toggles:

```env
SPECIALIST_FOOD=1
SPECIALIST_APPOINTMENTS=1
```

Set either to `0` / `false` / `off` to skip that specialist (the message falls through to Generico, still without auto-send). Provider remains `REPLY_PROVIDER=ollama` (default on Mac) or `claude`.

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

The thread toolbar **always** shows an Ollama status pill (even if `REPLY_PROVIDER=claude`): green **Ollama disponibile** when reachable + model installed; amber otherwise. A debug line shows `provider` / `reachable` / `model`. Health: on load, every ~15s (`GET /api/ollama/health` → Ollama `/api/tags`), and before **Suggerisci risposta**. Default `REPLY_PROVIDER` in `.env.example` is **ollama**.

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
| `REPLY_PROVIDER` | no | `ollama` (default) or `claude` |
| `ANTHROPIC_API_KEY` | when provider=claude | Claude Messages API |
| `ANTHROPIC_MODEL` | no | default `claude-haiku-4-5` |
| `OLLAMA_BASE_URL` | no | default `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | no | default `qwen2.5:7b` |
| `SPECIALIST_FOOD` | no | `0`/`false`/`off` disables the food specialist |
| `SPECIALIST_APPOINTMENTS` | no | `0`/`false`/`off` disables the appointments specialist |
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
src/lib/reply-agent.ts       Claude / Ollama template fill for the food specialist
src/lib/reply-provider.ts    REPLY_PROVIDER, model, and Ollama/Claude config
src/lib/agents/              Inbound router + specialist registry (food, appointments, generic)
src/lib/reply-templates.ts   Load/render config/reply-templates.json
src/lib/memory/              SQLite facts/snippets + LangChain-compatible history adapter
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

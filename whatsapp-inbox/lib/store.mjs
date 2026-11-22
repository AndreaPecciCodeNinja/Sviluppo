import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUSINESS_NUMBER, normalizePhone } from "./phone.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

export function windowFromInbound(lastInboundAt, now = Date.now()) {
  if (!lastInboundAt) return { status: "closed", ends_at: null };
  const ends = new Date(lastInboundAt).getTime() + DAY_MS;
  if (Number.isNaN(ends)) return { status: "closed", ends_at: null };
  return {
    status: ends > now ? "open" : "closed",
    ends_at: new Date(ends).toISOString(),
  };
}

function waId(value) {
  const phone = normalizePhone(value);
  return phone.startsWith("+") ? phone.slice(1) : "";
}

function asText(value) {
  return typeof value === "string" && value.trim() ? value : "";
}

function inboundMessage(raw, name) {
  const from = waId(raw.from);
  if (!from || !raw.id) return null;
  const created = Number(raw.timestamp);
  const message = {
    id: String(raw.id),
    direction: "inbound",
    status: "received",
    created_at: Number.isFinite(created) ? new Date(created * 1000).toISOString() : new Date().toISOString(),
    from: { display_name: name || null, phone_number: `+${from}` },
  };
  if (raw.type === "text" && asText(raw.text?.body)) message.text = { body: raw.text.body };
  if (raw.image) message.image = { caption: asText(raw.image.caption) || null };
  if (raw.video) message.video = { caption: asText(raw.video.caption) || null };
  if (raw.audio) message.audio = { voice: Boolean(raw.audio.voice) };
  if (raw.sticker) message.sticker = {};
  if (raw.document) message.document = { filename: asText(raw.document.filename) || null, caption: asText(raw.document.caption) || null };
  if (raw.location) message.location = { name: asText(raw.location.name) || null, address: asText(raw.location.address) || null };
  if (Array.isArray(raw.contacts)) {
    message.contact_cards = raw.contacts.map((card) => ({
      name: { formatted_name: asText(card?.name?.formatted_name) || null },
    }));
  }
  if (raw.interactive) {
    const reply = raw.interactive.button_reply || raw.interactive.list_reply;
    if (reply) message.interactive_reply = { title: asText(reply.title) || null };
    else if (asText(raw.interactive.body?.text)) message.interactive = { body_text: raw.interactive.body.text };
  }
  if (raw.button) message.interactive_reply = { title: asText(raw.button.text) || null };
  if (raw.reaction) message.reaction = { emoji: asText(raw.reaction.emoji) || null };
  return { waId: from, message };
}

export function createMessageStore({ filePath, now = () => Date.now() } = {}) {
  const conversations = new Map();
  const messages = new Map();
  const sends = new Map();
  let chain = Promise.resolve();

  function snapshot() {
    return {
      version: 1,
      conversations: [...conversations.values()],
      messages: Object.fromEntries(messages),
      sends: Object.fromEntries(sends),
    };
  }

  async function persist() {
    if (!filePath) return;
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot()));
    await rename(temporary, filePath);
  }

  function exclusive(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  function visible(conversation) {
    return {
      ...conversation,
      service_window: windowFromInbound(conversation.last_inbound_at, now()),
    };
  }

  function ensure(id, name) {
    let conversation = conversations.get(id);
    if (!conversation) {
      conversation = {
        id,
        business_phone_number: BUSINESS_NUMBER,
        recipient: { display_name: name || null, phone_number: `+${id}` },
        unread_count: 0,
        last_inbound_at: null,
        updated_at: null,
        last_message: null,
      };
      conversations.set(id, conversation);
      messages.set(id, []);
    } else if (name && !conversation.recipient.display_name) {
      conversation.recipient.display_name = name;
    }
    return conversation;
  }

  return {
    async load() {
      if (!filePath) return;
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8"));
        for (const conversation of parsed.conversations || []) conversations.set(conversation.id, conversation);
        for (const [id, list] of Object.entries(parsed.messages || {})) messages.set(id, list);
        for (const [key, message] of Object.entries(parsed.sends || {})) sends.set(key, message);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    },

    list({ q, startingAfter, limit = 30 } = {}) {
      const needle = q ? String(q).toLowerCase() : "";
      const ordered = [...conversations.values()]
        .filter((conversation) => {
          if (!needle) return true;
          const name = conversation.recipient.display_name || "";
          const phone = conversation.recipient.phone_number || "";
          return `${name} ${phone}`.toLowerCase().includes(needle);
        })
        .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
      let start = 0;
      if (startingAfter) {
        const index = ordered.findIndex((conversation) => conversation.id === startingAfter);
        if (index === -1) {
          throw Object.assign(new Error("Cursore non valido."), { status: 400 });
        }
        start = index + 1;
      }
      const page = ordered.slice(start, start + limit);
      return {
        data: page.map(visible),
        next_cursor: start + limit < ordered.length ? page.at(-1)?.id || null : null,
      };
    },

    get(id) {
      const conversation = conversations.get(id);
      return conversation ? visible(conversation) : null;
    },

    listMessages(id, { startingAfter, limit = 40 } = {}) {
      const list = messages.get(id);
      if (!list) return null;
      let start = 0;
      if (startingAfter) {
        const index = list.findIndex((message) => message.id === startingAfter);
        if (index === -1) throw Object.assign(new Error("Cursore non valido."), { status: 400 });
        start = index + 1;
      }
      const page = list.slice(start, start + limit);
      return {
        data: page,
        next_cursor: start + limit < list.length ? page.at(-1)?.id || null : null,
      };
    },

    findSend(key) {
      return sends.get(key) || null;
    },

    async addOutbound({ conversationId, message, idempotencyKey }) {
      return exclusive(async () => {
        const conversation = conversations.get(conversationId);
        if (!conversation) {
          throw Object.assign(new Error("Conversazione non trovata."), { status: 404 });
        }
        const list = messages.get(conversationId);
        list.unshift(message);
        conversation.updated_at = message.created_at;
        conversation.last_message = { id: message.id, direction: "outbound", created_at: message.created_at };
        if (idempotencyKey) sends.set(idempotencyKey, message);
        await persist();
        return message;
      });
    },

    async ingest(value) {
      return exclusive(async () => {
        const names = new Map();
        for (const contact of value?.contacts || []) {
          const id = waId(contact.wa_id);
          const name = asText(contact.profile?.name);
          if (id && name) names.set(id, name);
        }
        let stored = 0;
        for (const raw of value?.messages || []) {
          const parsed = inboundMessage(raw, names.get(waId(raw.from)));
          if (!parsed) continue;
          const conversation = ensure(parsed.waId, names.get(parsed.waId));
          const list = messages.get(parsed.waId);
          if (list.some((item) => item.id === parsed.message.id)) continue;
          list.unshift(parsed.message);
          list.sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
          conversation.unread_count += 1;
          if (!conversation.last_inbound_at || parsed.message.created_at > conversation.last_inbound_at) {
            conversation.last_inbound_at = parsed.message.created_at;
          }
          const newest = list[0];
          conversation.updated_at = newest.created_at;
          conversation.last_message = {
            id: newest.id,
            direction: newest.direction,
            created_at: newest.created_at,
          };
          if (parsed.message.from.display_name) conversation.recipient.display_name = parsed.message.from.display_name;
          stored += 1;
        }
        for (const status of value?.statuses || []) {
          const id = waId(status.recipient_id);
          const list = id ? messages.get(id) : null;
          const message = list?.find((item) => item.id === status.id);
          if (message && status.status) message.status = status.status;
        }
        if (stored || (value?.statuses || []).length) await persist();
        return stored;
      });
    },
  };
}

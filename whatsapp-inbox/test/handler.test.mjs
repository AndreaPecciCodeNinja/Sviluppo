import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { createHandler } from "../lib/handler.mjs";
import { createMessageStore } from "../lib/store.mjs";

const SECRET = "test-app-secret";
const VERIFY = "test-verify-token";
const PHONE_ID = "106540352242922";

function client() {
  const calls = [];
  return {
    calls,
    async confirmBusinessNumber() {
      calls.push("confirm");
      return {
        phone_number: "+393337802795",
        display_number: "+39 333 7802795",
        name: "CodeNinja",
        status: "connected",
        conversations_enabled: true,
        phone_number_id: PHONE_ID,
      };
    },
    async sendText(input) {
      calls.push(["send", input]);
      return {
        id: "wamid.sent",
        direction: "outbound",
        status: "accepted",
        created_at: new Date().toISOString(),
        from: { phone_number: "+393337802795" },
        text: { body: input.body },
      };
    },
  };
}

function webhookValue({ from = "393331112233", name = "Ada Test", secondsAgo = 60, id = "wamid.in", type = "text", extra = {} } = {}) {
  return {
    metadata: { display_phone_number: "393337802795", phone_number_id: PHONE_ID },
    contacts: [{ wa_id: from, profile: { name } }],
    messages: [{
      from,
      id,
      timestamp: String(Math.floor(Date.now() / 1000) - secondsAgo),
      type,
      ...extra,
    }],
  };
}

async function seededStore() {
  const store = createMessageStore();
  await store.ingest(webhookValue({
    extra: { text: { body: "Messaggio di prova" } },
  }));
  await store.ingest(webhookValue({
    id: "wamid.image",
    secondsAgo: 120,
    type: "image",
    extra: { image: { id: "media-secret", caption: "Foto" } },
  }));
  await store.ingest(webhookValue({
    from: "393339998877",
    name: "Chiara Test",
    id: "wamid.old",
    secondsAgo: 60 * 60 * 48,
    extra: { text: { body: "Vecchio messaggio" } },
  }));
  return store;
}

async function listen(store, cloud = client()) {
  const server = createServer(createHandler({
    client: cloud,
    store,
    publicDir: path.join(import.meta.dirname, "../public"),
    appSecret: SECRET,
    verifyToken: VERIFY,
    phoneNumberId: PHONE_ID,
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    client: cloud,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test("session reports the confirmed business number", async () => {
  const server = await listen(createMessageStore());
  try {
    const response = await fetch(`${server.base}/api/session`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.account.phone_display, "+39 333 7802795");
    assert.equal(body.account.name, "CodeNinja");
  } finally {
    await server.close();
  }
});

test("webhook messages appear in the thread without media ids", async () => {
  const server = await listen(await seededStore());
  try {
    const list = await fetch(`${server.base}/api/conversations`);
    const listed = await list.json();
    assert.equal(listed.data[0].display_name, "Ada Test");
    assert.equal(listed.data[0].service_window.status, "open");
    const closed = listed.data.find((item) => item.display_name === "Chiara Test");
    assert.equal(closed.service_window.status, "closed");

    const messages = await fetch(`${server.base}/api/conversations/393331112233/messages`);
    const thread = await messages.json();
    assert.equal(thread.data[0].text, "Messaggio di prova");
    assert.equal(thread.data[1].media[0].label, "Immagine");
    assert.equal(thread.data[1].text, "Foto");
    assert.equal(JSON.stringify(thread).includes("media-secret"), false);
  } finally {
    await server.close();
  }
});

test("empty search and a signed webhook for another number stay out of the inbox", async () => {
  const store = await seededStore();
  const server = await listen(store);
  try {
    const empty = await fetch(`${server.base}/api/conversations?q=nessuno`);
    assert.deepEqual((await empty.json()).data, []);

    const foreign = {
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: webhookValue({
            from: "393330000000",
            name: "Altro numero",
            id: "wamid.foreign",
            extra: { text: { body: "Non qui" } },
          }),
        }],
      }],
    };
    foreign.entry[0].changes[0].value.metadata.display_phone_number = "15551212";
    const raw = JSON.stringify(foreign);
    const signature = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
    const posted = await fetch(`${server.base}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
      body: raw,
    });
    assert.equal(posted.status, 200);
    assert.equal(store.get("393330000000"), null);

    const rejected = await fetch(`${server.base}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=nope" },
      body: raw,
    });
    assert.equal(rejected.status, 401);
  } finally {
    await server.close();
  }
});

test("does not call Cloud API when the text is empty or the window is closed", async () => {
  const server = await listen(await seededStore());
  try {
    const empty = await fetch(`${server.base}/api/conversations/393331112233/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    });
    assert.equal(empty.status, 400);

    const closed = await fetch(`${server.base}/api/conversations/393339998877/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Non inviare" }),
    });
    const closedBody = await closed.json();
    assert.equal(closed.status, 422);
    assert.match(closedBody.error, /finestra di 24 ore/);
    assert.equal(server.client.calls.some((call) => call[0] === "send"), false);
  } finally {
    await server.close();
  }
});

test("sends text only after confirming the number, and replays the same key", async () => {
  const server = await listen(await seededStore());
  try {
    const response = await fetch(`${server.base}/api/conversations/393331112233/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Ciao da prova", idempotency_key: "ui-check-key" }),
    });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.message.text, "Ciao da prova");
    assert.deepEqual(server.client.calls.find((call) => call[0] === "send")[1], {
      to: "+393331112233",
      body: "Ciao da prova",
    });
    const again = await fetch(`${server.base}/api/conversations/393331112233/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Ciao da prova", idempotency_key: "ui-check-key" }),
    });
    assert.equal((await again.json()).message.id, "wamid.sent");
    assert.equal(server.client.calls.filter((call) => call[0] === "send").length, 1);
  } finally {
    await server.close();
  }
});

test("webhook verification and the Italian page", async () => {
  const server = await listen(createMessageStore());
  try {
    const challenge = await fetch(`${server.base}/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`);
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), "12345");
    const page = await fetch(`${server.base}/`);
    const html = await page.text();
    assert.match(html, /lang="it"/);
    assert.match(html, /Scrivi un messaggio/);
    assert.doesNotMatch(html, /BIRD_|graph\.facebook/);
  } finally {
    await server.close();
  }
});

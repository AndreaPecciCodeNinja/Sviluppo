import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { createHandler } from "../lib/handler.mjs";

const openConversation = {
  id: "wacv_open123",
  business_phone_number: "+393337802795",
  recipient: { display_name: "Ada Test", phone_number: "+393331112233" },
  service_window: { status: "open", ends_at: "2026-11-22T18:00:00Z" },
  unread_count: 2,
  last_message: { id: "wam_last", direction: "inbound", created_at: "2026-11-22T09:00:00Z" },
};

const closedConversation = {
  ...openConversation,
  id: "wacv_closed1",
  service_window: { status: "closed", ends_at: null },
};

const otherConversation = {
  ...openConversation,
  id: "wacv_other01",
  business_phone_number: "+390200000000",
};

function fixtureClient() {
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
      };
    },
    async listConversations(query) {
      calls.push(["list", query]);
      if (query.q === "errore") {
        throw Object.assign(new Error("Bird non è raggiungibile."), { status: 502 });
      }
      if (query.q === "vuoto") return { data: [], next_cursor: null };
      return { data: [openConversation, closedConversation], next_cursor: null };
    },
    async getConversation(id) {
      calls.push(["get", id]);
      if (id === closedConversation.id) return closedConversation;
      if (id === otherConversation.id) return otherConversation;
      if (id === openConversation.id) return openConversation;
      throw Object.assign(new Error("missing"), { status: 404 });
    },
    async listMessages(id) {
      calls.push(["messages", id]);
      return {
        data: [
          {
            id: "wam_text",
            direction: "inbound",
            status: "received",
            created_at: "2026-11-22T09:00:00Z",
            from: { display_name: "Ada Test", phone_number: "+393331112233" },
            text: { body: "Messaggio di prova" },
          },
          {
            id: "wam_image",
            direction: "inbound",
            created_at: "2026-11-22T08:00:00Z",
            from: { display_name: "Ada Test", phone_number: "+393331112233" },
            image: { url: "https://cdn.example/secret.jpg", caption: "Foto" },
          },
        ],
        next_cursor: null,
      };
    },
    async sendText(input) {
      calls.push(["send", input]);
      return {
        id: "wam_sent",
        direction: "outbound",
        status: "accepted",
        created_at: "2026-11-22T10:00:00Z",
        from: { phone_number: "+393337802795" },
        text: { body: input.body },
      };
    },
  };
}

async function listen(client) {
  const server = createServer(createHandler({
    client,
    publicDir: path.join(import.meta.dirname, "../public"),
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("session reports the confirmed business number", async () => {
  const client = fixtureClient();
  const server = await listen(client);
  try {
    const response = await fetch(`${server.base}/api/session`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.account.phone_display, "+39 333 7802795");
    assert.equal(body.account.name, "CodeNinja");
    assert.deepEqual(client.calls, ["confirm"]);
  } finally {
    await server.close();
  }
});

test("lists conversations and renders text plus a media placeholder", async () => {
  const client = fixtureClient();
  const server = await listen(client);
  try {
    const list = await fetch(`${server.base}/api/conversations?q=Ada`);
    const listed = await list.json();
    assert.equal(listed.data[0].display_name, "Ada Test");
    assert.equal(listed.data[0].last_direction, "inbound");
    assert.equal(client.calls[0][1].q, "Ada");

    const messages = await fetch(`${server.base}/api/conversations/wacv_open123/messages`);
    const thread = await messages.json();
    assert.equal(thread.data[0].text, "Messaggio di prova");
    assert.equal(thread.data[1].media[0].label, "Immagine");
    assert.equal(thread.data[1].text, "Foto");
    assert.equal(JSON.stringify(thread).includes("cdn.example"), false);
  } finally {
    await server.close();
  }
});

test("empty and error searches stay explicit", async () => {
  const client = fixtureClient();
  const server = await listen(client);
  try {
    const empty = await fetch(`${server.base}/api/conversations?q=vuoto`);
    assert.deepEqual((await empty.json()).data, []);
    const failed = await fetch(`${server.base}/api/conversations?q=errore`);
    const body = await failed.json();
    assert.equal(failed.status, 502);
    assert.match(body.error, /Bird/);
  } finally {
    await server.close();
  }
});

test("does not send when the text is empty or the window is closed", async () => {
  const client = fixtureClient();
  const server = await listen(client);
  try {
    const empty = await fetch(`${server.base}/api/conversations/wacv_open123/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    });
    assert.equal(empty.status, 400);
    assert.equal(client.calls.includes("confirm"), false);
    assert.equal(client.calls.some((call) => call[0] === "send"), false);

    const closed = await fetch(`${server.base}/api/conversations/wacv_closed1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Non inviare" }),
    });
    const closedBody = await closed.json();
    assert.equal(closed.status, 422);
    assert.match(closedBody.error, /finestra di 24 ore/);
    assert.equal(client.calls.some((call) => call[0] === "send"), false);
  } finally {
    await server.close();
  }
});

test("sends text only after confirming the number and the open conversation", async () => {
  const client = fixtureClient();
  const server = await listen(client);
  try {
    const response = await fetch(`${server.base}/api/conversations/wacv_open123/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Ciao da prova", idempotency_key: "browser-test-key" }),
    });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.message.text, "Ciao da prova");
    assert.equal(body.message.direction, "outbound");
    const send = client.calls.find((call) => call[0] === "send");
    assert.deepEqual(send[1], {
      to: "+393331112233",
      body: "Ciao da prova",
      idempotencyKey: "browser-test-key",
    });
    assert.equal(client.calls[0], "confirm");
  } finally {
    await server.close();
  }
});

test("refuses a conversation that belongs to another number", async () => {
  const client = fixtureClient();
  const server = await listen(client);
  try {
    const response = await fetch(`${server.base}/api/conversations/wacv_other01/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "No" }),
    });
    assert.equal(response.status, 403);
    assert.equal(client.calls.some((call) => call[0] === "send"), false);
  } finally {
    await server.close();
  }
});

test("serves the Italian page", async () => {
  const server = await listen(fixtureClient());
  try {
    const response = await fetch(`${server.base}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /lang="it"/);
    assert.match(html, /Scrivi un messaggio/);
    assert.doesNotMatch(html, /bk_/);
  } finally {
    await server.close();
  }
});

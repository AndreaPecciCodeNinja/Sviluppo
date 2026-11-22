import assert from "node:assert/strict";
import test from "node:test";
import { createBirdClient } from "../lib/bird-client.mjs";

function mockFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({
      method: options.method,
      pathname: parsed.pathname,
      search: parsed.searchParams,
      headers: options.headers,
      body,
    });
    const result = await handler({ pathname: parsed.pathname, search: parsed.searchParams, body, method: options.method });
    return new Response(JSON.stringify(result.json), { status: result.status || 200 });
  };
  return { fetchImpl, calls };
}

test("confirms the connected business number before a caller can use the client", async () => {
  const { fetchImpl, calls } = mockFetch(async () => ({
    json: {
      data: [{
        phone_number: "+39 333 7802795",
        name: "CodeNinja",
        status: "connected",
        conversations_enabled: true,
      }],
    },
  }));
  const client = createBirdClient({
    apiKey: "bk_eu1_test",
    apiBase: "http://bird.test",
    fetchImpl,
  });
  const account = await client.confirmBusinessNumber();
  assert.equal(account.phone_number, "+393337802795");
  assert.equal(account.display_number, "+39 333 7802795");
  assert.equal(account.name, "CodeNinja");
  assert.equal(calls[0].pathname, "/v1/whatsapp/numbers");
  assert.equal(calls[0].search.get("phone_number"), "+393337802795");
  assert.equal(calls[0].headers.Authorization, "Bearer bk_eu1_test");
});

test("refuses to treat a missing number as connected", async () => {
  const { fetchImpl } = mockFetch(async () => ({ json: { data: [] } }));
  const client = createBirdClient({ apiKey: "bk_eu1_test", apiBase: "http://bird.test", fetchImpl });
  await assert.rejects(client.confirmBusinessNumber(), (error) => error.status === 404);
});

test("scopes conversation reads to the business number", async () => {
  const { fetchImpl, calls } = mockFetch(async () => ({ json: { data: [], next_cursor: null } }));
  const client = createBirdClient({ apiKey: "bk_eu1_test", apiBase: "http://bird.test", fetchImpl });
  await client.listConversations({ q: "Ada" });
  assert.equal(calls[0].search.get("business_phone_number"), "+393337802795");
  assert.equal(calls[0].search.get("q"), "Ada");
});

test("sends text only, from the business number, with no template", async () => {
  const { fetchImpl, calls } = mockFetch(async () => ({
    status: 202,
    json: { id: "wam_new", direction: "outbound", text: { body: "Ciao" }, status: "accepted" },
  }));
  const client = createBirdClient({ apiKey: "bk_eu1_test", apiBase: "http://bird.test", fetchImpl });
  await client.sendText({ to: "+393331112233", body: "Ciao", idempotencyKey: "whatsapp-text/test-key" });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].pathname, "/v1/whatsapp/messages");
  assert.deepEqual(calls[0].body, {
    to: "+393331112233",
    from: "+393337802795",
    text: { body: "Ciao" },
  });
  assert.equal(Object.hasOwn(calls[0].body, "template"), false);
  assert.equal(calls[0].headers["Idempotency-Key"], "whatsapp-text/test-key");
});

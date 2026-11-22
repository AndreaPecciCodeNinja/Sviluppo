import assert from "node:assert/strict";
import test from "node:test";
import { createWhatsAppClient } from "../lib/whatsapp-cloud.mjs";

function mockFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({
      method: options.method,
      href: parsed.href,
      pathname: parsed.pathname,
      search: parsed.searchParams,
      headers: options.headers,
      body,
    });
    const result = await handler({ pathname: parsed.pathname, search: parsed.searchParams, body });
    return new Response(JSON.stringify(result.json), { status: result.status || 200 });
  };
  return { fetchImpl, calls };
}

test("confirms the Cloud API phone number is +39 333 7802795", async () => {
  const { fetchImpl, calls } = mockFetch(async () => ({
    json: {
      id: "106540352242922",
      display_phone_number: "+39 333 7802795",
      verified_name: "CodeNinja",
      status: "CONNECTED",
    },
  }));
  const client = createWhatsAppClient({
    accessToken: "test-token",
    phoneNumberId: "106540352242922",
    fetchImpl,
  });
  const account = await client.confirmBusinessNumber();
  assert.equal(account.display_number, "+39 333 7802795");
  assert.equal(account.phone_number_id, "106540352242922");
  assert.equal(calls[0].pathname, "/v22.0/106540352242922");
  assert.equal(calls[0].headers.Authorization, "Bearer test-token");
  assert.equal(calls[0].href.startsWith("https://graph.facebook.com/"), true);
});

test("refuses a Cloud API number that is not this business line", async () => {
  const { fetchImpl } = mockFetch(async () => ({
    json: { id: "1", display_phone_number: "+1 650 555 1234", status: "CONNECTED" },
  }));
  const client = createWhatsAppClient({ accessToken: "test-token", phoneNumberId: "1", fetchImpl });
  await assert.rejects(client.confirmBusinessNumber(), (error) => error.status === 409);
});

test("finds the Italian number on the business account", async () => {
  const { fetchImpl, calls } = mockFetch(async () => ({
    json: {
      data: [
        { id: "999", display_phone_number: "+1 650 555 0000", status: "CONNECTED" },
        { id: "106540352242922", display_phone_number: "393337802795", verified_name: "CodeNinja", status: "CONNECTED" },
      ],
    },
  }));
  const client = createWhatsAppClient({
    accessToken: "test-token",
    businessAccountId: "123456789012345",
    fetchImpl,
  });
  const account = await client.confirmBusinessNumber();
  assert.equal(account.phone_number_id, "106540352242922");
  assert.equal(calls[0].pathname, "/v22.0/123456789012345/phone_numbers");
});

test("sends text through the Cloud API and never a template", async () => {
  let step = 0;
  const { fetchImpl, calls } = mockFetch(async ({ pathname }) => {
    step += 1;
    if (pathname.endsWith("/messages")) {
      return { json: { messages: [{ id: "wamid.HBgL", message_status: "accepted" }] } };
    }
    return {
      json: {
        id: "106540352242922",
        display_phone_number: "+39 333 7802795",
        verified_name: "CodeNinja",
        status: "CONNECTED",
      },
    };
  });
  const client = createWhatsAppClient({
    accessToken: "test-token",
    phoneNumberId: "106540352242922",
    fetchImpl,
  });
  await client.confirmBusinessNumber();
  const sent = await client.sendText({ to: "+393331112233", body: "Ciao" });
  assert.equal(sent.id, "wamid.HBgL");
  assert.equal(sent.text.body, "Ciao");
  const post = calls.find((call) => call.method === "POST");
  assert.equal(post.pathname, "/v22.0/106540352242922/messages");
  assert.deepEqual(post.body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "+393331112233",
    type: "text",
    text: { body: "Ciao" },
  });
  assert.equal(Object.hasOwn(post.body, "template"), false);
  assert.equal(step > 0, true);
});

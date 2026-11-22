import assert from "node:assert/strict";
import test from "node:test";
import { formatPhone, normalizePhone } from "../lib/phone.mjs";
import { presentConversation, presentMessage } from "../lib/present.mjs";

test("normalizes the business number the way the inbox displays it", () => {
  assert.equal(normalizePhone("+39 333 7802795"), "+393337802795");
  assert.equal(normalizePhone("393337802795"), "+393337802795");
  assert.equal(formatPhone("+393337802795"), "+39 333 7802795");
  assert.equal(formatPhone("+39 347 857 0800"), "+39 347 8570800");
});

test("turns media into placeholders and keeps text", () => {
  const view = presentMessage({
    id: "wam_1",
    direction: "inbound",
    status: "received",
    created_at: "2026-11-22T09:00:00Z",
    from: { display_name: "Ada", phone_number: "+393331112233" },
    text: { body: "Ecco la foto" },
    image: { url: "https://cdn.example/secret.jpg", caption: "nascosta" },
    document: { filename: "bolla.pdf", url: "https://cdn.example/bolla.pdf" },
    audio: { voice: true, url: "https://cdn.example/voice.ogg" },
  });

  assert.equal(view.text, "Ecco la foto");
  assert.deepEqual(view.media.map((item) => item.label), ["Immagine", "Nota vocale", "Documento"]);
  assert.equal(view.media[2].detail, "bolla.pdf");
  assert.equal(JSON.stringify(view).includes("cdn.example"), false);
});

test("uses a caption when a media message has no text", () => {
  const view = presentMessage({
    id: "wam_2",
    direction: "inbound",
    image: { caption: "Scontrino" },
  });
  assert.equal(view.text, "Scontrino");
  assert.equal(view.media[0].label, "Immagine");
});

test("labels a conversation without inventing a last message", () => {
  const view = presentConversation({
    id: "wacv_abc",
    recipient: { display_name: "Ada", phone_number: "+393331112233" },
    unread_count: 2,
    service_window: { status: "open", ends_at: "2026-11-22T12:00:00Z" },
    last_message: { id: "wam_1", direction: "inbound", created_at: "2026-11-22T09:00:00Z" },
  });
  assert.equal(view.display_name, "Ada");
  assert.equal(view.phone_display, "+39 333 1112233");
  assert.equal(view.last_direction, "inbound");
  assert.equal(view.service_window.status, "open");
  assert.equal(Object.hasOwn(view, "last_text"), false);
});

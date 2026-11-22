import { formatPhone } from "./phone.mjs";

const STATUS_LABELS = {
  accepted: "accettato",
  sent: "inviato",
  delivered: "consegnato",
  read: "letto",
  received: "ricevuto",
  failed: "non inviato",
};

function asText(value) {
  return typeof value === "string" && value.trim() ? value : "";
}

function pushMedia(media, kind, label, detail) {
  media.push({
    kind,
    label,
    detail: asText(detail) || null,
  });
}

export function presentMessage(message) {
  const source = message && typeof message === "object" ? message : {};
  const from = source.from && typeof source.from === "object" ? source.from : {};
  const media = [];
  const textParts = [];

  if (asText(source.text?.body)) textParts.push(source.text.body);
  if (source.image) {
    pushMedia(media, "image", "Immagine");
    if (!textParts.length && asText(source.image.caption)) textParts.push(source.image.caption);
  }
  if (source.video) {
    pushMedia(media, "video", "Video");
    if (!textParts.length && asText(source.video.caption)) textParts.push(source.video.caption);
  }
  if (source.audio) {
    pushMedia(media, "audio", source.audio.voice ? "Nota vocale" : "Audio");
  }
  if (source.sticker) {
    pushMedia(media, "sticker", "Sticker");
  }
  if (source.document) {
    pushMedia(media, "document", "Documento", source.document.filename);
    if (!textParts.length && asText(source.document.caption)) textParts.push(source.document.caption);
  }
  if (source.location) {
    const detail = [asText(source.location.name), asText(source.location.address)].filter(Boolean).join(" · ");
    pushMedia(media, "location", "Posizione", detail);
  }
  if (source.contact_cards) {
    const cards = Array.isArray(source.contact_cards) ? source.contact_cards : [source.contact_cards];
    for (const card of cards) {
      pushMedia(media, "contact", "Contatto", card?.name?.formatted_name || null);
    }
  }
  if (source.template) {
    const name = asText(source.template.slug) || asText(source.template.name) || asText(source.template.id);
    pushMedia(media, "template", "Modello", name);
  }
  if (source.interactive) {
    pushMedia(media, "interactive", "Messaggio interattivo");
    if (!textParts.length && asText(source.interactive.body_text)) textParts.push(source.interactive.body_text);
  }
  if (source.interactive_reply) {
    const reply = source.interactive_reply;
    const detail = asText(reply.title) || asText(reply.text) || asText(reply.id);
    pushMedia(media, "interactive", "Risposta", detail);
  }
  if (!textParts.length && media.length === 0) {
    pushMedia(media, "unknown", "Messaggio");
  }

  return {
    id: source.id || null,
    direction: source.direction === "outbound" ? "outbound" : source.direction === "inbound" ? "inbound" : null,
    status: source.status || null,
    status_label: STATUS_LABELS[source.status] || null,
    created_at: source.created_at || null,
    sender_name: from.display_name || null,
    sender_phone: from.phone_number || null,
    text: textParts.join("\n\n") || null,
    media,
  };
}

export function presentConversation(conversation) {
  const source = conversation && typeof conversation === "object" ? conversation : {};
  const recipient = source.recipient && typeof source.recipient === "object" ? source.recipient : {};
  const phone = recipient.phone_number || null;
  const phoneDisplay = formatPhone(phone);
  const name = recipient.display_name || recipient.username || phoneDisplay || "Contatto";
  const last = source.last_message && typeof source.last_message === "object" ? source.last_message : null;
  const serviceWindow = source.service_window && typeof source.service_window === "object" ? source.service_window : {};

  return {
    id: source.id,
    display_name: name,
    phone_number: phone,
    phone_display: phoneDisplay || null,
    username: recipient.username || null,
    unread_count: Number.isFinite(source.unread_count) ? source.unread_count : 0,
    inbox_status: source.inbox_status || null,
    service_window: {
      status: serviceWindow.status === "open" ? "open" : "closed",
      ends_at: serviceWindow.ends_at || null,
    },
    updated_at: source.updated_at || null,
    last_at: last?.created_at || source.updated_at || null,
    last_direction: last?.direction === "inbound" || last?.direction === "outbound" ? last.direction : null,
  };
}

export function presentAccount(account) {
  return {
    name: account.name || "WhatsApp Business",
    phone_number: account.phone_number,
    phone_display: account.display_number,
    status: account.status,
    conversations_enabled: account.conversations_enabled !== false,
  };
}

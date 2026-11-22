import { BUSINESS_NUMBER, BUSINESS_NUMBER_DISPLAY, normalizePhone } from "./phone.mjs";

const DEFAULT_VERSION = "v22.0";
const GRAPH_HOST = "https://graph.facebook.com";

export function graphVersion(value) {
  const version = value || DEFAULT_VERSION;
  if (!/^v\d+\.\d+$/.test(version)) {
    throw Object.assign(new Error("WHATSAPP_GRAPH_VERSION non è una versione Graph valida."), { status: 500 });
  }
  return version;
}

function graphError(payload, status) {
  const code = payload?.error?.code ?? null;
  let message = "WhatsApp non è raggiungibile.";
  if (code === 131047) {
    message = "La finestra di 24 ore è chiusa. Il testo libero si può inviare solo dopo un messaggio del contatto.";
  } else if (status === 401 || code === 190) {
    message = "Token WhatsApp rifiutato. Controlla WHATSAPP_ACCESS_TOKEN.";
  } else if (status === 403 || code === 10 || code === 200) {
    message = "Il token non ha il permesso per WhatsApp Business.";
  } else if (status === 404) {
    message = "Numero WhatsApp non trovato su Meta.";
  }
  if (code && code !== 131047) message = `${message} (${code})`;
  const error = new Error(message);
  error.status = status || 502;
  error.code = code;
  return error;
}

function assertBusinessNumber(record) {
  const phone = normalizePhone(record?.display_phone_number);
  if (phone !== BUSINESS_NUMBER) {
    throw Object.assign(
      new Error("Il numero configurato non è +39 333 7802795."),
      { status: 409 },
    );
  }
  const status = String(record.status || "CONNECTED").toUpperCase();
  if (status !== "CONNECTED") {
    throw Object.assign(new Error("Il numero WhatsApp Business non è connesso."), { status: 409 });
  }
  if (!record.id) {
    throw Object.assign(new Error("Meta non ha restituito l'id del numero."), { status: 502 });
  }
  return {
    phone_number: BUSINESS_NUMBER,
    display_number: BUSINESS_NUMBER_DISPLAY,
    name: record.verified_name || "WhatsApp Business",
    status: "connected",
    conversations_enabled: true,
    phone_number_id: String(record.id),
  };
}

export function createWhatsAppClient({
  accessToken,
  phoneNumberId,
  businessAccountId,
  graphVersion: versionValue,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!accessToken) {
    throw Object.assign(new Error("Manca WHATSAPP_ACCESS_TOKEN."), { status: 500 });
  }
  if (!phoneNumberId && !businessAccountId) {
    throw Object.assign(
      new Error("Manca WHATSAPP_PHONE_NUMBER_ID oppure WHATSAPP_BUSINESS_ACCOUNT_ID."),
      { status: 500 },
    );
  }
  const version = graphVersion(versionValue);
  let resolvedId = phoneNumberId ? String(phoneNumberId) : null;

  async function request(method, path, { query, body } = {}) {
    const url = new URL(`/${version}${path}`, GRAPH_HOST);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value != null && value !== "") url.searchParams.set(key, String(value));
      }
    }
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw Object.assign(new Error("WhatsApp non ha risposto in tempo."), { status: 504 });
      }
      throw Object.assign(new Error("WhatsApp non è raggiungibile."), { status: 502 });
    }
    const raw = await response.text();
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) throw graphError(payload, response.status);
    return payload ?? {};
  }

  return {
    get phoneNumberId() {
      return resolvedId;
    },

    async confirmBusinessNumber() {
      if (businessAccountId) {
        const page = await request("GET", `/${encodeURIComponent(businessAccountId)}/phone_numbers`, {
          query: { fields: "id,display_phone_number,verified_name,status", limit: 100 },
        });
        const match = (page.data || []).find(
          (item) => normalizePhone(item.display_phone_number) === BUSINESS_NUMBER,
        );
        if (!match) {
          throw Object.assign(
            new Error("Il numero +39 333 7802795 non è tra i numeri WhatsApp Business di questo account."),
            { status: 404 },
          );
        }
        if (phoneNumberId && String(match.id) !== String(phoneNumberId)) {
          throw Object.assign(
            new Error("WHATSAPP_PHONE_NUMBER_ID non corrisponde a +39 333 7802795."),
            { status: 409 },
          );
        }
        const account = assertBusinessNumber(match);
        resolvedId = account.phone_number_id;
        return account;
      }
      const record = await request("GET", `/${encodeURIComponent(phoneNumberId)}`, {
        query: { fields: "id,display_phone_number,verified_name,status" },
      });
      const account = assertBusinessNumber({ ...record, id: record.id || phoneNumberId });
      resolvedId = account.phone_number_id;
      return account;
    },

    async sendText({ to, body }) {
      if (!resolvedId) await this.confirmBusinessNumber();
      const payload = await request("POST", `/${encodeURIComponent(resolvedId)}/messages`, {
        body: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body },
        },
      });
      const id = payload.messages?.[0]?.id || null;
      if (!id) {
        throw Object.assign(new Error("WhatsApp non ha accettato il messaggio."), { status: 502 });
      }
      return {
        id,
        direction: "outbound",
        status: payload.messages[0].message_status || "accepted",
        created_at: new Date().toISOString(),
        from: { phone_number: BUSINESS_NUMBER },
        text: { body },
      };
    },
  };
}

import { BUSINESS_NUMBER, BUSINESS_NUMBER_DISPLAY, normalizePhone } from "./phone.mjs";

export function baseFromKey(apiKey) {
  const match = String(apiKey || "").match(/^(?:bk|bm)_(us1|eu1)_/);
  if (!match) {
    throw Object.assign(
      new Error("Prefisso della chiave non riconosciuto. Imposta BIRD_API_BASE."),
      { status: 500 },
    );
  }
  return `https://${match[1]}.platform.bird.com`;
}

function birdError(payload, status) {
  const code = payload?.code || payload?.error?.code || null;
  let message = "Bird non è raggiungibile.";
  if (code === "WhatsAppServiceWindowClosed" || code === "E15044") {
    message = "La finestra di 24 ore è chiusa. Il testo libero si può inviare solo dopo un messaggio del contatto.";
  } else if (status === 401) {
    message = "Autenticazione Bird rifiutata. Controlla la chiave API.";
  } else if (status === 403) {
    message = "La chiave API non ha il permesso per questa operazione.";
  } else if (status === 404) {
    message = "Risorsa non trovata su Bird.";
  } else if (status === 422) {
    message = "Bird ha rifiutato il messaggio.";
  } else if (status === 402) {
    message = "Il workspace Bird non può inviare questo messaggio.";
  }
  if (code && code !== "WhatsAppServiceWindowClosed" && code !== "E15044") {
    message = `${message} (${code})`;
  }
  const error = new Error(message);
  error.status = status || 502;
  error.code = code;
  return error;
}

export function createBirdClient({ apiKey, apiBase, fetchImpl = globalThis.fetch, workspaceId } = {}) {
  if (!apiKey) {
    throw Object.assign(new Error("Manca BIRD_API_KEY."), { status: 500 });
  }
  const base = (apiBase || baseFromKey(apiKey)).replace(/\/$/, "");

  async function request(method, path, { query, body, idempotencyKey } = {}) {
    const url = new URL(path, `${base}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value == null || value === "") continue;
        url.searchParams.set(key, String(value));
      }
    }
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    };
    if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

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
        throw Object.assign(new Error("Bird non ha risposto in tempo."), { status: 504 });
      }
      throw Object.assign(new Error("Bird non è raggiungibile."), { status: 502 });
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
    if (!response.ok) throw birdError(payload, response.status);
    return payload ?? {};
  }

  return {
    async confirmBusinessNumber() {
      const page = await request("GET", "/v1/whatsapp/numbers", {
        query: { phone_number: BUSINESS_NUMBER, limit: 5 },
      });
      const match = (page.data || []).find(
        (item) => normalizePhone(item.phone_number) === BUSINESS_NUMBER,
      );
      if (!match) {
        throw Object.assign(
          new Error("Il numero +39 333 7802795 non è un numero WhatsApp Business di questo workspace."),
          { status: 404 },
        );
      }
      if (match.status !== "connected") {
        throw Object.assign(
          new Error("Il numero WhatsApp Business non è connesso."),
          { status: 409 },
        );
      }
      return {
        phone_number: BUSINESS_NUMBER,
        display_number: BUSINESS_NUMBER_DISPLAY,
        name: match.name || "WhatsApp Business",
        status: match.status,
        conversations_enabled: match.conversations_enabled !== false,
      };
    },

    listConversations({ q, startingAfter, limit = 30 } = {}) {
      return request("GET", "/v1/whatsapp/conversations", {
        query: {
          business_phone_number: BUSINESS_NUMBER,
          q,
          starting_after: startingAfter,
          limit,
        },
      });
    },

    getConversation(conversationId) {
      return request("GET", `/v1/whatsapp/conversations/${encodeURIComponent(conversationId)}`);
    },

    listMessages(conversationId, { startingAfter, limit = 40 } = {}) {
      return request(
        "GET",
        `/v1/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages`,
        { query: { starting_after: startingAfter, limit } },
      );
    },

    sendText({ to, body, idempotencyKey }) {
      return request("POST", "/v1/whatsapp/messages", {
        idempotencyKey,
        body: {
          to,
          from: BUSINESS_NUMBER,
          text: { body },
        },
      });
    },
  };
}

const accountEl = document.querySelector("#account");
const bannerEl = document.querySelector("#banner");
const layoutEl = document.querySelector("#layout");
const listStateEl = document.querySelector("#conversation-state");
const listEl = document.querySelector("#conversation-list");
const moreEl = document.querySelector("#more-conversations");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#q");
const placeholderEl = document.querySelector("#thread-placeholder");
const threadEl = document.querySelector("#thread");
const threadHeadEl = document.querySelector("#thread-head");
const olderEl = document.querySelector("#older");
const messageStateEl = document.querySelector("#message-state");
const messagesEl = document.querySelector("#messages");
const messagesWrapEl = document.querySelector("#messages-wrap");
const composerForm = document.querySelector("#composer");
const bodyInput = document.querySelector("#body");
const sendButton = document.querySelector("#send");
const composerNote = document.querySelector("#composer-note");

const state = {
  account: null,
  conversations: [],
  conversationCursor: null,
  query: "",
  listToken: 0,
  selectedId: null,
  selected: null,
  messages: [],
  messageCursor: null,
  messageToken: 0,
  sending: false,
  pendingSend: null,
};

function showBanner(message) {
  if (!message) {
    bannerEl.hidden = true;
    bannerEl.textContent = "";
    return;
  }
  bannerEl.hidden = false;
  bannerEl.textContent = message;
}

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload.error || "Richiesta non riuscita.");
  }
  return payload;
}

function romeParts(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return { date, day, time };
}

function formatWhen(iso) {
  const parts = romeParts(iso);
  if (!parts) return "";
  const today = romeParts(new Date());
  if (parts.day === today.day) return parts.time;
  const label = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "numeric",
    month: "short",
  }).format(parts.date);
  return `${label} ${parts.time}`;
}

function preview(conversation) {
  if (conversation.last_direction === "inbound") return "Messaggio in entrata";
  if (conversation.last_direction === "outbound") return "Messaggio in uscita";
  return "Nessun messaggio";
}

function windowCopy(conversation) {
  if (conversation.service_window?.status === "open") {
    const until = formatWhen(conversation.service_window.ends_at);
    return until ? `Finestra aperta fino alle ${until}` : "Finestra aperta";
  }
  return "Finestra chiusa";
}

function setListState(message) {
  listStateEl.hidden = !message;
  listStateEl.textContent = message || "";
}

function renderConversations() {
  listEl.replaceChildren();
  for (const conversation of state.conversations) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation";
    button.dataset.id = conversation.id;
    if (conversation.id === state.selectedId) button.setAttribute("aria-current", "true");

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = conversation.display_name;
    if (conversation.unread_count > 0) {
      const badge = document.createElement("span");
      badge.className = "unread";
      badge.textContent = String(conversation.unread_count);
      badge.setAttribute("aria-label", `${conversation.unread_count} non letti`);
      name.append(badge);
    }

    const time = document.createElement("span");
    time.className = "time";
    time.textContent = formatWhen(conversation.last_at);

    const line = document.createElement("span");
    line.className = "preview";
    const phone = conversation.phone_display ? `${conversation.phone_display} · ` : "";
    line.textContent = `${phone}${preview(conversation)}`;

    button.append(name, time, line);
    listEl.append(button);
  }
  moreEl.hidden = !state.conversationCursor;
}

function renderMessages() {
  messagesEl.replaceChildren();
  const chronological = [...state.messages].reverse();
  const contactName = state.selected?.display_name || "Contatto";
  const businessName = state.account?.name || "CodeNinja";
  for (const message of chronological) {
    const item = document.createElement("li");
    item.className = `message ${message.direction === "outbound" ? "outbound" : "inbound"}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    const sender = document.createElement("span");
    if (message.direction === "outbound") sender.textContent = businessName;
    else sender.textContent = message.sender_name || contactName;
    const when = document.createElement("span");
    const status = message.direction === "outbound" && message.status_label ? ` · ${message.status_label}` : "";
    when.textContent = `${formatWhen(message.created_at)}${status}`;
    meta.append(sender, when);

    item.append(meta);
    if (message.text) {
      const body = document.createElement("p");
      body.className = "body";
      body.textContent = message.text;
      item.append(body);
    }
    for (const media of message.media || []) {
      const box = document.createElement("div");
      box.className = "media";
      box.textContent = media.detail ? `${media.label} · ${media.detail}` : media.label;
      item.append(box);
    }
    messagesEl.append(item);
  }
}

function renderComposer() {
  const open = state.selected?.service_window?.status === "open";
  bodyInput.disabled = !open || state.sending;
  sendButton.disabled = !open || state.sending || bodyInput.value.trim().length === 0;
  sendButton.textContent = state.sending ? "Invio…" : "Invia";
  composerNote.classList.toggle("window-closed", !open);
  composerNote.textContent = open
    ? "Solo testo, in questa conversazione."
    : "La finestra di 24 ore è chiusa. Il testo libero si può inviare solo dopo un messaggio del contatto.";
}

function renderThread() {
  const selected = state.selected;
  if (!selected) {
    threadEl.hidden = true;
    placeholderEl.hidden = false;
    layoutEl.classList.remove("thread-open");
    return;
  }
  placeholderEl.hidden = true;
  threadEl.hidden = false;
  layoutEl.classList.add("thread-open");
  threadHeadEl.replaceChildren();

  const identity = document.createElement("div");
  const title = document.createElement("h2");
  title.className = "thread-title";
  title.textContent = selected.display_name;
  const sub = document.createElement("p");
  sub.className = "sub";
  const phone = selected.phone_display || "Numero non disponibile";
  const windowClass = selected.service_window?.status === "open" ? "window-open" : "window-closed";
  sub.append(document.createTextNode(`${phone} · `));
  const windowLabel = document.createElement("span");
  windowLabel.className = windowClass;
  windowLabel.textContent = windowCopy(selected);
  sub.append(windowLabel);
  identity.append(title, sub);

  const actions = document.createElement("div");
  const back = document.createElement("button");
  back.type = "button";
  back.className = "back";
  back.textContent = "Conversazioni";
  back.addEventListener("click", () => {
    state.selectedId = null;
    state.selected = null;
    renderThread();
  });
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "text-button";
  refresh.textContent = "Aggiorna";
  refresh.addEventListener("click", () => loadMessages({ append: false }));
  actions.append(back, refresh);
  threadHeadEl.append(identity, actions);
  olderEl.hidden = !state.messageCursor;
  renderMessages();
  renderComposer();
}

async function loadSession() {
  const payload = await api("/api/session");
  state.account = payload.account;
  accountEl.textContent = `${payload.account.name} · ${payload.account.phone_display}`;
}

async function loadConversations({ append = false } = {}) {
  const token = ++state.listToken;
  if (!append) setListState("Caricamento conversazioni…");
  try {
    const params = new URLSearchParams();
    if (state.query) params.set("q", state.query);
    if (append && state.conversationCursor) params.set("starting_after", state.conversationCursor);
    const payload = await api(`/api/conversations?${params.toString()}`);
    if (token !== state.listToken) return;
    state.conversations = append ? [...state.conversations, ...payload.data] : payload.data;
    state.conversationCursor = payload.next_cursor;
    if (state.selectedId) {
      state.selected = state.conversations.find((item) => item.id === state.selectedId) || state.selected;
    }
    setListState(state.conversations.length ? "" : state.query
      ? "Nessuna conversazione corrisponde alla ricerca."
      : "Nessuna conversazione ricevuta da WhatsApp.");
    renderConversations();
    if (state.selected) renderThread();
  } catch (error) {
    if (token !== state.listToken) return;
    if (!append) {
      state.conversations = [];
      state.conversationCursor = null;
      renderConversations();
    }
    setListState(error instanceof TypeError
      ? "Impossibile caricare le conversazioni."
      : error.message);
  }
}

async function loadMessages({ append = false } = {}) {
  if (!state.selectedId) return;
  const token = ++state.messageToken;
  const selectedId = state.selectedId;
  messageStateEl.hidden = false;
  messageStateEl.textContent = "Caricamento messaggi…";
  const previousHeight = messagesWrapEl.scrollHeight;
  try {
    const params = new URLSearchParams();
    if (append && state.messageCursor) params.set("starting_after", state.messageCursor);
    const payload = await api(`/api/conversations/${encodeURIComponent(selectedId)}/messages?${params.toString()}`);
    if (token !== state.messageToken || selectedId !== state.selectedId) return;
    state.messages = append ? [...state.messages, ...payload.data] : payload.data;
    state.messageCursor = payload.next_cursor;
    messageStateEl.hidden = state.messages.length > 0;
    messageStateEl.textContent = state.messages.length ? "" : "Nessun messaggio negli ultimi 30 giorni.";
    renderThread();
    if (append) {
      messagesWrapEl.scrollTop = messagesWrapEl.scrollHeight - previousHeight;
    } else {
      messagesWrapEl.scrollTop = messagesWrapEl.scrollHeight;
    }
  } catch (error) {
    if (token !== state.messageToken) return;
    messageStateEl.hidden = false;
    messageStateEl.textContent = error instanceof TypeError
      ? "Impossibile caricare i messaggi."
      : error.message;
  }
}

async function openConversation(id) {
  showBanner("");
  state.selectedId = id;
  state.selected = state.conversations.find((item) => item.id === id) || null;
  state.messages = [];
  state.messageCursor = null;
  state.pendingSend = null;
  renderConversations();
  renderThread();
  try {
    const payload = await api(`/api/conversations/${encodeURIComponent(id)}`);
    if (state.selectedId !== id) return;
    state.selected = payload.conversation;
    const index = state.conversations.findIndex((item) => item.id === id);
    if (index >= 0) state.conversations[index] = payload.conversation;
    renderConversations();
    renderThread();
  } catch (error) {
    if (state.selectedId !== id) return;
    showBanner(error instanceof TypeError ? "Impossibile aprire la conversazione." : error.message);
  }
  await loadMessages({ append: false });
}

async function sendMessage(event) {
  event.preventDefault();
  if (!state.selectedId || state.sending) return;
  const text = bodyInput.value.replace(/\r\n/g, "\n").trim();
  if (!text) return;
  if (!state.pendingSend || state.pendingSend.text !== text) {
    state.pendingSend = { text, key: crypto.randomUUID() };
  }
  state.sending = true;
  renderComposer();
  showBanner("");
  try {
    const payload = await api(`/api/conversations/${encodeURIComponent(state.selectedId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, idempotency_key: state.pendingSend.key }),
    });
    state.pendingSend = null;
    bodyInput.value = "";
    if (payload.message?.id && !state.messages.some((item) => item.id === payload.message.id)) {
      state.messages = [payload.message, ...state.messages];
    }
    messageStateEl.hidden = true;
    renderThread();
    messagesWrapEl.scrollTop = messagesWrapEl.scrollHeight;
  } catch (error) {
    showBanner(error instanceof TypeError ? "Impossibile inviare il messaggio." : error.message);
    renderComposer();
  } finally {
    state.sending = false;
    renderComposer();
  }
}

listEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  openConversation(button.dataset.id);
});

moreEl.addEventListener("click", () => loadConversations({ append: true }));
olderEl.addEventListener("click", () => loadMessages({ append: true }));
searchForm.addEventListener("submit", (event) => event.preventDefault());
bodyInput.addEventListener("input", () => {
  if (state.pendingSend && state.pendingSend.text !== bodyInput.value.trim()) state.pendingSend = null;
  renderComposer();
});
composerForm.addEventListener("submit", sendMessage);

let searchTimer = 0;
searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    state.query = searchInput.value.trim();
    loadConversations({ append: false });
  }, 250);
});

try {
  await loadSession();
  await loadConversations({ append: false });
} catch (error) {
  accountEl.textContent = "+39 333 7802795";
  setListState("");
  showBanner(error.message || "Impossibile collegarsi a WhatsApp Business.");
  placeholderEl.querySelector("p").textContent = "Impossibile collegarsi a WhatsApp Business.";
}

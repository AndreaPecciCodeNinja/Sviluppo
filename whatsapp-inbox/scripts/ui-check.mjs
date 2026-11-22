// Drives the Italian inbox against the local store. It does not call Meta or any other network API.
import { spawn } from "node:child_process";
import { createMessageStore } from "../lib/store.mjs";
import { createAppServer } from "../server.mjs";

const calls = [];
const client = {
  async confirmBusinessNumber() {
    calls.push("confirm");
    return {
      phone_number: "+393337802795",
      display_number: "+39 333 7802795",
      name: "CodeNinja",
      status: "connected",
      conversations_enabled: true,
      phone_number_id: "106540352242922",
    };
  },
  async sendText(input) {
    calls.push(["send", input]);
    return {
      id: "wamid.ui",
      direction: "outbound",
      status: "accepted",
      created_at: new Date().toISOString(),
      from: { phone_number: "+393337802795" },
      text: { body: input.body },
    };
  },
};

const store = createMessageStore();
const now = Math.floor(Date.now() / 1000);
await store.ingest({
  metadata: { display_phone_number: "393337802795", phone_number_id: "106540352242922" },
  contacts: [{ wa_id: "393331112233", profile: { name: "Ada Test" } }],
  messages: [
    { from: "393331112233", id: "wamid.text", timestamp: String(now - 30), type: "text", text: { body: "Messaggio di prova" } },
    { from: "393331112233", id: "wamid.image", timestamp: String(now - 90), type: "image", image: { caption: "Foto di prova", id: "hidden" } },
  ],
});
await store.ingest({
  metadata: { display_phone_number: "393337802795", phone_number_id: "106540352242922" },
  contacts: [{ wa_id: "393339998877", profile: { name: "Chiara Test" } }],
  messages: [{
    from: "393339998877",
    id: "wamid.old",
    timestamp: String(now - 60 * 60 * 48),
    type: "text",
    text: { body: "Testo già inviato" },
  }],
});

const server = await createAppServer({
  client,
  store,
  port: 8787,
  appSecret: "ui-check",
  verifyToken: "ui-check",
  phoneNumberId: "106540352242922",
});

const debugPort = 9333;
const chrome = spawn("google-chrome", [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/whatsapp-inbox-chrome`,
  "about:blank",
], { stdio: "ignore" });

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

try {
  let version;
  for (let attempt = 0; attempt < 50 && !version; attempt += 1) {
    try {
      version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!version) throw new Error("Chrome non si è avviato.");
  const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  const target = created.ok
    ? await created.json()
    : (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json())[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let next = 1;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  });
  const send = (method, params = {}) => {
    const id = next++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  };
  const waitFor = async (text) => {
    const started = Date.now();
    let body = "";
    while (Date.now() - started < 4000) {
      body = await evaluate("document.body.innerText");
      if (body.includes(text)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Testo non trovato: ${text}\n${body}`);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://127.0.0.1:8787/" });
  await waitFor("+39 333 7802795");
  await waitFor("Ada Test");
  await evaluate(`document.querySelector('[data-id="393331112233"]').click()`);
  await waitFor("Messaggio di prova");
  await waitFor("Immagine");
  await waitFor("Foto di prova");
  check(await evaluate("document.querySelector('#send').disabled") === true, "Invia è attivo senza testo");
  await evaluate(`(() => {
    const input = document.querySelector('#q');
    input.value = 'nessuno';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("Nessuna conversazione corrisponde alla ricerca.");
  await evaluate(`(() => {
    const input = document.querySelector('#q');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("Chiara Test");
  await evaluate(`document.querySelector('[data-id="393331112233"]').click()`);
  await waitFor("Messaggio di prova");
  await evaluate(`(() => {
    const body = document.querySelector('#body');
    body.value = 'Messaggio di verifica';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#composer').requestSubmit();
  })()`);
  await waitFor("Messaggio di verifica");
  check(calls.filter((call) => call[0] === "send").length === 1, "invio non registrato");
  check(calls.find((call) => call[0] === "send")?.[1]?.to === "+393331112233", "destinatario errato");
  await evaluate(`document.querySelector('[data-id="393339998877"]').click()`);
  await waitFor("Finestra chiusa");
  await waitFor("Testo già inviato");
  check(await evaluate("document.querySelector('#send').disabled") === true, "la finestra chiusa lascia Invia attivo");
  await evaluate(`document.querySelector('#composer').requestSubmit()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  check(calls.filter((call) => call[0] === "send").length === 1, "la finestra chiusa ha chiamato l'invio");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const { writeFile } = await import("node:fs/promises");
  await writeFile("/tmp/whatsapp-cloud-closed.png", Buffer.from(shot.data, "base64"));
} finally {
  chrome.kill();
  await new Promise((resolve) => server.close(resolve));
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Interfaccia verificata sul server locale, senza chiamate a Meta.");

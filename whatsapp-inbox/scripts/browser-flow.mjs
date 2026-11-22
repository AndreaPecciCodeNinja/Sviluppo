import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.SCREENSHOT_DIR || "/tmp/whatsapp-inbox-shots";
const debugPort = 9333;

const sends = [];
const conversations = [
  {
    id: "wacv_open123",
    business_phone_number: "+393337802795",
    inbox_status: "open",
    unread_count: 1,
    updated_at: "2026-11-22T09:30:00Z",
    recipient: { display_name: "Ada Test", phone_number: "+393331112233" },
    service_window: { status: "open", ends_at: "2026-11-22T18:00:00Z" },
    last_message: { id: "wam_text", direction: "inbound", created_at: "2026-11-22T09:30:00Z" },
  },
  {
    id: "wacv_closed1",
    business_phone_number: "+393337802795",
    inbox_status: "open",
    unread_count: 0,
    updated_at: "2026-11-21T09:00:00Z",
    recipient: { display_name: "Chiara Test", phone_number: "+393339998877" },
    service_window: { status: "closed", ends_at: null },
    last_message: { id: "wam_old", direction: "outbound", created_at: "2026-11-21T09:00:00Z" },
  },
  {
    id: "wacv_empty01",
    business_phone_number: "+393337802795",
    inbox_status: "open",
    unread_count: 0,
    updated_at: "2026-11-20T09:00:00Z",
    recipient: { display_name: "Senza messaggi", phone_number: "+393330001111" },
    service_window: { status: "closed", ends_at: null },
    last_message: null,
  },
];

const messages = {
  wacv_open123: [
    {
      id: "wam_text",
      direction: "inbound",
      status: "received",
      created_at: "2026-11-22T09:30:00Z",
      from: { display_name: "Ada Test", phone_number: "+393331112233" },
      to: { phone_number: "+393337802795" },
      text: { body: "Messaggio di prova" },
    },
    {
      id: "wam_image",
      direction: "inbound",
      status: "received",
      created_at: "2026-11-22T09:00:00Z",
      from: { display_name: "Ada Test", phone_number: "+393331112233" },
      to: { phone_number: "+393337802795" },
      image: { caption: "Foto di prova", url: "https://cdn.example/secret.jpg" },
    },
  ],
  wacv_empty01: [],
  wacv_closed1: [
    {
      id: "wam_old",
      direction: "outbound",
      status: "delivered",
      created_at: "2026-11-21T09:00:00Z",
      from: { phone_number: "+393337802795" },
      to: { phone_number: "+393339998877" },
      text: { body: "Testo già inviato" },
    },
  ],
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function startStub() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const auth = req.headers.authorization || "";
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!auth.startsWith("Bearer bk_eu1_")) {
      send(401, { code: "unauthorized", message: "missing key" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/whatsapp/numbers") {
      send(200, {
        data: [{
          phone_number: "+393337802795",
          name: "CodeNinja",
          status: "connected",
          conversations_enabled: true,
        }],
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/whatsapp/conversations") {
      if (url.searchParams.get("business_phone_number") !== "+393337802795") {
        send(400, { message: "missing business number" });
        return;
      }
      const q = url.searchParams.get("q");
      if (q === "errore") {
        send(500, { code: "stub_error", message: "boom" });
        return;
      }
      const data = q === "vuoto" ? [] : conversations.filter((item) => !q || item.recipient.display_name.toLowerCase().includes(q.toLowerCase()));
      send(200, { data, next_cursor: null });
      return;
    }
    const thread = url.pathname.match(/^\/v1\/whatsapp\/conversations\/([^/]+)(?:\/messages)?$/);
    if (thread && req.method === "GET") {
      const id = decodeURIComponent(thread[1]);
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) {
        send(404, { message: "missing" });
        return;
      }
      if (url.pathname.endsWith("/messages")) {
        send(200, { data: messages[id] || [], next_cursor: null });
        return;
      }
      send(200, conversation);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/whatsapp/messages") {
      const body = await readBody(req);
      sends.push(body);
      if (body.template || !body.text?.body || body.from !== "+393337802795") {
        send(422, { code: "bad_send", message: "unexpected payload" });
        return;
      }
      send(202, {
        id: "wam_sent",
        direction: "outbound",
        status: "accepted",
        created_at: new Date().toISOString(),
        from: { phone_number: "+393337802795" },
        to: { phone_number: body.to },
        text: { body: body.text.body },
      });
      return;
    }
    send(404, { message: `unknown ${req.method} ${url.pathname}` });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        base: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

function startApp(apiBase) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      BIRD_API_KEY: "bk_eu1_localtest",
      BIRD_API_BASE: apiBase,
      PORT: "8787",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start\n${logs}`)), 5000);
    const wait = () => {
      if (logs.includes("http://127.0.0.1:8787")) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on("data", wait);
    child.stderr.on("data", wait);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${logs}`));
    });
  });
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.next = 1;
    this.pending = new Map();
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  }

  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(details.exception?.description || details.text || JSON.stringify(details));
    }
    return result.result.value;
  }
}

async function openChrome() {
  const chrome = spawn("google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/whatsapp-inbox-chrome`,
    "about:blank",
  ], { stdio: "ignore" });
  const deadline = Date.now() + 8000;
  let version;
  while (Date.now() < deadline) {
    try {
      version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!version) throw new Error("chrome did not open a debugging port");
  const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  const target = created.ok ? await created.json() : (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json())[0];
  const page = new Cdp(target.webSocketDebuggerUrl);
  await page.ready();
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  return { chrome, page };
}

async function waitForText(page, text) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 4000) {
    last = await page.eval("document.body.innerText");
    if (last.includes(text)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Testo non trovato: ${text}\n${last}`);
}

async function shot(page, name) {
  const image = await page.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(outDir, name);
  await writeFile(file, Buffer.from(image.data, "base64"));
  return file;
}

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const stub = await startStub();
const app = await startApp(stub.base);
if (process.argv.includes("--serve")) {
  console.log("READY http://127.0.0.1:8787");
  await new Promise(() => {});
}
const browser = await openChrome();
await mkdir(outDir, { recursive: true });

try {
  await browser.page.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.page.send("Page.navigate", { url: "http://127.0.0.1:8787/" });
  await waitForText(browser.page, "+39 333 7802795");
  await waitForText(browser.page, "Ada Test");
  await browser.page.eval(`document.querySelector('[data-id="wacv_open123"]').click()`);
  await waitForText(browser.page, "Messaggio di prova");
  await waitForText(browser.page, "Immagine");
  await waitForText(browser.page, "Foto di prova");
  const openSendDisabled = await browser.page.eval("document.querySelector('#send').disabled");
  check(openSendDisabled === true, "il pulsante Invia parte disabilitato finche il testo e vuoto");
  await shot(browser.page, "thread-with-message.png");

  await browser.page.eval(`(() => {
    const input = document.querySelector('#q');
    input.value = 'vuoto';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitForText(browser.page, "Nessuna conversazione corrisponde alla ricerca.");
  await shot(browser.page, "empty-search.png");

  await browser.page.eval(`(() => {
    const input = document.querySelector('#q');
    input.value = 'errore';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitForText(browser.page, "Bird non è raggiungibile.");
  await shot(browser.page, "error-search.png");

  await browser.page.eval(`(() => {
    const input = document.querySelector('#q');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitForText(browser.page, "Chiara Test");
  await browser.page.eval(`document.querySelector('[data-id="wacv_open123"]').click()`);
  await waitForText(browser.page, "Messaggio di prova");
  await browser.page.eval(`(() => {
    const body = document.querySelector('#body');
    body.value = 'Messaggio di verifica';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#composer').requestSubmit();
  })()`);
  await waitForText(browser.page, "Messaggio di verifica");
  await shot(browser.page, "after-send.png");
  check(sends.length === 1, `attesi 1 invii, trovati ${sends.length}`);
  check(sends[0]?.from === "+393337802795", "il mittente non e il numero aziendale");
  check(sends[0]?.to === "+393331112233", "il destinatario non e il contatto della conversazione");
  check(sends[0]?.text?.body === "Messaggio di verifica", "il testo inviato non coincide");
  check(sends[0]?.template == null, "il payload contiene un modello");

  await browser.page.eval(`document.querySelector('[data-id="wacv_closed1"]').click()`);
  await waitForText(browser.page, "Finestra chiusa");
  await waitForText(browser.page, "Testo già inviato");
  const closedDisabled = await browser.page.eval("document.querySelector('#send').disabled");
  check(closedDisabled === true, "la finestra chiusa lascia Invia attivo");
  await browser.page.eval(`document.querySelector('#composer').requestSubmit()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  check(sends.length === 1, "la finestra chiusa ha inviato un messaggio");
  await shot(browser.page, "closed-window.png");

  await browser.page.eval(`document.querySelector('[data-id="wacv_empty01"]').click()`);
  await waitForText(browser.page, "Nessun messaggio negli ultimi 30 giorni.");
  await shot(browser.page, "empty-thread.png");

  await browser.page.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await waitForText(browser.page, "Conversazioni");
  await shot(browser.page, "mobile-thread.png");
  await browser.page.eval(`document.querySelector('.back').click()`);
  await waitForText(browser.page, "Ada Test");
  const listHidden = await browser.page.eval("getComputedStyle(document.querySelector('#list-pane')).display === 'none'");
  check(listHidden === false, "su mobile l'elenco resta nascosto dopo Indietro");
  await shot(browser.page, "mobile-list.png");
} finally {
  browser.chrome.kill();
  app.kill();
  await new Promise((resolve) => stub.server.close(resolve));
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Flusso verificato contro lo stub locale. Invii registrati: ${sends.length}`);

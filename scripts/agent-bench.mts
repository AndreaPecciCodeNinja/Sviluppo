/**
 * Local question/answer bench. A person asks, the agent answers from that
 * question and the questions already asked. No WhatsApp and no Bird.
 * Listens only on 127.0.0.1:3300.
 */
import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { answerCustomer } from "../src/lib/agents/customer-turn.ts";

const HOST = "127.0.0.1";
const PORT = 3300;

function revision(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "sconosciuta";
  }
}

const REV = revision();

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32_000) {
        reject(new Error("too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
  type: string,
) {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
  });
  response.end(body);
}

const page = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Domande e risposte</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font: 16px/1.45 "Iowan Old Style", Palatino, Georgia, serif; background: #f4f0e8; color: #1c1915; }
    main { max-width: 40rem; margin: 0 auto; padding: 1.5rem 1rem 2rem; }
    h1 { font-size: 1.45rem; margin: 0 0 0.35rem; }
    p.lead { margin: 0 0 1rem; color: #5c564c; }
    #log { display: flex; flex-direction: column; gap: 0.7rem; min-height: 12rem; }
    article { border-radius: 12px; padding: 0.7rem 0.85rem; }
    article.person { background: #fff; border: 1px solid #e2d9cc; }
    article.agent { background: #1c1915; color: #f4f0e8; }
    article span { display: block; font: 12px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.7; margin-bottom: 0.25rem; }
    article p { margin: 0; white-space: pre-wrap; }
    form { display: flex; gap: 0.5rem; margin-top: 1rem; }
    input { flex: 1; font: inherit; padding: 0.7rem 0.8rem; border-radius: 10px; border: 1px solid #c9bfb0; background: #fff; }
    button { font: 15px/1 ui-sans-serif, system-ui, sans-serif; border: 0; border-radius: 10px; padding: 0 1rem; background: #1c1915; color: #f4f0e8; }
  </style>
</head>
<body>
  <main>
    <h1>Domande e risposte</h1>
    <p class="lead">Una persona fa una domanda. L’agente risponde in base a quella domanda. Versione ${REV}.</p>
    <div id="log" aria-live="polite"></div>
    <form id="ask">
      <input id="question" name="question" autocomplete="off" placeholder="Scrivi la domanda e premi Invio" />
      <button type="submit">Chiedi</button>
    </form>
  </main>
  <script>
    const prior = [];
    const log = document.querySelector("#log");
    const form = document.querySelector("#ask");
    const field = document.querySelector("#question");

    function bubble(role, text) {
      const item = document.createElement("article");
      item.className = role;
      const who = document.createElement("span");
      who.textContent = role === "person" ? "Persona" : "Agente";
      const body = document.createElement("p");
      body.textContent = text;
      item.append(who, body);
      log.append(item);
      item.scrollIntoView({ block: "nearest" });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const question = field.value.trim();
      if (!question) return;
      field.value = "";
      bubble("person", question);
      const response = await fetch("/reply", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, prior }),
      });
      const data = await response.json();
      const answer = typeof data.answer === "string" ? data.answer : "";
      prior.push(question, answer);
      bubble("agent", answer);
      field.focus();
    });
  </script>
</body>
</html>
`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}`);
  if (request.method === "GET" && url.pathname === "/") {
    send(response, 200, page, "text/html; charset=utf-8");
    return;
  }
  if (request.method === "POST" && url.pathname === "/reply") {
    try {
      const raw = await readBody(request);
      const payload = JSON.parse(raw) as { question?: unknown; prior?: unknown };
      const question = typeof payload.question === "string" ? payload.question.trim() : "";
      const prior = Array.isArray(payload.prior)
        ? payload.prior.filter((item): item is string => typeof item === "string")
        : [];
      if (!question) {
        send(response, 400, JSON.stringify({ error: "manca la domanda" }), "application/json");
        return;
      }
      const answer = answerCustomer({ question, prior });
      send(response, 200, JSON.stringify({ answer }), "application/json");
    } catch {
      send(response, 400, JSON.stringify({ error: "domanda non valida" }), "application/json");
    }
    return;
  }
  send(response, 404, "not found", "text/plain; charset=utf-8");
});

server.listen(PORT, HOST, () => {
  console.log(`Domande e risposte su http://${HOST}:${PORT} (${REV})`);
});

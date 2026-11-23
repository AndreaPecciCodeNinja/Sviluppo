import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORTA = Number(process.env.PORTA_PANNELLO || 3020);
const HOST = "127.0.0.1";
const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));

const SERVIZI = [
  { id: "hub", nome: "Hub portali", porta: 3010 },
  { id: "crm", nome: "CRM Demo", porta: 3013 },
  { id: "assistenza-tecnica", nome: "Assistenza Tecnica", porta: 3014 },
  { id: "assistenza", nome: "Collegamento tablet", porta: 3021 },
  { id: "sincronia", nome: "Sincronizzatore", porta: 3022 },
  { id: "macchina", nome: "Macchina simulata", porta: 3023 },
  { id: "pannello", nome: "Pannello", porta: 3020 },
];

let comandoInCorso = null;

function portaAperta(porta) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: porta });
    let chiuso = false;
    const fine = (accesa) => {
      if (chiuso) return;
      chiuso = true;
      socket.destroy();
      resolve(accesa);
    };
    socket.setTimeout(400);
    socket.once("connect", () => fine(true));
    socket.once("timeout", () => fine(false));
    socket.once("error", () => fine(false));
  });
}

async function stato() {
  const servizi = await Promise.all(SERVIZI.map(async (servizio) => ({
    ...servizio,
    accesa: await portaAperta(servizio.porta),
  })));
  return { servizi, aggiornato: new Date().toISOString(), comandoInCorso };
}

function esegui(script) {
  if (comandoInCorso) {
    return Promise.resolve({
      ok: false,
      codice: 409,
      messaggio: "Un comando è già in corso.",
    });
  }
  comandoInCorso = script;
  return new Promise((resolve) => {
    const processo = spawn("bash", [join(RADICE, script)], { cwd: RADICE });
    let uscita = "";
    const aggiungi = (pezzo) => {
      uscita += pezzo.toString();
      if (uscita.length > 8000) uscita = uscita.slice(-8000);
    };
    processo.stdout.on("data", aggiungi);
    processo.stderr.on("data", aggiungi);
    const timer = setTimeout(() => {
      processo.kill("SIGTERM");
    }, 45000);
    let chiuso = false;
    const chiudi = (codice, errore) => {
      if (chiuso) return;
      chiuso = true;
      clearTimeout(timer);
      comandoInCorso = null;
      const testo = uscita.trim();
      if (errore) {
        resolve({ ok: false, codice: 500, messaggio: errore });
        return;
      }
      resolve({
        ok: codice === 0,
        codice: codice === 0 ? 200 : 500,
        messaggio: testo || (codice === 0 ? "Fatto." : "Il comando non è riuscito."),
      });
    };
    processo.on("error", (errore) => chiudi(1, errore.message));
    processo.on("close", (codice) => chiudi(codice ?? 1));
  });
}

const server = createServer(async (richiesta, risposta) => {
  try {
    const url = new URL(richiesta.url ?? "/", `http://${HOST}:${PORTA}`);
    if (richiesta.method === "GET" && url.pathname === "/") return html(risposta, pagina());
    if (richiesta.method === "GET" && url.pathname === "/api/stato") return json(risposta, 200, await stato());
    if (richiesta.method === "POST" && url.pathname === "/api/avvia") {
      const esito = await esegui("avvia-demo.sh");
      return json(risposta, esito.codice, { ...esito, stato: await stato() });
    }
    if (richiesta.method === "POST" && url.pathname === "/api/spegni") {
      const esito = await esegui("spegni-demo.sh");
      return json(risposta, esito.codice, { ...esito, stato: await stato() });
    }
    json(risposta, 404, { errore: "Percorso non trovato." });
  } catch (errore) {
    console.error(errore);
    json(risposta, 500, { errore: "Errore del pannello." });
  }
});

server.listen(PORTA, HOST, () => {
  console.log(`Pannello demo su http://${HOST}:${PORTA}/`);
});

function json(risposta, codice, corpo) {
  const dati = Buffer.from(JSON.stringify(corpo));
  risposta.writeHead(codice, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": dati.length,
    "Cache-Control": "no-store",
  });
  risposta.end(dati);
}

function html(risposta, corpo) {
  const dati = Buffer.from(corpo);
  risposta.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": dati.length,
    "Cache-Control": "no-store",
  });
  risposta.end(dati);
}

function pagina() {
  const righe = SERVIZI.map((servizio) => `
    <li>
      <span>${servizio.nome}</span>
      <span class="porta">porta ${servizio.porta}</span>
      <strong data-servizio="${servizio.id}">…</strong>
    </li>`).join("");
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pannello demo</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", sans-serif; background: #f4f1ea; color: #1c2430; }
    header { background: #24343a; color: white; padding: 28px 32px; }
    header p { margin: 8px 0 0; max-width: 46rem; }
    main { padding: 28px 32px 64px; display: grid; gap: 24px; max-width: 52rem; }
    section { background: white; border-radius: 16px; padding: 20px 22px; }
    h2 { margin: 0 0 14px; font-size: 1.2rem; }
    .azioni { display: flex; flex-wrap: wrap; gap: 12px; }
    button { font: inherit; border: 0; border-radius: 10px; padding: 12px 18px; cursor: pointer; }
    button:disabled { opacity: 0.55; cursor: wait; }
    #avvia { background: #0f6b4c; color: white; }
    #spegni { background: #8a3b2b; color: white; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    li { display: grid; grid-template-columns: 1fr auto auto; gap: 16px; align-items: center; padding: 12px 0; border-top: 1px solid #e6e0d6; }
    .porta { color: #5c6770; }
    strong[data-stato="accesa"] { color: #0f6b4c; }
    strong[data-stato="spenta"] { color: #8a3b2b; }
    #esito { white-space: pre-wrap; min-height: 1.4em; margin: 16px 0 0; color: #24343a; }
    .nota { color: #5c6770; margin: 14px 0 0; }
    pre { white-space: pre-wrap; background: #f4f1ea; border-radius: 10px; padding: 12px 14px; margin: 8px 0 0; }
  </style>
</head>
<body>
  <header>
    <h1>Pannello demo</h1>
    <p>Avvia e spegne lo stesso elenco: Hub portali, CRM Demo, Assistenza Tecnica, collegamento tablet, sincronizzatore e macchina. Questo pannello è già in esecuzione e non viene riavviato. Spegni lo chiude per ultimo.</p>
  </header>
  <main>
    <section>
      <h2>Comandi</h2>
      <div class="azioni">
        <button id="avvia" type="button">Avvia le demo</button>
        <button id="spegni" type="button">Spegni le demo</button>
      </div>
      <p id="esito"></p>
    </section>
    <section>
      <h2>Stato</h2>
      <ul>${righe}</ul>
      <p class="nota" id="quando">Lettura dello stato in corso.</p>
      <p class="nota">Avvia le demo accende 3010, 3013, 3014, 3021, 3022 e 3023. Il pannello sulla porta 3020 non viene riavviato. Spegni le demo chiude le stesse porte e, per ultimo, il listener 3020.</p>
    </section>
    <section>
      <h2>Hub portali e CRM Demo</h2>
      <p>Porte 3010 e 3013. <strong>Avvia le demo</strong> le accende da questa cartella:</p>
      <pre>/Users/macair_andrea/Documents/Sviluppo</pre>
      <pre>node pannello-demo/gestisci.mjs avvia hub
node pannello-demo/gestisci.mjs avvia crm</pre>
      <p>gestisci.mjs non è in questo repository: è sul Mac di Andrea e non è stato ricreato qui. <strong>Spegni le demo</strong> chiude i listener 3010 e 3013.</p>
    </section>
    <section>
      <h2>Assistenza Tecnica Demo</h2>
      <p>Porta 3014. Il codice non è in questo repository. <strong>Avvia le demo</strong> e <strong>Spegni le demo</strong> la includono. La cartella di lavoro è</p>
      <pre>/Users/macair_andrea/Documents/ChatGPT/Progetto CRM/assistenza-demo-clone</pre>
      <p>package.json di quella cartella non è stato letto da questo ambiente. Il comando usato è lo script di avvio del progetto:</p>
      <pre>PORT=3014 npm start</pre>
    </section>
  </main>
  <script>
    const esito = document.querySelector("#esito");
    const quando = document.querySelector("#quando");
    const pulsanti = [...document.querySelectorAll("button")];
    let comando = false;

    function ora(iso) {
      return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }

    function disegna(stato) {
      for (const servizio of stato.servizi) {
        const voce = document.querySelector('[data-servizio="' + servizio.id + '"]');
        const accesa = servizio.accesa === true;
        voce.textContent = accesa ? "accesa" : "spenta";
        voce.dataset.stato = accesa ? "accesa" : "spenta";
      }
      quando.textContent = "Aggiornato alle " + ora(stato.aggiornato) + ".";
    }

    async function aggiorna() {
      try {
        const risposta = await fetch("/api/stato", { headers: { Accept: "application/json" } });
        if (!risposta.ok) return;
        disegna(await risposta.json());
      } catch {
        quando.textContent = "Stato non aggiornato. Nuovo tentativo in corso.";
      }
    }

    async function lancia(url, spegnePannello) {
      if (comando) return;
      comando = true;
      for (const pulsante of pulsanti) pulsante.disabled = true;
      esito.textContent = "Comando in corso…";
      try {
        const risposta = await fetch(url, { method: "POST", headers: { Accept: "application/json" } });
        const corpo = await risposta.json();
        esito.textContent = corpo.messaggio || "Comando terminato.";
        if (corpo.stato) disegna(corpo.stato);
      } catch {
        esito.textContent = spegnePannello
          ? "Demo spente. Il pannello si è chiuso."
          : "Il pannello non ha risposto.";
      } finally {
        comando = false;
        for (const pulsante of pulsanti) pulsante.disabled = false;
        aggiorna();
      }
    }

    document.querySelector("#avvia").addEventListener("click", () => lancia("/api/avvia", false));
    document.querySelector("#spegni").addEventListener("click", () => lancia("/api/spegni", true));
    aggiorna();
    setInterval(aggiorna, 2000);
  </script>
</body>
</html>`;
}

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORTA = Number(process.env.PORTA_MACCHINA || 3022);
const HOST = "127.0.0.1";
const RADICE = dirname(fileURLToPath(import.meta.url));
const PERCORSO_MACCHINA = process.env.MACCHINA || join(RADICE, "macchine", "lavatrice-lavanderia.json");

const macchina = JSON.parse(await readFile(PERCORSO_MACCHINA, "utf8"));
const sincronia = process.env.SINCRO_URL || macchina.sincronia;
const parametri = new Map(macchina.parametri.map((parametro) => [parametro.id, { ...parametro, valore: parametro.iniziale, forzato: false }]));
const invii = [];

setInterval(avanza, macchina.intervalloMs || 2000);

const server = createServer(async (richiesta, risposta) => {
  try {
    const url = new URL(richiesta.url ?? "/", `http://${HOST}:${PORTA}`);
    if (richiesta.method === "GET" && url.pathname === "/") return html(risposta, pagina());
    if (richiesta.method === "GET" && url.pathname === "/api/stato") return json(risposta, 200, stato());
    if (richiesta.method === "POST" && url.pathname === "/api/piano") return json(risposta, 200, await inviaPiano());
    if (richiesta.method === "POST" && url.pathname === "/api/normale") {
      ripristina();
      return json(risposta, 200, { messaggio: "Funzionamento normale ripristinato.", stato: stato() });
    }
    const scenario = url.pathname.match(/^\/api\/scenari\/([^/]+)$/);
    if (richiesta.method === "POST" && scenario) {
      const esito = await lanciaScenario(decodeURIComponent(scenario[1]));
      if (!esito) return json(risposta, 404, { errore: "Scenario sconosciuto." });
      return json(risposta, esito.ok ? 200 : 502, esito);
    }
    json(risposta, 404, { errore: "Percorso non trovato." });
  } catch (errore) {
    console.error(errore);
    json(risposta, 500, { errore: "Errore della macchina simulata." });
  }
});

server.listen(PORTA, HOST, () => {
  console.log(`Macchina simulata su http://${HOST}:${PORTA}/`);
  console.log(`Tipo: ${macchina.tipoEtichetta}. Sincronia: ${sincronia}`);
});

function avanza() {
  for (const parametro of parametri.values()) {
    if (parametro.forzato) continue;
    const scarto = (Math.random() - 0.5) * 2 * parametro.rumore;
    const valore = parametro.valore + scarto;
    parametro.valore = Math.round(Math.min(parametro.massimo, Math.max(parametro.minimo, valore)) * 10) / 10;
  }
}

function ripristina() {
  for (const parametro of parametri.values()) {
    parametro.forzato = false;
    parametro.valore = parametro.iniziale;
  }
}

function stato() {
  return {
    macchina: macchina.nome,
    tipo: macchina.tipo,
    tipoEtichetta: macchina.tipoEtichetta,
    aggiornato: new Date().toISOString(),
    sincronia,
    parametri: [...parametri.values()].map((parametro) => ({
      id: parametro.id,
      famiglia: parametro.famiglia,
      nome: parametro.nome,
      unita: parametro.unita,
      valore: parametro.valore,
      atteso: parametro.attesoTesto,
      forzato: parametro.forzato,
    })),
    invii: invii.slice(0, 8),
  };
}

async function lanciaScenario(id) {
  const scenario = (macchina.scenari ?? []).find((voce) => voce.id === id);
  if (!scenario) return null;
  for (const voce of scenario.parametri ?? []) {
    const parametro = parametri.get(voce.id);
    if (!parametro) continue;
    parametro.valore = voce.valore;
    parametro.forzato = true;
  }
  const principale = parametri.get(scenario.parametro);
  return inviaTicket(ticketDaScenario(scenario, principale));
}

async function inviaPiano() {
  const scaduti = (macchina.piano ?? []).filter((voce) => voce.scaduto);
  const esiti = [];
  for (const voce of scaduti) esiti.push(await inviaTicket(ticketProgrammato(voce)));
  const ok = esiti.every((esito) => esito.ok);
  return { ok, messaggio: ok ? "Ticket programmati inviati alla sincronia." : "La sincronia non ha accettato un ticket programmato.", esiti };
}

function ticketDaScenario(scenario, parametro) {
  const ora = new Date().toISOString();
  return {
    id: `tck-mac-${scenario.id}-${randomUUID().slice(0, 8)}`,
    titolo: scenario.titolo,
    descrizione: scenario.descrizione,
    stato: "aperto",
    priorita: scenario.priorita || "media",
    aggiornato: ora,
    risposte: [],
    macchina: macchina.nome,
    tipoMacchina: macchina.tipo,
    tipologia: scenario.tipologia,
    origine: scenario.origine,
    parametro: scenario.parametro,
    valoreRilevato: parametro?.valore ?? null,
    valoreAtteso: parametro?.attesoTesto ?? "",
    rilevato: ora,
    riferimentoPiano: scenario.riferimentoPiano ?? null,
    anomaliaRispettoAlPiano: scenario.anomaliaRispettoAlPiano === true,
  };
}

function ticketProgrammato(voce) {
  const ora = new Date().toISOString();
  const parametro = parametri.get(voce.parametro);
  return {
    id: `tck-mac-piano-${voce.id}-${randomUUID().slice(0, 8)}`,
    titolo: voce.titolo,
    descrizione: voce.descrizione,
    stato: "aperto",
    priorita: "bassa",
    aggiornato: ora,
    risposte: [],
    macchina: macchina.nome,
    tipoMacchina: macchina.tipo,
    tipologia: "programmato",
    origine: "programmato",
    parametro: voce.parametro,
    valoreRilevato: parametro?.valore ?? null,
    valoreAtteso: parametro?.attesoTesto ?? "",
    rilevato: ora,
    riferimentoPiano: voce.id,
    anomaliaRispettoAlPiano: false,
  };
}

async function inviaTicket(ticket) {
  const pacchetto = {
    versione: 1,
    inviato: new Date().toISOString(),
    tecnico: { logon: macchina.logonTecnico },
    interventi: [],
    ticket: [{ ...ticket, clienteId: macchina.clienteId || undefined }],
  };
  try {
    const risposta = await fetch(sincronia, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(pacchetto),
    });
    const corpo = await risposta.json().catch(() => ({}));
    const esito = {
      ok: risposta.ok,
      codice: risposta.status,
      messaggio: corpo.messaggio || corpo.errore || (risposta.ok ? "Ticket inviato alla sincronia." : "La sincronia ha rifiutato il ticket."),
      ticket,
      ricevuti: corpo.ricevuti ?? [],
    };
    invii.unshift({ quando: pacchetto.inviato, ok: esito.ok, titolo: ticket.titolo, origine: ticket.origine, messaggio: esito.messaggio });
    invii.splice(8);
    return esito;
  } catch {
    const esito = { ok: false, codice: 502, messaggio: "Sincronia non raggiungibile. Il ticket non è partito.", ticket, ricevuti: [] };
    invii.unshift({ quando: pacchetto.inviato, ok: false, titolo: ticket.titolo, origine: ticket.origine, messaggio: esito.messaggio });
    invii.splice(8);
    return esito;
  }
}

function json(risposta, codice, corpo) {
  const dati = Buffer.from(JSON.stringify(corpo));
  risposta.writeHead(codice, { "Content-Type": "application/json; charset=utf-8", "Content-Length": dati.length, "Cache-Control": "no-store" });
  risposta.end(dati);
}

function html(risposta, corpo) {
  const dati = Buffer.from(corpo);
  risposta.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": dati.length, "Cache-Control": "no-store" });
  risposta.end(dati);
}

function pagina() {
  const scenari = (macchina.scenari ?? []).map((scenario) => {
    return `<button type="button" data-url="/api/scenari/${encodeURIComponent(scenario.id)}">${escape(scenario.nome)} <span class="nuovo">Nuovo</span></button>`;
  }).join("");
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Macchina simulata</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", sans-serif; background: #f4f1ea; color: #1c2430; }
    header { background: #3f3a33; color: white; padding: 28px 32px; }
    header p { margin: 8px 0 0; max-width: 46rem; }
    main { padding: 28px 32px 64px; display: grid; gap: 24px; }
    section { background: white; border-radius: 16px; padding: 20px 22px; }
    h2 { margin: 0 0 12px; font-size: 1.2rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 6px; border-top: 1px solid #e6e0d6; }
    .meta { color: #5c6770; }
    .azioni { display: flex; flex-wrap: wrap; gap: 12px; }
    button { font: inherit; background: #3f3a33; color: white; border: 0; border-radius: 10px; padding: 10px 16px; cursor: pointer; }
    .nuovo { display: inline-block; margin-left: 8px; background: #b45309; color: white; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; vertical-align: middle; }
    #esito { white-space: pre-wrap; }
  </style>
</head>
<body>
  <header>
    <h1>Macchina simulata <span class="nuovo">Nuovo</span></h1>
    <p id="intestazione">Caricamento del tipo di macchina.</p>
  </header>
  <main>
    <section>
      <h2>Parametri <span class="nuovo">Nuovo</span></h2>
      <p class="meta">Funzionamento e consumi, aggiornati in continuo. Il tipo di macchina arriva dal file di configurazione.</p>
      <table>
        <thead><tr><th>Famiglia</th><th>Parametro</th><th>Valore</th><th>Atteso</th></tr></thead>
        <tbody id="parametri"></tbody>
      </table>
    </section>
    <section>
      <h2>Scenari <span class="nuovo">Nuovo</span></h2>
      <p class="meta">Ogni comando genera il ticket e lo invia al punto di ingresso della sincronia.</p>
      <div class="azioni">
        ${scenari}
        <button type="button" data-url="/api/piano">Ticket programmato <span class="nuovo">Nuovo</span></button>
        <button type="button" data-url="/api/normale">Riprendi il normale</button>
      </div>
    </section>
    <section>
      <h2>Ultimo invio alla sincronia <span class="nuovo">Nuovo</span></h2>
      <p id="esito" class="meta">Nessun invio ancora.</p>
    </section>
  </main>
  <script>
    const corpo = document.querySelector("#parametri");
    const esito = document.querySelector("#esito");
    const intestazione = document.querySelector("#intestazione");
    async function aggiorna() {
      const stato = await (await fetch("/api/stato")).json();
      intestazione.textContent = stato.tipoEtichetta + " · " + stato.macchina + ". I ticket vanno a " + stato.sincronia + ".";
      corpo.replaceChildren();
      for (const parametro of stato.parametri) {
        const riga = document.createElement("tr");
        for (const testo of [parametro.famiglia, parametro.nome, parametro.valore + " " + parametro.unita, parametro.atteso]) {
          const cella = document.createElement("td");
          cella.textContent = String(testo);
          riga.append(cella);
        }
        corpo.append(riga);
      }
    }
    document.querySelectorAll("button[data-url]").forEach((pulsante) => {
      pulsante.addEventListener("click", async () => {
        const risposta = await fetch(pulsante.dataset.url, { method: "POST" });
        const dati = await risposta.json();
        esito.textContent = dati.messaggio || dati.errore || "Richiesta inviata.";
        aggiorna();
      });
    });
    aggiorna();
    setInterval(aggiorna, 2000);
  </script>
</body>
</html>`;
}

function escape(valore) {
  return String(valore ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

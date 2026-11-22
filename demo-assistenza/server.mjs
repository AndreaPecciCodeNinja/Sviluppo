import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORTA = 3012;
const HOST = "127.0.0.1";
const RADICE = dirname(fileURLToPath(import.meta.url));
const PERCORSO_SEED = join(RADICE, "seed.json");
const CARTELLA_DATI = join(RADICE, "dati");
const PERCORSO_ARCHIVIO = join(CARTELLA_DATI, "archivio.json");

const STATI_INTERVENTO = new Set(["programmato", "in_corso", "in_attesa", "completato", "annullato"]);
const STATI_TICKET = new Set(["aperto", "in_lavorazione", "in_attesa_cliente", "risolto", "chiuso"]);

const ETICHETTE_TICKET = {
  aperto: "Aperto",
  in_lavorazione: "In lavorazione",
  in_attesa_cliente: "In attesa del cliente",
  risolto: "Risolto",
  chiuso: "Chiuso",
};

const server = createServer(async (richiesta, risposta) => {
  try {
    const url = new URL(richiesta.url ?? "/", `http://${HOST}:${PORTA}`);
    if (richiesta.method === "GET" && url.pathname === "/") {
      const archivio = await carica();
      return html(risposta, 200, pagina(archivio, {
        scheda: url.searchParams.get("scheda"),
        operatore: url.searchParams.get("operatore"),
        creato: url.searchParams.get("creato") === "1",
        eseguito: url.searchParams.get("eseguito") === "1",
      }));
    }

    if (richiesta.method === "POST" && url.pathname === "/ticket/simula") {
      const campi = await leggiCampi(richiesta);
      const archivio = await carica();
      const tecnico = tecnicoDi(archivio, campi.operatore);
      if (!tecnico) return json(risposta, 404, { errore: "Nessun operatore con questo logon." });
      simulaTicket(archivio, tecnico);
      await salva(archivio);
      risposta.writeHead(303, {
        Location: `/?scheda=da-inviare&operatore=${encodeURIComponent(tecnico.logon)}&creato=1`,
        "Cache-Control": "no-store",
      });
      risposta.end();
      return;
    }

    if (richiesta.method === "POST" && url.pathname === "/ticket/eseguito") {
      const campi = await leggiCampi(richiesta);
      const archivio = await carica();
      const tecnico = tecnicoDi(archivio, campi.operatore);
      if (!tecnico) return json(risposta, 404, { errore: "Nessun operatore con questo logon." });
      completaTicket(archivio, tecnico);
      await salva(archivio);
      risposta.writeHead(303, {
        Location: `/?scheda=da-inviare&operatore=${encodeURIComponent(tecnico.logon)}&eseguito=1`,
        "Cache-Control": "no-store",
      });
      risposta.end();
      return;
    }

    const assegnazioni = url.pathname.match(/^\/api\/tecnici\/([^/]+)\/assegnazioni$/);
    if (richiesta.method === "GET" && assegnazioni) {
      const logon = normalizza(decodeURIComponent(assegnazioni[1]));
      const archivio = await carica();
      const tecnico = tecnicoDi(archivio, logon);
      if (!tecnico) return json(risposta, 404, { errore: "Nessun tecnico con questo logon." });
      const pacchetto = pacchettoAssegnazioni(archivio, tecnico.logon);
      if (segnaInviati(archivio, tecnico.logon)) await salva(archivio);
      return json(risposta, 200, pacchetto);
    }

    const eseguiti = url.pathname.match(/^\/api\/tecnici\/([^/]+)\/ticket-eseguiti$/);
    if (richiesta.method === "GET" && eseguiti) {
      const logon = normalizza(decodeURIComponent(eseguiti[1]));
      const archivio = await carica();
      const tecnico = tecnicoDi(archivio, logon);
      if (!tecnico) return json(risposta, 404, { errore: "Nessun tecnico con questo logon." });
      return json(risposta, 200, pacchettoTicketEseguiti(archivio, tecnico.logon));
    }

    if (richiesta.method === "POST" && url.pathname === "/api/sincronizzazione") {
      const corpo = await leggiCorpo(richiesta);
      let pacchetto;
      try {
        pacchetto = JSON.parse(corpo || "{}");
      } catch {
        return json(risposta, 400, { errore: "Il corpo non è un JSON valido." });
      }
      const archivio = await carica();
      const esito = applicaSincronizzazione(archivio, pacchetto);
      if (esito.errore) return json(risposta, esito.codice, { errore: esito.errore });
      await salva(archivio);
      return json(risposta, 200, {
        messaggio: "Aggiornamenti registrati.",
        interventi: esito.interventi,
        ticket: esito.ticket,
      });
    }

    json(risposta, 404, { errore: "Percorso non trovato." });
  } catch (errore) {
    json(risposta, 500, { errore: "Errore del server demo." });
    console.error(errore);
  }
});

server.listen(PORTA, HOST, () => {
  console.log(`Assistenza Tecnica Demo su http://${HOST}:${PORTA}/`);
});

async function carica() {
  try {
    return JSON.parse(await readFile(PERCORSO_ARCHIVIO, "utf8"));
  } catch (errore) {
    if (errore.code !== "ENOENT") throw errore;
    const seed = JSON.parse(await readFile(PERCORSO_SEED, "utf8"));
    await salva(seed);
    return seed;
  }
}

async function salva(archivio) {
  await mkdir(CARTELLA_DATI, { recursive: true });
  const temporaneo = `${PERCORSO_ARCHIVIO}.${process.pid}.tmp`;
  await writeFile(temporaneo, `${JSON.stringify(archivio, null, 2)}\n`, "utf8");
  await rename(temporaneo, PERCORSO_ARCHIVIO);
}

function normalizza(logon) {
  return String(logon ?? "").trim().toLowerCase();
}

function tecnicoDi(archivio, logonOId) {
  const chiave = normalizza(logonOId);
  return (archivio.tecnici ?? []).find((tecnico) => tecnico.logon === chiave || tecnico.id === logonOId);
}

function pacchettoAssegnazioni(archivio, logon) {
  const tecnico = (archivio.tecnici ?? []).find((voce) => voce.logon === logon);
  const interventi = (archivio.interventi ?? []).filter((voce) => voce.logonTecnico === logon);
  const ticket = (archivio.ticket ?? []).filter((voce) => voce.logonTecnico === logon).map(ticketPerApp);
  const clientiId = new Set([
    ...(archivio.clienti ?? []).filter((voce) => voce.logonTecnico === logon).map((voce) => voce.id),
    ...interventi.map((voce) => voce.clienteId),
    ...ticket.map((voce) => voce.clienteId),
  ]);
  return {
    tecnici: tecnico
      ? [{ id: tecnico.id, logon: tecnico.logon, nome: tecnico.nome, password: tecnico.password }]
      : [],
    clienti: (archivio.clienti ?? []).filter((voce) => clientiId.has(voce.id)),
    interventi,
    ticket,
  };
}

function applicaSincronizzazione(archivio, pacchetto) {
  const riferimento = pacchetto?.tecnico ?? {};
  const tecnico = tecnicoDi(archivio, riferimento.logon || riferimento.id);
  if (!tecnico) return { codice: 404, errore: "Tecnico sconosciuto." };
  if (!Array.isArray(pacchetto.interventi) || !Array.isArray(pacchetto.ticket)) {
    return { codice: 400, errore: "Servono gli elenchi interventi e ticket." };
  }

  let interventiApplicati = 0;
  let ticketApplicati = 0;
  for (const aggiornamento of pacchetto.interventi) {
    const record = (archivio.interventi ?? []).find((voce) => voce.id === aggiornamento.id && voce.logonTecnico === tecnico.logon);
    if (!record) continue;
    if (STATI_INTERVENTO.has(aggiornamento.stato)) record.stato = aggiornamento.stato;
    if (aggiornamento.aggiornato) record.aggiornato = String(aggiornamento.aggiornato);
    record.note = unisciAnnotazioni(record.note, aggiornamento.note);
    interventiApplicati += 1;
  }
  archivio.ticket = Array.isArray(archivio.ticket) ? archivio.ticket : [];
  for (const aggiornamento of pacchetto.ticket) {
    const id = String(aggiornamento?.id ?? "").trim();
    if (!id) continue;
    let record = archivio.ticket.find((voce) => voce.id === id && voce.logonTecnico === tecnico.logon);
    if (!record) {
      record = ticketArrivato(archivio, tecnico, aggiornamento, id);
      archivio.ticket.unshift(record);
    } else {
      const partitoDalServer = record.daInviare === true || Boolean(record.inviatoIl);
      if (STATI_TICKET.has(aggiornamento.stato)) record.stato = aggiornamento.stato;
      if (aggiornamento.aggiornato) record.aggiornato = String(aggiornamento.aggiornato);
      record.risposte = unisciAnnotazioni(record.risposte, aggiornamento.risposte);
      if (partitoDalServer) {
        record.daInviare = false;
        record.ricevutoIl = String(aggiornamento.aggiornato || pacchetto.inviato || new Date().toISOString());
      }
    }
    ticketApplicati += 1;
  }

  archivio.aggiornamenti = Array.isArray(archivio.aggiornamenti) ? archivio.aggiornamenti : [];
  archivio.aggiornamenti.unshift({
    id: randomUUID(),
    inviato: String(pacchetto.inviato || new Date().toISOString()),
    logon: tecnico.logon,
    nome: tecnico.nome,
    interventi: interventiApplicati,
    ticket: ticketApplicati,
  });
  archivio.aggiornamenti = archivio.aggiornamenti.slice(0, 20);
  return { interventi: interventiApplicati, ticket: ticketApplicati };
}

function unisciAnnotazioni(esistenti, nuove) {
  const risultato = Array.isArray(esistenti) ? esistenti.map((voce) => ({ ...voce })) : [];
  for (const nota of Array.isArray(nuove) ? nuove : []) {
    const testo = String(nota?.testo ?? "").trim();
    if (!testo) continue;
    const id = String(nota.id ?? "").trim() || `nota-${randomUUID()}`;
    const record = {
      id,
      testo,
      autore: String(nota.autore ?? "").trim() || "iPad",
      data: String(nota.data ?? new Date().toISOString()),
    };
    const indice = risultato.findIndex((voce) => voce.id === id);
    if (indice >= 0) risultato[indice] = record;
    else risultato.push(record);
  }
  return risultato.sort((a, b) => String(a.data).localeCompare(String(b.data)));
}

function ticketEseguito(ticket) {
  return ticket.stato === "risolto" || ticket.stato === "chiuso";
}

function pacchettoTicketEseguiti(archivio, logon) {
  const tecnico = (archivio.tecnici ?? []).find((voce) => voce.logon === logon);
  const ticket = (archivio.ticket ?? []).filter((voce) => voce.logonTecnico === logon && ticketEseguito(voce)).map(ticketPerApp);
  const clientiId = new Set(ticket.map((voce) => voce.clienteId));
  return {
    tecnici: tecnico
      ? [{ id: tecnico.id, logon: tecnico.logon, nome: tecnico.nome, password: tecnico.password }]
      : [],
    clienti: (archivio.clienti ?? []).filter((voce) => clientiId.has(voce.id)),
    ticket,
  };
}

function completaTicket(archivio, tecnico) {
  const cliente = clienteDellOperatore(archivio, tecnico.logon);
  const ora = new Date().toISOString();
  const ticket = {
    id: `tck-eseguito-${randomUUID().slice(0, 8)}`,
    titolo: `Ticket eseguito ${dataLeggibile(ora)}`,
    descrizione: `Completato sul server per ${tecnico.nome}. L'iPad lo scarica da Ticket con Scarica eseguiti.`,
    clienteId: cliente.id,
    logonTecnico: tecnico.logon,
    stato: "risolto",
    priorita: "bassa",
    aperto: ora,
    aggiornato: ora,
    risposte: [
      {
        id: `ris-${randomUUID().slice(0, 8)}`,
        testo: "Lavoro chiuso in sede.",
        autore: tecnico.nome,
        data: ora,
      },
    ],
    daInviare: false,
  };
  archivio.ticket = Array.isArray(archivio.ticket) ? archivio.ticket : [];
  archivio.ticket.unshift(ticket);
  return ticket;
}

function simulaTicket(archivio, tecnico) {
  const cliente = clienteDellOperatore(archivio, tecnico.logon);
  const ora = new Date().toISOString();
  const ticket = {
    id: `tck-sim-${randomUUID().slice(0, 8)}`,
    titolo: `Ticket di prova ${dataLeggibile(ora)}`,
    descrizione: `Creato dalla demo per ${tecnico.nome}. Resta da inviare finché l'app non lo scarica.`,
    clienteId: cliente.id,
    logonTecnico: tecnico.logon,
    stato: "aperto",
    priorita: "media",
    aperto: ora,
    aggiornato: ora,
    risposte: [],
    daInviare: true,
  };
  archivio.ticket = Array.isArray(archivio.ticket) ? archivio.ticket : [];
  archivio.ticket.unshift(ticket);
  return ticket;
}

function ticketArrivato(archivio, tecnico, aggiornamento, id) {
  const clienteId = String(aggiornamento.clienteId ?? "").trim();
  const clienteNoto = (archivio.clienti ?? []).some((voce) => voce.id === clienteId);
  const cliente = clienteNoto ? clienteId : clienteDellOperatore(archivio, tecnico.logon).id;
  const ora = String(aggiornamento.aggiornato || new Date().toISOString());
  const titolo = String(aggiornamento.titolo ?? "").trim() || "Ticket dall'app";
  const record = {
    id,
    titolo,
    descrizione: String(aggiornamento.descrizione ?? "").trim() || "Arrivato dall'app mobile.",
    clienteId: cliente,
    logonTecnico: tecnico.logon,
    stato: STATI_TICKET.has(aggiornamento.stato) ? aggiornamento.stato : "aperto",
    priorita: "media",
    aperto: ora,
    aggiornato: ora,
    risposte: [],
    daInviare: false,
    ricevutoIl: ora,
  };
  record.risposte = unisciAnnotazioni([], aggiornamento.risposte);
  return record;
}

function clienteDellOperatore(archivio, logon) {
  const esistente = (archivio.clienti ?? []).find((voce) => voce.logonTecnico === logon);
  if (esistente) return esistente;
  const cliente = {
    id: `cli-${logon.replace(/[^a-z0-9]+/gi, "-")}`,
    nome: "Cliente di prova",
    referente: "",
    telefono: "",
    email: "",
    indirizzo: "",
    logonTecnico: logon,
  };
  archivio.clienti = Array.isArray(archivio.clienti) ? archivio.clienti : [];
  archivio.clienti.push(cliente);
  return cliente;
}

function segnaInviati(archivio, logon) {
  const ora = new Date().toISOString();
  let mutato = false;
  for (const ticket of archivio.ticket ?? []) {
    if (ticket.logonTecnico !== logon || ticket.daInviare !== true) continue;
    ticket.daInviare = false;
    ticket.inviatoIl = ora;
    mutato = true;
  }
  return mutato;
}

function ticketPerApp(ticket) {
  return {
    id: ticket.id,
    titolo: ticket.titolo,
    descrizione: ticket.descrizione ?? "",
    clienteId: ticket.clienteId,
    logonTecnico: ticket.logonTecnico,
    stato: ticket.stato,
    priorita: ticket.priorita,
    aperto: ticket.aperto,
    aggiornato: ticket.aggiornato,
    risposte: ticket.risposte ?? [],
  };
}

function dataLeggibile(iso) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return String(iso ?? "");
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(data);
}

async function leggiCampi(richiesta) {
  const corpo = await leggiCorpo(richiesta);
  const tipo = String(richiesta.headers["content-type"] ?? "");
  if (tipo.includes("application/json")) {
    try {
      const jsonCorpo = JSON.parse(corpo || "{}");
      return { operatore: jsonCorpo.operatore ?? jsonCorpo.logon ?? "" };
    } catch {
      return { operatore: "" };
    }
  }
  const parametri = new URLSearchParams(corpo);
  return { operatore: parametri.get("operatore") ?? parametri.get("logon") ?? "" };
}

function leggiCorpo(richiesta) {
  return new Promise((resolve, reject) => {
    const pezzi = [];
    let dimensione = 0;
    richiesta.on("data", (pezzo) => {
      dimensione += pezzo.length;
      if (dimensione > 1_000_000) {
        reject(new Error("corpo troppo grande"));
        richiesta.destroy();
        return;
      }
      pezzi.push(pezzo);
    });
    richiesta.on("end", () => resolve(Buffer.concat(pezzi).toString("utf8")));
    richiesta.on("error", reject);
  });
}

function json(risposta, codice, corpo) {
  const dati = Buffer.from(JSON.stringify(corpo));
  risposta.writeHead(codice, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": dati.length,
    "Cache-Control": "no-store",
  });
  risposta.end(dati);
}

function html(risposta, codice, corpo) {
  const dati = Buffer.from(corpo);
  risposta.writeHead(codice, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": dati.length,
    "Cache-Control": "no-store",
  });
  risposta.end(dati);
}

function pagina(archivio, scelta) {
  const tecnici = archivio.tecnici ?? [];
  const operatore = tecnici.find((tecnico) => tecnico.logon === normalizza(scelta.operatore)) ?? tecnici[0];
  const scheda = scelta.scheda === "ricevuti" ? "ricevuti" : "da-inviare";
  const logon = operatore?.logon ?? "";
  const suoi = (archivio.ticket ?? []).filter((ticket) => ticket.logonTecnico === logon);
  const daInviare = suoi.filter((ticket) => ticket.daInviare === true);
  const ricevuti = suoi.filter((ticket) => ticket.ricevutoIl);
  const eseguiti = suoi.filter(ticketEseguito);
  const visibili = scheda === "ricevuti" ? ricevuti : daInviare;
  const opzioni = tecnici.map((tecnico) => {
    const selezionato = tecnico.logon === logon ? " selected" : "";
    return `<option value="${escape(tecnico.logon)}"${selezionato}>${escape(tecnico.nome)}</option>`;
  }).join("");
  const elenco = visibili.map((ticket) => schedaTicket(archivio, ticket, scheda)).join("");
  const vuoto = scheda === "ricevuti"
    ? "Nessun ticket arrivato dall'app di questo operatore."
    : "Nessun ticket da inviare. Usa «Simula un ticket e invialo».";
  const spiegazione = scheda === "ricevuti"
    ? "Solo i ticket che l'app mobile ha rimandato a questo operatore."
    : "Solo i ticket ancora da scaricare sull'app di questo operatore.";
  const aggiornamenti = (archivio.aggiornamenti ?? []).map((voce) => {
    return `<li><strong>${escape(voce.nome || voce.logon)}</strong> · ${escape(dataLeggibile(voce.inviato))} · ${voce.interventi} interventi · ${voce.ticket} ticket</li>`;
  }).join("");
  const avviso = scelta.creato
    ? `<p class="avviso">Ticket di prova creato per ${escape(operatore?.nome ?? "l'operatore")} e messo in Ticket da inviare.</p>`
    : scelta.eseguito
      ? `<p class="avviso">Ticket eseguito creato per ${escape(operatore?.nome ?? "l'operatore")}. Sull'iPad, in Ticket, premi Scarica eseguiti.</p>`
      : "";
  const elencoEseguiti = eseguiti.map((ticket) => schedaTicket(archivio, ticket, "eseguiti")).join("");
  const href = (nome) => `/?scheda=${nome}&operatore=${encodeURIComponent(logon)}`;
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Assistenza Tecnica Demo</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", sans-serif; background: #f4f1ea; color: #1c2430; }
    header { background: #0e4d5d; color: white; padding: 28px 32px; }
    header p { margin: 8px 0 0; max-width: 46rem; }
    main { padding: 28px 32px 64px; display: grid; gap: 24px; }
    section { background: white; border-radius: 16px; padding: 20px 22px; }
    h2 { margin: 0 0 12px; font-size: 1.2rem; }
    article { border-top: 1px solid #e6e0d6; padding: 12px 0; }
    article h3 { margin: 0 0 4px; font-size: 1rem; }
    .meta { color: #5c6770; font-size: 0.92rem; }
    ul { margin: 8px 0 0; padding-left: 1.1rem; }
    a { color: #0e4d5d; }
    .barra { display: flex; flex-wrap: wrap; gap: 16px; align-items: end; }
    label { display: grid; gap: 6px; font-size: 0.92rem; }
    select, button { font: inherit; }
    select { padding: 8px 10px; border-radius: 8px; border: 1px solid #d5cec3; background: white; min-width: 16rem; }
    button { background: #0e4d5d; color: white; border: 0; border-radius: 10px; padding: 10px 16px; cursor: pointer; }
    button.comando { display: inline-flex; align-items: center; gap: 8px; font-size: 1.05rem; }
    button.secondario { background: white; color: #0e4d5d; border: 1px solid #0e4d5d; }
    form.azioni { margin: 0 0 18px; }
    nav.schede { display: flex; gap: 8px; margin: 4px 0 12px; }
    nav.schede a { text-decoration: none; padding: 10px 16px; border-radius: 999px; background: #efeae2; color: #1c2430; }
    nav.schede a.attiva { background: #0e4d5d; color: white; }
    .avviso { background: #e5f4f1; border-radius: 12px; padding: 12px 14px; }
  </style>
</head>
<body>
  <header>
    <h1>Assistenza Tecnica Demo</h1>
    <p>Scegli l'operatore. Ticket da inviare sono quelli ancora da mandare all'app. Ticket ricevuti sono quelli arrivati dall'app.</p>
  </header>
  <main>
    <section>
      <form class="azioni" method="post" action="/ticket/simula">
        <input type="hidden" name="operatore" value="${escape(logon)}">
        <button class="comando" type="submit">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z"/><path d="M8 8v8"/></svg>
          Simula un ticket e invialo
        </button>
      </form>
      <form class="barra" method="get" action="/">
        <label>Operatore
          <select name="operatore">${opzioni}</select>
        </label>
        <input type="hidden" name="scheda" value="${scheda}">
        <button type="submit">Mostra</button>
      </form>
      <form method="post" action="/ticket/eseguito">
        <input type="hidden" name="operatore" value="${escape(logon)}">
        <button class="secondario" type="submit">Completa un ticket di prova</button>
      </form>
      ${avviso}
      <nav class="schede">
        <a class="${scheda === "da-inviare" ? "attiva" : ""}" href="${href("da-inviare")}">Ticket da inviare (${daInviare.length})</a>
        <a class="${scheda === "ricevuti" ? "attiva" : ""}" href="${href("ricevuti")}">Ticket ricevuti (${ricevuti.length})</a>
      </nav>
      <h2>${scheda === "ricevuti" ? "Ticket ricevuti" : "Ticket da inviare"} · ${escape(operatore?.nome ?? "")}</h2>
      <p class="meta">${spiegazione}</p>
      ${elenco || `<p class="meta">${vuoto}</p>`}
      <h2>Ticket eseguiti · ${escape(operatore?.nome ?? "")}</h2>
      <p class="meta">Completati sul server per questo operatore. L'iPad li scarica da Ticket, con Scarica eseguiti.</p>
      ${elencoEseguiti || "<p class=\"meta\">Nessun ticket eseguito. Usa «Completa un ticket di prova».</p>"}
    </section>
    <section>
      <h2>Aggiornamenti arrivati dall'iPad</h2>
      ${aggiornamenti ? `<ul>${aggiornamenti}</ul>` : "<p class=\"meta\">Nessun invio ancora.</p>"}
    </section>
  </main>
</body>
</html>`;
}

function schedaTicket(archivio, ticket, scheda) {
  const risposte = (ticket.risposte ?? []).map((risposta) => {
    return `<li>${escape(risposta.testo)} <span class="meta">— ${escape(risposta.autore)}, ${escape(dataLeggibile(risposta.data))}</span></li>`;
  }).join("");
  const quando = scheda === "ricevuti"
    ? `Arrivato dall'app il ${dataLeggibile(ticket.ricevutoIl)}`
    : scheda === "eseguiti"
      ? "Completato sul server"
      : "Ancora da mandare all'app";
  return `<article>
    <h3>${escape(ticket.titolo)}</h3>
    <p class="meta">${escape(ETICHETTE_TICKET[ticket.stato] || ticket.stato)} · ${escape(nomeCliente(archivio, ticket.clienteId))} · ${escape(quando)}</p>
    ${ticket.descrizione ? `<p>${escape(ticket.descrizione)}</p>` : ""}
    ${risposte ? `<ul>${risposte}</ul>` : ""}
  </article>`;
}

function nomeCliente(archivio, id) {
  return (archivio.clienti ?? []).find((voce) => voce.id === id)?.nome || id || "";
}

function escape(valore) {
  return String(valore ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

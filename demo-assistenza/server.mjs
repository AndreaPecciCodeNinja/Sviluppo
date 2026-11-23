import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORTA = 3012;
const HOST = "127.0.0.1";
const URL_SINCRO = process.env.SINCRO_INGRESSO || "http://127.0.0.1:3013/api/ingresso";
const URL_SARA = process.env.SARA_URL || "http://127.0.0.1:3013/api/sara/dialogo";
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

    const ingressoMacchina = url.pathname.match(/^\/api\/tecnici\/([^/]+)\/ingresso-macchina$/);
    if (richiesta.method === "GET" && ingressoMacchina) {
      const logon = normalizza(decodeURIComponent(ingressoMacchina[1]));
      const archivio = await carica();
      const tecnico = tecnicoDi(archivio, logon);
      if (!tecnico) return json(risposta, 404, { errore: "Nessun tecnico con questo logon." });
      const ticket = (archivio.ticket ?? [])
        .filter((voce) => voce.logonTecnico === tecnico.logon && voce.origine)
        .map(ticketPerApp);
      return json(risposta, 200, { ticket });
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
        ricevuti: esito.ricevuti,
      });
    }

    if (await gestisciSara(richiesta, risposta, url)) return;
    if (await gestisciManutenzione(richiesta, risposta, url)) return;

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
    const archivio = JSON.parse(await readFile(PERCORSO_ARCHIVIO, "utf8"));
    assicurati(archivio);
    return archivio;
  } catch (errore) {
    if (errore.code !== "ENOENT") throw errore;
    const seed = JSON.parse(await readFile(PERCORSO_SEED, "utf8"));
    assicurati(seed);
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
  const ricevuti = [];
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
    applicaCampiMacchina(record, aggiornamento);
    if (aggiornamento.segnalazioneIpad === true && !record.inviatoIl) {
      record.daInviare = true;
      record.segnalazioneImmediata = true;
    }
    centralizzaTicketMacchina(archivio, record);
    ricevuti.push(ticketPerApp(record));
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
  return { interventi: interventiApplicati, ticket: ticketApplicati, ricevuti };
}

const CAMPI_MACCHINA = [
  "macchina",
  "tipoMacchina",
  "tipologia",
  "origine",
  "parametro",
  "valoreRilevato",
  "valoreAtteso",
  "rilevato",
  "riferimentoPiano",
  "anomaliaRispettoAlPiano",
];

function applicaCampiMacchina(record, aggiornamento) {
  if (aggiornamento?.origine == null && aggiornamento?.tipologia == null) return;
  for (const campo of CAMPI_MACCHINA) {
    if (aggiornamento[campo] !== undefined) record[campo] = aggiornamento[campo];
  }
  if (aggiornamento.priorita) record.priorita = String(aggiornamento.priorita);
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
  const pubblico = {
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
  for (const campo of CAMPI_MACCHINA) {
    if (ticket[campo] !== undefined) pubblico[campo] = ticket[campo];
  }
  return pubblico;
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

function assicurati(archivio) {
  if (archivio.modalitaSincronia !== "manuale") archivio.modalitaSincronia = "automatica";
  if (!Array.isArray(archivio.tipologieCritiche) || archivio.tipologieCritiche.length === 0) {
    archivio.tipologieCritiche = ["blocco di produzione", "rischio di blocco di produzione"];
  }
  if (!Array.isArray(archivio.tipologiePending) || archivio.tipologiePending.length === 0) {
    archivio.tipologiePending = [
      { id: "pend-tecnico", nome: "Problema tecnico" },
      { id: "pend-assenza", nome: "Assenza dell'operatore" },
      { id: "pend-ricambio", nome: "Attesa ricambio" },
      { id: "pend-impianto", nome: "Indisponibilità dell'impianto" },
    ];
  }
  archivio.pending = Array.isArray(archivio.pending) ? archivio.pending : [];
  if (!Array.isArray(archivio.manuali) || archivio.manuali.length === 0) {
    archivio.manuali = [{
      id: "man-lavatrice",
      tipoMacchina: "lavatrice-lavanderia",
      titolo: "Manuale lavatrice industriale",
      testo: "Avvio, dosaggio del sapone, controllo del cestello, arresto di sicurezza.",
    }];
  }
  if (!Array.isArray(archivio.workflow) || archivio.workflow.length === 0) {
    archivio.workflow = [{
      tipoMacchina: "lavatrice-lavanderia",
      passi: [
        "Mettere in sicurezza la macchina",
        "Verificare il parametro segnalato",
        "Eseguire l'intervento previsto dal piano",
        "Registrare l'esito e i consumi",
      ],
    }];
  }
  for (const chiave of ["inviiSincronia", "atteseConferma", "codaAssegnazioni", "dialogoAda", "riassegnazioni", "ingressoSincronia"]) {
    if (!Array.isArray(archivio[chiave])) archivio[chiave] = [];
  }
  for (const ticket of archivio.ticket ?? []) centralizzaTicketMacchina(archivio, ticket);
}

function ticketMacchina(ticket) {
  return ["programmato", "consumo", "anomalia", "critico"].includes(ticket?.origine);
}

function eCritica(archivio, ticket) {
  const tipologia = String(ticket?.tipologia ?? "").trim().toLowerCase();
  return (archivio.tipologieCritiche ?? []).some((voce) => String(voce).trim().toLowerCase() === tipologia);
}

function centralizzaTicketMacchina(archivio, ticket) {
  if (!ticketMacchina(ticket)) return;
  ticket.anomaliaRispettoAlPiano = ticket.anomaliaRispettoAlPiano === true;
  ticket.statoGestione = eCritica(archivio, ticket) ? "ticket in gestione urgente" : "ordinario";
}

async function gestisciSara(richiesta, risposta, url) {
  if (richiesta.method === "GET" && url.pathname === "/api/sara/stato") {
    const archivio = await carica();
    return json(risposta, 200, {
      ticket: (archivio.ticket ?? []).map((ticket) => ({
        id: ticket.id,
        titolo: ticket.titolo,
        logonTecnico: ticket.logonTecnico,
        stato: ticket.stato,
        origine: ticket.origine ?? null,
        tipologia: ticket.tipologia ?? null,
        statoGestione: ticket.statoGestione ?? null,
        etichettaSincronia: ticket.etichettaSincronia ?? null,
        anomaliaRispettoAlPiano: ticket.anomaliaRispettoAlPiano === true,
        daInviare: ticket.daInviare === true,
        segnalazioneImmediata: ticket.segnalazioneImmediata === true,
      })),
      interventi: (archivio.interventi ?? []).map((voce) => ({
        id: voce.id,
        titolo: voce.titolo,
        logonTecnico: voce.logonTecnico,
        stato: voce.stato,
        appuntamento: voce.appuntamento ?? null,
      })),
      pending: archivio.pending ?? [],
      tecnici: (archivio.tecnici ?? []).map((tecnico) => ({ logon: tecnico.logon, nome: tecnico.nome })),
    }), true;
  }
  if (richiesta.method !== "POST") return false;
  if (url.pathname !== "/api/sara/allinea" && url.pathname !== "/api/sara/pending") return false;
  const campi = await leggiOggetto(richiesta);
  const archivio = await carica();
  if (url.pathname === "/api/sara/pending") {
    registraPendingSara(archivio, campi);
    await salva(archivio);
    return json(risposta, 200, { pending: pendingPubblico(archivio, archivio.pending.find((voce) => voce.id === campi.id)) }), true;
  }
  for (const id of campi.etichette ?? []) {
    const ticket = (archivio.ticket ?? []).find((voce) => voce.id === id);
    if (ticket) ticket.etichettaSincronia = "sincronizzato correttamente";
  }
  for (const voce of campi.interventi ?? []) {
    const intervento = (archivio.interventi ?? []).find((candidato) => candidato.id === voce.id);
    if (intervento && voce.logonTecnico) {
      intervento.logonTecnico = voce.logonTecnico;
      intervento.aggiornato = new Date().toISOString();
    }
  }
  for (const voce of campi.pending ?? []) registraPendingSara(archivio, voce);
  await salva(archivio);
  return json(risposta, 200, { messaggio: "Stato allineato da Sara." }), true;
}

function registraPendingSara(archivio, campi) {
  archivio.pending = Array.isArray(archivio.pending) ? archivio.pending : [];
  const id = String(campi.id ?? "").trim();
  if (!id) return;
  let voce = archivio.pending.find((pending) => pending.id === id);
  if (!voce) {
    voce = { id, creato: new Date().toISOString(), archiviato: false };
    archivio.pending.unshift(voce);
  }
  voce.tipologiaId = campi.tipologiaId || voce.tipologiaId || "";
  voce.tipologia = campi.tipologia || voce.tipologia || voce.tipologiaId;
  voce.causale = campi.causale || voce.causale || "";
  voce.nota = campi.nota ?? voce.nota ?? "";
  voce.riferimento = campi.riferimento || voce.riferimento || "";
  voce.quando = campi.quando || voce.quando || new Date().toISOString();
  voce.aggiornato = new Date().toISOString();
  if (campi.archiviato === true) voce.archiviato = true;
}

async function gestisciManutenzione(richiesta, risposta, url) {
  const percorso = url.pathname;
  if (richiesta.method === "GET" && percorso === "/api/sincronia/ingresso") {
    const archivio = await carica();
    return json(risposta, 200, { ingresso: archivio.ingressoSincronia, invii: archivio.inviiSincronia, attese: archivio.atteseConferma }), true;
  }
  if (richiesta.method === "GET" && percorso === "/api/macchine/ticket") {
    const archivio = await carica();
    return json(risposta, 200, { ticket: (archivio.ticket ?? []).filter(ticketMacchina).map((ticket) => ticketMacchinaPubblico(archivio, ticket)) }), true;
  }
  if (richiesta.method === "GET" && percorso === "/api/pending") {
    const archivio = await carica();
    return json(risposta, 200, { pending: archivio.pending.map((voce) => pendingPubblico(archivio, voce)), tipologie: archivio.tipologiePending }), true;
  }
  if (richiesta.method === "GET" && percorso === "/api/ada") {
    const archivio = await carica();
    return json(risposta, 200, { coda: archivio.codaAssegnazioni, dialogo: archivio.dialogoAda }), true;
  }
  if (richiesta.method === "POST" && percorso === "/api/sincronia/ingresso") {
    const voce = await leggiOggetto(richiesta);
    const archivio = await carica();
    archivio.ingressoSincronia.unshift({ ...voce, ricevuto: new Date().toISOString() });
    archivio.ingressoSincronia = archivio.ingressoSincronia.slice(0, 40);
    await salva(archivio);
    return json(risposta, 200, { messaggio: "Ticket ricevuto in sincronia.", id: voce.id }), true;
  }
  if (richiesta.method !== "POST") return false;

  const archivio = await carica();
  const campi = await leggiOggetto(richiesta);
  const jsonRichiesto = vuoleJson(richiesta);

  if (percorso === "/api/sincronia/modalita") {
    archivio.modalitaSincronia = campi.modalita === "manuale" ? "manuale" : "automatica";
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { modalita: archivio.modalitaSincronia });
  }
  if (percorso === "/api/sincronia/conferma") {
    const esito = await confermaInvio(archivio, campi.id);
    return rispondi(risposta, jsonRichiesto, esito, esito.ok ? 200 : 404);
  }
  if (percorso === "/api/ticket/nuovo") {
    const titolo = String(campi.titolo ?? "").trim();
    if (!titolo) return json(risposta, 400, { errore: "Manca il titolo." }), true;
    const tecnico = tecnicoDi(archivio, campi.operatore);
    const ticket = {
      id: `tck-app-${randomUUID().slice(0, 8)}`,
      titolo,
      descrizione: String(campi.descrizione ?? "").trim(),
      clienteId: tecnico ? clienteDellOperatore(archivio, tecnico.logon).id : "",
      logonTecnico: "",
      stato: "aperto",
      priorita: "media",
      aperto: new Date().toISOString(),
      aggiornato: new Date().toISOString(),
      risposte: [],
      statoGestione: "ordinario",
    };
    archivio.ticket = Array.isArray(archivio.ticket) ? archivio.ticket : [];
    archivio.ticket.unshift(ticket);
    const esito = await partiVersoSincronia(archivio, "nuovo", ticket);
    return rispondi(risposta, jsonRichiesto, { ticket, ...esito });
  }
  if (percorso === "/api/ticket/assegna") {
    const ticket = (archivio.ticket ?? []).find((voce) => voce.id === campi.id);
    const tecnico = tecnicoDi(archivio, campi.operatore);
    if (!ticket || !tecnico) return json(risposta, 404, { errore: "Ticket o operatore sconosciuto." }), true;
    ticket.logonTecnico = tecnico.logon;
    ticket.aggiornato = new Date().toISOString();
    centralizzaTicketMacchina(archivio, ticket);
    accodaAda(archivio, ticket, tecnico);
    await parlaConSara(archivio, `Assegnazione di ${ticket.id} a ${tecnico.nome}.`);
    const esito = await partiVersoSincronia(archivio, "assegnazione", ticket);
    return rispondi(risposta, jsonRichiesto, { ticket: ticketPerApp(ticket), ...esito });
  }
  if (percorso === "/api/interventi/scambia") {
    const intervento = (archivio.interventi ?? []).find((voce) => voce.id === campi.id);
    const tecnico = tecnicoDi(archivio, campi.operatore);
    if (!intervento || !tecnico) return json(risposta, 404, { errore: "Intervento o operatore sconosciuto." }), true;
    if (!intervento.logonTecnico) return json(risposta, 400, { errore: "L'intervento non è ancora assegnato." }), true;
    const precedente = intervento.logonTecnico;
    if (precedente === tecnico.logon) return json(risposta, 400, { errore: "Il tecnico è già assegnato." }), true;
    intervento.logonTecnico = tecnico.logon;
    intervento.aggiornato = new Date().toISOString();
    archivio.riassegnazioni.unshift({
      id: randomUUID(),
      interventoId: intervento.id,
      da: precedente,
      a: tecnico.logon,
      quando: intervento.aggiornato,
    });
    accodaAda(archivio, { id: intervento.id, titolo: intervento.titolo }, tecnico);
    await parlaConSara(archivio, `Scambio tecnico sull'intervento ${intervento.id}: da ${precedente} a ${tecnico.nome}.`);
    const esito = await partiVersoSincronia(archivio, "assegnazione", {
      id: intervento.id,
      titolo: intervento.titolo,
      logonTecnico: tecnico.logon,
      precedente,
    });
    return rispondi(risposta, jsonRichiesto, { interventoId: intervento.id, da: precedente, a: tecnico.logon, ...esito });
  }
  if (percorso === "/api/ticket/manuale") {
    const ticket = (archivio.ticket ?? []).find((voce) => voce.id === campi.id);
    const manuale = (archivio.manuali ?? []).find((voce) => voce.id === campi.manualeId);
    if (!ticket || !manuale) return json(risposta, 404, { errore: "Ticket o manuale sconosciuto." }), true;
    ticket.manualeId = manuale.id;
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { id: ticket.id, manuale: manuale.titolo });
  }
  if (percorso === "/api/pending/tipologie/elimina") {
    archivio.tipologiePending = archivio.tipologiePending.filter((voce) => voce.id !== campi.id);
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { tipologie: archivio.tipologiePending });
  }
  if (percorso === "/api/pending/tipologie/aggiorna") {
    const tipo = archivio.tipologiePending.find((voce) => voce.id === campi.id);
    if (!tipo) return json(risposta, 404, { errore: "Tipologia sconosciuta." }), true;
    tipo.nome = String(campi.nome ?? "").trim() || tipo.nome;
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { tipologia: tipo });
  }
  if (percorso === "/api/pending/tipologie") {
    const nome = String(campi.nome ?? "").trim();
    if (!nome) return json(risposta, 400, { errore: "Manca il nome." }), true;
    const tipo = { id: `pend-${randomUUID().slice(0, 8)}`, nome };
    archivio.tipologiePending.push(tipo);
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { tipologia: tipo });
  }
  if (percorso === "/api/pending/aggiorna") {
    const voce = archivio.pending.find((pending) => pending.id === campi.id);
    if (!voce || voce.archiviato) return json(risposta, 404, { errore: "Pending non modificabile." }), true;
    if (campi.tipologiaId) {
      voce.tipologiaId = campi.tipologiaId;
      const tipo = archivio.tipologiePending.find((candidato) => candidato.id === campi.tipologiaId);
      if (tipo) voce.tipologia = tipo.nome;
    }
    if (campi.nota != null) voce.nota = String(campi.nota);
    voce.aggiornato = new Date().toISOString();
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { pending: pendingPubblico(archivio, voce) });
  }
  if (percorso === "/api/pending/archivia") {
    const voce = archivio.pending.find((pending) => pending.id === campi.id);
    if (!voce) return json(risposta, 404, { errore: "Pending sconosciuto." }), true;
    voce.archiviato = true;
    voce.archiviatoIl = new Date().toISOString();
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { pending: pendingPubblico(archivio, voce) });
  }
  if (percorso === "/api/pending") {
    const tipo = archivio.tipologiePending.find((voce) => voce.id === campi.tipologiaId);
    if (!tipo) return json(risposta, 400, { errore: "Tipologia di pending sconosciuta." }), true;
    const voce = {
      id: `pending-${randomUUID().slice(0, 8)}`,
      tipologiaId: tipo.id,
      tipologia: tipo.nome,
      nota: String(campi.nota ?? "").trim(),
      riferimento: String(campi.riferimento ?? "").trim(),
      archiviato: false,
      creato: new Date().toISOString(),
      aggiornato: new Date().toISOString(),
    };
    archivio.pending.unshift(voce);
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { pending: pendingPubblico(archivio, voce) });
  }
  if (percorso === "/api/tipologie-critiche") {
    const nome = String(campi.nome ?? "").trim();
    if (!nome) return json(risposta, 400, { errore: "Manca la tipologia." }), true;
    if (!eCritica(archivio, { tipologia: nome })) archivio.tipologieCritiche.push(nome);
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { tipologieCritiche: archivio.tipologieCritiche });
  }
  return false;
}

function accodaAda(archivio, ticket, tecnico) {
  archivio.codaAssegnazioni.unshift({
    id: randomUUID(),
    ticketId: ticket.id,
    titolo: ticket.titolo,
    logon: tecnico.logon,
    nome: tecnico.nome,
    quando: new Date().toISOString(),
    stato: "in_coda",
  });
  archivio.codaAssegnazioni = archivio.codaAssegnazioni.slice(0, 30);
}

async function parlaConSara(archivio, testo) {
  let rispostaSara = "Sara non è ancora in ascolto. La coda resta sull'applicazione.";
  try {
    const risposta = await fetch(URL_SARA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ da: "ada", testo }),
      signal: AbortSignal.timeout(800),
    });
    if (risposta.ok) rispostaSara = "Sara ha ricevuto il messaggio.";
  } catch {
    rispostaSara = "Sara non è ancora in ascolto. La coda resta sull'applicazione.";
  }
  archivio.dialogoAda.unshift({ id: randomUUID(), quando: new Date().toISOString(), testo, risposta: rispostaSara });
  archivio.dialogoAda = archivio.dialogoAda.slice(0, 20);
}

async function partiVersoSincronia(archivio, evento, soggetto) {
  const voce = { id: randomUUID(), evento, quando: new Date().toISOString(), soggetto: { ...soggetto, risposte: undefined } };
  if (archivio.modalitaSincronia === "manuale") {
    archivio.atteseConferma.push(voce);
    await salva(archivio);
    return { ok: true, partito: false, inAttesa: true, id: voce.id };
  }
  await salva(archivio);
  return completaInvio(voce);
}

async function confermaInvio(archivio, id) {
  const indice = archivio.atteseConferma.findIndex((voce) => voce.id === id);
  if (indice < 0) return { ok: false, errore: "Nessun invio in attesa con questo id." };
  const [voce] = archivio.atteseConferma.splice(indice, 1);
  await salva(archivio);
  return completaInvio(voce);
}

async function completaInvio(voce) {
  let partito = false;
  try {
    const risposta = await fetch(URL_SINCRO, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(voce),
    });
    partito = risposta.ok;
  } catch {
    partito = false;
  }
  const archivio = await carica();
  if (partito) {
    archivio.inviiSincronia.unshift({ ...voce, esito: "inviato" });
  } else {
    archivio.atteseConferma.push(voce);
  }
  archivio.inviiSincronia = archivio.inviiSincronia.slice(0, 30);
  await salva(archivio);
  return { ok: partito, partito, inAttesa: !partito, id: voce.id };
}

function pendingPubblico(archivio, voce) {
  const tipo = archivio.tipologiePending.find((candidato) => candidato.id === voce.tipologiaId);
  return { ...voce, tipologia: tipo?.nome ?? voce.tipologia ?? voce.tipologiaId };
}

function ticketMacchinaPubblico(archivio, ticket) {
  const manuale = archivio.manuali.find((voce) => voce.id === ticket.manualeId);
  const flusso = archivio.workflow.find((voce) => voce.tipoMacchina === ticket.tipoMacchina);
  return {
    ...ticketPerApp(ticket),
    statoGestione: ticket.statoGestione,
    etichettaSincronia: ticket.etichettaSincronia ?? null,
    manuale: manuale?.titolo ?? null,
    workflow: flusso?.passi ?? [],
  };
}

async function leggiOggetto(richiesta) {
  const corpo = await leggiCorpo(richiesta);
  const tipo = String(richiesta.headers["content-type"] ?? "");
  if (tipo.includes("application/json")) {
    try {
      return JSON.parse(corpo || "{}");
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(corpo));
}

function vuoleJson(richiesta) {
  const tipo = String(richiesta.headers["content-type"] ?? "");
  const accept = String(richiesta.headers.accept ?? "");
  return tipo.includes("application/json") || accept.includes("application/json");
}

function rispondi(risposta, jsonRichiesto, corpo, codice = 200) {
  if (!jsonRichiesto) {
    risposta.writeHead(303, { Location: "/#predittiva", "Cache-Control": "no-store" });
    risposta.end();
    return true;
  }
  json(risposta, codice, corpo);
  return true;
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
    button.comando.eseguito { background: #1f7a4d; }
    .azioni { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 0 0 18px; }
    nav.schede { display: flex; gap: 8px; margin: 4px 0 12px; }
    nav.schede a { text-decoration: none; padding: 10px 16px; border-radius: 999px; background: #efeae2; color: #1c2430; }
    nav.schede a.attiva { background: #0e4d5d; color: white; }
    .avviso { background: #e5f4f1; border-radius: 12px; padding: 12px 14px; }
    .nuovo { display: inline-block; margin-left: 8px; background: #b45309; color: white; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; vertical-align: middle; }
    .urgente { color: #9a3412; font-weight: 700; }
    .ok { color: #1f7a4d; font-weight: 700; }
    form.riga { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin: 8px 0; }
    input, select.campo { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid #d5cec3; }
  </style>
</head>
<body>
  <header>
    <h1>Assistenza Tecnica Demo</h1>
    <p>Scegli l'operatore. Ticket da inviare sono quelli ancora da mandare all'app. Ticket ricevuti sono quelli arrivati dall'app.</p>
  </header>
  <main>
    <section>
      <div class="azioni">
        <form method="post" action="/ticket/simula">
          <input type="hidden" name="operatore" value="${escape(logon)}">
          <button class="comando" type="submit">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z"/><path d="M8 8v8"/></svg>
            Simula un ticket e invialo
          </button>
        </form>
        <form method="post" action="/ticket/eseguito">
          <input type="hidden" name="operatore" value="${escape(logon)}">
          <button class="comando eseguito" type="submit">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>
            Completa un ticket di prova
          </button>
        </form>
      </div>
      <form class="barra" method="get" action="/">
        <label>Operatore
          <select name="operatore" onchange="document.querySelectorAll('.azioni input[name=operatore]').forEach(function (campo) { campo.value = this.value; }, this)">${opzioni}</select>
        </label>
        <input type="hidden" name="scheda" value="${scheda}">
        <button type="submit">Mostra</button>
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
    ${sezionePredittiva(archivio)}
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

function sezionePredittiva(archivio) {
  const macchine = (archivio.ticket ?? []).filter(ticketMacchina);
  const elenco = macchine.map((ticket) => {
    const manuali = archivio.manuali.filter((manuale) => !ticket.tipoMacchina || manuale.tipoMacchina === ticket.tipoMacchina);
    const opzioni = manuali.map((manuale) => `<option value="${escape(manuale.id)}"${manuale.id === ticket.manualeId ? " selected" : ""}>${escape(manuale.titolo)}</option>`).join("");
    const flusso = archivio.workflow.find((voce) => voce.tipoMacchina === ticket.tipoMacchina);
    const passi = (flusso?.passi ?? []).map((passo, indice) => `<li>${indice + 1}. ${escape(passo)}</li>`).join("");
    const anomalia = ticket.anomaliaRispettoAlPiano ? "Anomalia rispetto al piano" : "Nel piano";
    const urgente = ticket.statoGestione === "ticket in gestione urgente";
    return `<article>
      <h3>${escape(ticket.titolo)} <span class="nuovo">Nuovo</span></h3>
      <p class="meta">${escape(ticket.macchina || "")} · ${escape(ticket.tipoMacchina || "")} · origine ${escape(ticket.origine)} · ${escape(anomalia)}</p>
      <p class="${urgente ? "urgente" : "meta"}">${escape(ticket.statoGestione || "ordinario")}${ticket.etichettaSincronia ? ` · <span class="ok">${escape(ticket.etichettaSincronia)}</span>` : ""}</p>
      <form class="riga" method="post" action="/api/ticket/manuale">
        <input type="hidden" name="id" value="${escape(ticket.id)}">
        <label>Manuale <select class="campo" name="manualeId">${opzioni}</select></label>
        <button type="submit">Allega il manuale</button>
      </form>
      ${passi ? `<p class="meta">Workflow della macchina</p><ol>${passi}</ol>` : ""}
    </article>`;
  }).join("");
  const tecnici = (archivio.tecnici ?? []).map((tecnico) => `<option value="${escape(tecnico.logon)}">${escape(tecnico.nome)}</option>`).join("");
  const interventi = (archivio.interventi ?? []).filter((voce) => voce.logonTecnico).map((voce) => `<option value="${escape(voce.id)}">${escape(voce.titolo)} · ${escape(voce.logonTecnico)}</option>`).join("");
  const tipiPending = archivio.tipologiePending.map((tipo) => `<li>${escape(tipo.nome)} <span class="meta">${escape(tipo.id)}</span></li>`).join("");
  const opzioniTipi = archivio.tipologiePending.map((tipo) => `<option value="${escape(tipo.id)}">${escape(tipo.nome)}</option>`).join("");
  const pending = archivio.pending.map((voce) => {
    const pubblico = pendingPubblico(archivio, voce);
    const causale = pubblico.causale ? ` · causale ${escape(pubblico.causale)}` : "";
    return `<li>${escape(pubblico.tipologia)}${causale} · ${escape(pubblico.nota || "senza nota")} · ${pubblico.archiviato ? "archiviato" : "aperto"} <span class="meta">${escape(pubblico.id)}</span></li>`;
  }).join("");
  const coda = archivio.codaAssegnazioni.slice(0, 6).map((voce) => `<li>${escape(voce.titolo || voce.ticketId)} → ${escape(voce.nome)}</li>`).join("");
  const dialogo = archivio.dialogoAda.slice(0, 4).map((voce) => `<li>${escape(voce.testo)} <span class="meta">${escape(voce.risposta)}</span></li>`).join("");
  const critiche = archivio.tipologieCritiche.map((voce) => `<li>${escape(voce)}</li>`).join("");
  const modalita = archivio.modalitaSincronia;
  return `<section id="predittiva">
    <h2>Manutenzione predittiva <span class="nuovo">Nuovo</span></h2>
    <p class="meta">Ticket della macchina, con origine e segno di anomalia rispetto al piano. Le parti aggiunte portano il contrassegno Nuovo.</p>
    ${elenco || "<p class=\"meta\">Nessun ticket della macchina ancora. Partono dalla lavatrice simulata.</p>"}
    <h3>Invio alla sincronia <span class="nuovo">Nuovo</span></h3>
    <p class="meta">Modalità attuale: ${escape(modalita)}. In automatico un ticket nuovo o assegnato parte subito verso la sincronia. In manuale parte dopo Conferma invio. La label «sincronizzato correttamente» arriva quando Sara conferma il trasferimento.</p>
    ${(archivio.inviiSincronia ?? []).slice(0, 5).map((voce) => `<p class="ok">${escape(voce.evento)} · ${escape(voce.soggetto?.titolo || voce.soggetto?.id || "")} · inviato alla sincronia</p>`).join("")}
    <form class="riga" method="post" action="/api/sincronia/modalita">
      <input type="hidden" name="modalita" value="${modalita === "automatica" ? "manuale" : "automatica"}">
      <button class="secondario" type="submit">Passa a ${modalita === "automatica" ? "manuale" : "automatica"}</button>
    </form>
    <form class="riga" method="post" action="/api/ticket/nuovo">
      <label>Nuovo ticket <input name="titolo" placeholder="Titolo" required></label>
      <button type="submit">Crea e invia</button>
    </form>
    <form class="riga" method="post" action="/api/ticket/assegna">
      <label>Ticket <input name="id" placeholder="id ticket" required></label>
      <label>Operatore <select class="campo" name="operatore">${tecnici}</select></label>
      <button type="submit">Assegna</button>
    </form>
    ${(archivio.atteseConferma ?? []).map((voce) => `<form class="riga" method="post" action="/api/sincronia/conferma"><input type="hidden" name="id" value="${escape(voce.id)}"><button type="submit">Conferma invio ${escape(voce.evento)}</button></form>`).join("")}
    <h3>Scambio del tecnico <span class="nuovo">Nuovo</span></h3>
    <form class="riga" method="post" action="/api/interventi/scambia">
      <label>Intervento già assegnato <select class="campo" name="id">${interventi}</select></label>
      <label>Nuovo tecnico <select class="campo" name="operatore">${tecnici}</select></label>
      <button type="submit">Scambia</button>
    </form>
    <h3>Tipologie di pending <span class="nuovo">Nuovo</span></h3>
    <ul>${tipiPending}</ul>
    <form class="riga" method="post" action="/api/pending/tipologie">
      <input name="nome" placeholder="Nuova tipologia" required>
      <button type="submit">Crea tipologia</button>
    </form>
    <form class="riga" method="post" action="/api/pending/tipologie/aggiorna">
      <select class="campo" name="id">${opzioniTipi}</select>
      <input name="nome" placeholder="Nome aggiornato" required>
      <button type="submit">Modifica tipologia</button>
    </form>
    <form class="riga" method="post" action="/api/pending/tipologie/elimina">
      <select class="campo" name="id">${opzioniTipi}</select>
      <button type="submit">Elimina tipologia</button>
    </form>
    <h3>Pending <span class="nuovo">Nuovo</span></h3>
    ${pending ? `<ul>${pending}</ul>` : "<p class=\"meta\">Nessun pending.</p>"}
    <form class="riga" method="post" action="/api/pending">
      <select class="campo" name="tipologiaId">${opzioniTipi}</select>
      <input name="nota" placeholder="Nota">
      <input name="riferimento" placeholder="Ticket o intervento">
      <button type="submit">Crea pending</button>
    </form>
    <form class="riga" method="post" action="/api/pending/aggiorna">
      <input name="id" placeholder="id pending" required>
      <select class="campo" name="tipologiaId">${opzioniTipi}</select>
      <input name="nota" placeholder="Nota aggiornata">
      <button type="submit">Modifica</button>
    </form>
    <form class="riga" method="post" action="/api/pending/archivia">
      <input name="id" placeholder="id pending" required>
      <button type="submit">Archivia</button>
    </form>
    <h3>Tipologie critiche <span class="nuovo">Nuovo</span></h3>
    <ul>${critiche}</ul>
    <h3>Agente Ada <span class="nuovo">Nuovo</span></h3>
    <p class="meta">Quando un ticket viene assegnato, Ada lo mette in coda verso la sincronia e avvisa Sara.</p>
    ${coda ? `<ul>${coda}</ul>` : "<p class=\"meta\">Coda vuota.</p>"}
    ${dialogo ? `<ul>${dialogo}</ul>` : ""}
  </section>`;
}

function escape(valore) {
  return String(valore ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

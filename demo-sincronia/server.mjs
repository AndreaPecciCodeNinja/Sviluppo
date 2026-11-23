import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORTA = Number(process.env.PORTA_SINCRO || 3022);
const HOST = "127.0.0.1";
const URL_APP = process.env.APP_URL || "http://127.0.0.1:3021";
const RADICE = dirname(fileURLToPath(import.meta.url));
const CARTELLA_DATI = join(RADICE, "dati");
const PERCORSO_ARCHIVIO = join(CARTELLA_DATI, "archivio.json");

const CRITICHE_INIZIALI = ["blocco di produzione", "rischio di blocco di produzione"];
const ESEGUITI = new Set(["completato", "risolto", "chiuso", "annullato"]);

let catena = Promise.resolve();

function inFila(lavoro) {
  const eseguito = catena.then(lavoro, lavoro);
  catena = eseguito.then(() => {}, () => {});
  return eseguito;
}

const server = createServer((richiesta, risposta) => {
  inFila(() => gestisci(richiesta, risposta)).catch((errore) => {
    if (!risposta.headersSent) json(risposta, 500, { errore: "Errore della sincronia." });
    console.error(errore);
  });
});

await assorbiAssegnazioni();
server.listen(PORTA, HOST, () => {
  console.log(`Sincronia su http://${HOST}:${PORTA}/`);
});

async function gestisci(richiesta, risposta) {
  const url = new URL(richiesta.url ?? "/", `http://${HOST}:${PORTA}`);
  const percorso = url.pathname;
  if (richiesta.method === "GET" && percorso === "/") {
    const archivio = await carica();
    return html(risposta, pagina(archivio));
  }
  if (richiesta.method === "GET" && percorso === "/log") {
    const archivio = await carica();
    const remoto = await leggiApplicazione();
    return html(risposta, paginaLog(archivio, remoto, url.searchParams));
  }
  if (richiesta.method === "GET" && percorso === "/api/sara/report") {
    return json(risposta, 200, await verificaSara());
  }
  if (richiesta.method === "POST" && percorso === "/api/sara/verifica") {
    const report = await verificaSara();
    const jsonRichiesto = vuoleJson(richiesta);
    return rispondi(risposta, jsonRichiesto, report);
  }
  const assegnazioni = percorso.match(/^\/api\/tecnici\/([^/]+)\/assegnazioni$/);
  if (richiesta.method === "GET" && assegnazioni) {
    const logon = normalizza(decodeURIComponent(assegnazioni[1]));
    return json(risposta, 200, await assegnazioniTecnico(logon));
  }
  const tablet = percorso.match(/^\/api\/tablet\/([^/]+)$/);
  if (richiesta.method === "GET" && tablet) {
    const archivio = await carica();
    const logon = normalizza(decodeURIComponent(tablet[1]));
    return json(risposta, 200, { logon, ...(archivio.tablet[logon] ?? { interventi: [], ticket: [] }) });
  }
  if (richiesta.method !== "POST") return json(risposta, 404, { errore: "Percorso non trovato." });

  const campi = await leggiOggetto(richiesta);
  const archivio = await carica();
  const jsonRichiesto = vuoleJson(richiesta);

  if (percorso === "/api/sincronizzazione") {
    const esito = await riceviDallaMacchina(archivio, campi);
    return json(risposta, esito.ok ? 200 : 400, esito);
  }
  if (percorso === "/api/ingresso") {
    const esito = await riceviDallApplicazione(archivio, campi);
    return json(risposta, esito.ok ? 200 : 400, esito);
  }
  if (percorso === "/api/sara/dialogo") {
    const testo = String(campi.testo ?? "").trim();
    archivio.dialogo.unshift({
      id: randomUUID(),
      quando: new Date().toISOString(),
      da: campi.da || "ada",
      testo,
      risposta: "Sara ha ricevuto il messaggio. Il suo stato fa fede.",
    });
    archivio.dialogo = archivio.dialogo.slice(0, 20);
    await salva(archivio);
    return json(risposta, 200, { risposta: "Sara ha ricevuto il messaggio. Il suo stato fa fede." });
  }
  if (percorso === "/api/modalita") {
    archivio.modalita = campi.modalita === "manuale" ? "manuale" : "automatica";
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { modalita: archivio.modalita });
  }
  if (percorso === "/api/conferma") {
    const esito = await conferma(archivio, campi.id);
    return rispondi(risposta, jsonRichiesto, esito, esito.ok ? 200 : 404);
  }
  if (percorso === "/api/pending") {
    const esito = await apriPending(archivio, campi);
    return rispondi(risposta, jsonRichiesto, esito, esito.ok ? 200 : 400);
  }
  const chiusura = percorso.match(/^\/api\/tablet\/([^/]+)\/chiusura$/);
  if (chiusura) {
    const esito = await chiudiDalTablet(archivio, normalizza(decodeURIComponent(chiusura[1])), campi);
    return rispondi(risposta, jsonRichiesto, esito, esito.ok ? 200 : 400);
  }
  if (percorso === "/api/tablet/dimentica") {
    togliDalTablet(archivio, normalizza(campi.logon), campi.id);
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { dimenticato: campi.id, logon: normalizza(campi.logon) });
  }
  if (percorso === "/api/tipologie-critiche") {
    const nome = String(campi.nome ?? "").trim();
    if (!nome) return json(risposta, 400, { errore: "Manca la tipologia." });
    if (!eCritica(archivio, nome)) archivio.tipologieCritiche.push(nome);
    await salva(archivio);
    return rispondi(risposta, jsonRichiesto, { tipologieCritiche: archivio.tipologieCritiche });
  }
  return json(risposta, 404, { errore: "Percorso non trovato." });
}

async function riceviDallaMacchina(archivio, pacchetto) {
  const logon = normalizza(pacchetto?.tecnico?.logon || pacchetto?.tecnico?.id);
  if (!logon || !Array.isArray(pacchetto.ticket)) return { ok: false, errore: "Servono il tecnico e i ticket." };
  const preparato = {
    ...pacchetto,
    ticket: pacchetto.ticket.map((ticket) => ({
      ...ticket,
      segnalazioneIpad: eCritica(archivio, ticket.tipologia),
    })),
  };
  for (const ticket of preparato.ticket) {
    archivio.ticket[ticket.id] = {
      id: ticket.id,
      titolo: ticket.titolo,
      logon,
      origine: ticket.origine ?? null,
      tipologia: ticket.tipologia ?? null,
      anomaliaRispettoAlPiano: ticket.anomaliaRispettoAlPiano === true,
      stato: ticket.stato || "aperto",
      segnalazioneIpad: ticket.segnalazioneIpad === true,
      inoltrato: false,
      pacchetto: pacchettoDelTicket(preparato, ticket, logon),
    };
  }
  await salva(archivio);
  const attese = [];
  for (const ticket of preparato.ticket) {
    attese.push(await pianifica(archivio, {
      tipo: "applicazione",
      immediata: false,
      pacchetto: archivio.ticket[ticket.id].pacchetto,
      titolo: ticket.titolo,
    }));
    if (ticket.segnalazioneIpad) {
      attese.push(await pianifica(archivio, {
        tipo: "tablet",
        immediata: true,
        logon,
        voce: { id: ticket.id, titolo: ticket.titolo, stato: ticket.stato || "aperto", segnalazioneImmediata: true, genere: "ticket" },
        titolo: ticket.titolo,
      }));
    }
  }
  const report = archivio.modalita === "automatica" ? await verificaSara() : null;
  return {
    ok: true,
    messaggio: archivio.modalita === "automatica"
      ? "Ticket ricevuto e inoltrato all'applicazione."
      : "Ticket ricevuto. L'inoltro parte dopo la conferma.",
    ricevuti: preparato.ticket.map((ticket) => ({ id: ticket.id, segnalazioneIpad: ticket.segnalazioneIpad })),
    attese,
    report,
  };
}

function sembraIntervento(soggetto) {
  const genere = String(soggetto?.genere || soggetto?.tipo || "").trim().toLowerCase();
  return genere === "intervento" || Boolean(String(soggetto?.appuntamento ?? "").trim()) || Boolean(String(soggetto?.codice ?? "").trim());
}

async function registraInterventoAssegnato(archivio, soggetto, id) {
  const logon = await logonOperatore(soggetto.logonTecnico || soggetto.tecnico || soggetto.operatore);
  if (!logon) return { ok: false, errore: "Manca l'operatore." };
  const appuntamento = normalizzaData(soggetto.appuntamento);
  const stato = normalizzaStatoIntervento(soggetto.stato);
  const titolo = String(soggetto.titolo ?? "").trim() || String(soggetto.codice ?? "").trim() || id;
  archivio.interventi[id] = {
    ...(archivio.interventi[id] ?? {}),
    id,
    codice: String(soggetto.codice ?? "").trim() || id,
    titolo,
    logon,
    stato,
    appuntamento,
    clienteId: String(soggetto.clienteId ?? archivio.interventi[id]?.clienteId ?? "").trim(),
    sospeso: false,
  };
  await salva(archivio);
  await pianifica(archivio, {
    tipo: "tablet",
    immediata: true,
    logon,
    voce: { id, titolo, stato, segnalazioneImmediata: false, genere: "intervento" },
    titolo,
  });
  const inoltro = await inoltraInterventoAllApplicazione(logon, {
    id,
    codice: archivio.interventi[id].codice,
    titolo,
    descrizione: soggetto.descrizione || "",
    clienteId: archivio.interventi[id].clienteId,
    stato,
    appuntamento,
    indirizzo: soggetto.indirizzo || "",
  });
  if (archivio.modalita === "automatica") await verificaSara();
  return {
    ok: true,
    messaggio: inoltro
      ? "Intervento assegnato e inoltrato all'applicazione."
      : "Intervento registrato sulla sincronia. L'applicazione non lo ha ancora accettato.",
    id,
    logon,
    appuntamento,
  };
}

async function logonOperatore(valore) {
  const chiave = normalizza(valore);
  if (!chiave) return "";
  const remoto = await leggiApplicazione();
  const compatto = chiave.replace(/[\s.]+/g, "");
  const tecnico = (remoto?.tecnici ?? []).find((voce) => {
    const logon = normalizza(voce.logon);
    const nome = normalizza(voce.nome).replace(/[\s.]+/g, "");
    return logon === chiave || nome === compatto || logon.replace(/\./g, "") === compatto;
  });
  if (tecnico?.logon) return tecnico.logon;
  return chiave.includes(".") ? chiave : chiave.replace(/\s+/g, ".");
}

async function inoltraInterventoAllApplicazione(logon, intervento) {
  try {
    const risposta = await fetch(`${URL_APP}/api/sincronizzazione`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        versione: 1,
        inviato: new Date().toISOString(),
        tecnico: { logon },
        interventi: [intervento],
        ticket: [],
      }),
      signal: AbortSignal.timeout(1500),
    });
    return risposta.ok;
  } catch {
    return false;
  }
}

async function assegnazioniTecnico(logon) {
  const archivio = await carica();
  const remoto = await leggiApplicazione();
  const canonico = await logonOperatore(logon);
  const perId = new Map();
  for (const intervento of remoto?.interventi ?? []) {
    if (normalizza(intervento.logonTecnico) !== canonico && normalizza(intervento.logonTecnico) !== logon) continue;
    perId.set(intervento.id, {
      id: intervento.id,
      codice: intervento.codice || intervento.id,
      titolo: intervento.titolo,
      clienteId: intervento.clienteId || "",
      logonTecnico: canonico,
      stato: intervento.stato,
      appuntamento: intervento.appuntamento || "",
    });
  }
  for (const intervento of Object.values(archivio.interventi)) {
    if (intervento.logon !== canonico && intervento.logon !== logon) continue;
    const noto = perId.get(intervento.id) ?? {};
    perId.set(intervento.id, {
      id: intervento.id,
      codice: intervento.codice || noto.codice || intervento.id,
      titolo: intervento.titolo || noto.titolo || intervento.id,
      clienteId: intervento.clienteId || noto.clienteId || "",
      logonTecnico: canonico,
      stato: intervento.stato || noto.stato || "programmato",
      appuntamento: intervento.appuntamento || noto.appuntamento || "",
    });
  }
  return {
    tecnici: (remoto?.tecnici ?? []).filter((tecnico) => tecnico.logon === canonico),
    clienti: (remoto?.clienti ?? []).filter((cliente) => [...perId.values()].some((voce) => voce.clienteId === cliente.id)),
    interventi: [...perId.values()],
    ticket: (remoto?.ticket ?? []).filter((voce) => normalizza(voce.logonTecnico) === canonico),
  };
}

const MESI_DATA = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

function normalizzaData(valore) {
  const testo = String(valore ?? "").trim();
  if (!testo) return "";
  if (/^\d{4}-\d{2}-\d{2}T/.test(testo)) return testo;
  if (/^\d{4}-\d{2}-\d{2}$/.test(testo)) return `${testo}T09:00:00+01:00`;
  const slash = testo.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (slash) return `${slash[3]}-${String(slash[2]).padStart(2, "0")}-${String(slash[1]).padStart(2, "0")}T09:00:00+01:00`;
  const parola = testo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
  if (parola && MESI_DATA[parola[2]]) {
    const anno = parola[3] || String(new Date().getFullYear());
    return `${anno}-${String(MESI_DATA[parola[2]]).padStart(2, "0")}-${String(parola[1]).padStart(2, "0")}T09:00:00+01:00`;
  }
  const data = new Date(testo);
  if (!Number.isNaN(data.getTime())) return data.toISOString();
  return "";
}

function normalizzaStatoIntervento(stato) {
  const valore = String(stato ?? "").trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
  if (!valore || ["assegnato", "nuovo", "da_fare", "programmato"].includes(valore)) return "programmato";
  if (valore === "in_corso" || valore === "incorso") return "in_corso";
  if (valore === "in_attesa") return "in_attesa";
  if (["completato", "annullato"].includes(valore)) return valore;
  return "programmato";
}

function pacchettoDelTicket(pacchetto, ticket, logon) {
  return {
    versione: 1,
    inviato: new Date().toISOString(),
    tecnico: { logon },
    interventi: [],
    ticket: [ticket],
  };
}

async function riceviDallApplicazione(archivio, voce) {
  const soggetto = voce?.soggetto ?? {};
  const id = String(soggetto.id || soggetto.codice || "").trim();
  if (!id) return { ok: false, errore: "Manca il soggetto." };
  if (sembraIntervento(soggetto)) {
    return registraInterventoAssegnato(archivio, soggetto, id);
  }
  if (voce.evento === "assegnazione" && soggetto.precedente) {
    return riassegna(archivio, {
      id,
      titolo: soggetto.titolo,
      da: normalizza(soggetto.precedente),
      a: normalizza(soggetto.logonTecnico),
      stato: soggetto.stato,
    });
  }
  if (voce.evento === "assegnazione") {
    const logon = normalizza(soggetto.logonTecnico);
    archivio.ticket[id] = {
      ...(archivio.ticket[id] ?? {}),
      id,
      titolo: soggetto.titolo,
      logon,
      origine: soggetto.origine ?? archivio.ticket[id]?.origine ?? "applicazione",
      tipologia: soggetto.tipologia ?? null,
      stato: soggetto.stato || "aperto",
      segnalazioneIpad: true,
      inoltrato: true,
    };
    await salva(archivio);
    await pianifica(archivio, {
      tipo: "tablet",
      immediata: true,
      logon,
      voce: { id, titolo: soggetto.titolo, stato: soggetto.stato || "aperto", segnalazioneImmediata: false, genere: "ticket" },
      titolo: soggetto.titolo,
    });
    if (archivio.modalita === "automatica") await verificaSara();
    return { ok: true, messaggio: "Assegnazione ricevuta. Sara la manda sul tablet." };
  }
  archivio.ticket[id] = {
    ...(archivio.ticket[id] ?? {}),
    id,
    titolo: soggetto.titolo,
    logon: normalizza(soggetto.logonTecnico),
    origine: "applicazione",
    stato: soggetto.stato || "aperto",
    segnalazioneIpad: false,
    inoltrato: true,
  };
  await salva(archivio);
  if (archivio.modalita === "automatica") await verificaSara();
  return { ok: true, messaggio: "Ticket nuovo registrato sulla sincronia." };
}

async function riassegna(archivio, movimento) {
  const noto = archivio.interventi[movimento.id];
  const stato = movimento.stato || noto?.stato || await statoIntervento(movimento.id);
  const avviato = stato === "in_corso";
  archivio.interventi[movimento.id] = {
    id: movimento.id,
    titolo: movimento.titolo || noto?.titolo || movimento.id,
    logon: movimento.a,
    stato: stato || "programmato",
    sospeso: avviato,
  };
  archivio.riassegnazioni.unshift({
    id: randomUUID(),
    interventoId: movimento.id,
    da: movimento.da,
    a: movimento.a,
    avviato,
    quando: new Date().toISOString(),
  });
  await salva(archivio);
  await pianifica(archivio, {
    tipo: "riassegnazione",
    immediata: true,
    movimento: { ...movimento, stato, avviato, titolo: archivio.interventi[movimento.id].titolo },
    titolo: archivio.interventi[movimento.id].titolo,
  });
  if (archivio.modalita === "automatica") await verificaSara();
  return {
    ok: true,
    messaggio: avviato
      ? "Intervento già avviato: tolto dal tablet e rimesso in pending."
      : "Intervento spostato sul tablet del nuovo tecnico.",
    avviato,
  };
}

async function apriPending(archivio, campi) {
  const tipologia = String(campi.tipologia ?? "").trim();
  const causale = campi.causale === "problema tecnico" ? "problema tecnico" : "extra tecnico";
  if (!tipologia) return { ok: false, errore: "Manca la tipologia." };
  const pending = {
    id: `pending-sincro-${randomUUID().slice(0, 8)}`,
    tipologia,
    tipologiaId: campi.tipologiaId || "",
    causale,
    nota: String(campi.nota ?? "").trim(),
    riferimento: String(campi.riferimento ?? "").trim(),
    quando: campi.quando || new Date().toISOString(),
    archiviato: false,
  };
  archivio.pending.unshift(pending);
  await salva(archivio);
  await pianifica(archivio, { tipo: "pending", immediata: false, pending, titolo: tipologia });
  if (archivio.modalita === "automatica") await verificaSara();
  return { ok: true, pending };
}

async function chiudiDalTablet(archivio, logon, campi) {
  const id = String(campi.id ?? "").trim();
  const stato = String(campi.stato ?? "").trim();
  if (!id || !stato) return { ok: false, errore: "Servono id e stato." };
  const genere = campi.genere === "intervento" ? "intervento" : "ticket";
  if (genere === "intervento" && archivio.interventi[id]) archivio.interventi[id].stato = stato;
  if (genere === "ticket" && archivio.ticket[id]) archivio.ticket[id].stato = stato;
  const coda = archivio.tablet[logon];
  if (coda) {
    const elenco = genere === "intervento" ? coda.interventi : coda.ticket;
    const voce = elenco.find((candidato) => candidato.id === id);
    if (voce) voce.stato = stato;
  }
  await salva(archivio);
  const pacchetto = {
    versione: 1,
    inviato: new Date().toISOString(),
    tecnico: { logon },
    interventi: genere === "intervento" ? [{ id, stato, aggiornato: new Date().toISOString() }] : [],
    ticket: genere === "ticket" ? [{ id, stato, aggiornato: new Date().toISOString() }] : [],
  };
  await pianifica(archivio, { tipo: "chiusura", immediata: false, pacchetto, logon, titolo: id });
  if (archivio.modalita === "automatica") await verificaSara();
  return { ok: true, messaggio: "Chiusura del tablet ricevuta." };
}

async function pianifica(archivio, trasferimento) {
  const voce = { id: randomUUID(), quando: new Date().toISOString(), ...trasferimento };
  if (archivio.modalita === "manuale") {
    archivio.attese.unshift(voce);
    await salva(archivio);
    return { id: voce.id, inAttesa: true, immediata: Boolean(voce.immediata) };
  }
  await esegui(archivio, voce);
  return { id: voce.id, inAttesa: false, immediata: Boolean(voce.immediata) };
}

async function conferma(archivio, id) {
  const indice = archivio.attese.findIndex((voce) => voce.id === id);
  if (indice < 0) return { ok: false, errore: "Nessun trasferimento in attesa." };
  const [voce] = archivio.attese.splice(indice, 1);
  await salva(archivio);
  await esegui(archivio, voce);
  const report = await verificaSara();
  return { ok: true, partito: true, report };
}

async function esegui(archivio, voce) {
  if (voce.tipo === "applicazione" || voce.tipo === "chiusura") {
    const risposta = await fetch(`${URL_APP}/api/sincronizzazione`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(voce.pacchetto),
    });
    if (!risposta.ok) {
      archivio.attese.unshift(voce);
      await salva(archivio);
      return;
    }
    for (const ticket of voce.pacchetto.ticket ?? []) {
      if (archivio.ticket[ticket.id]) archivio.ticket[ticket.id].inoltrato = true;
    }
  } else if (voce.tipo === "tablet") {
    const coda = assicuratiCoda(archivio, voce.logon);
    const elenco = voce.voce.genere === "intervento" ? coda.interventi : coda.ticket;
    if (!elenco.some((candidato) => candidato.id === voce.voce.id)) {
      elenco.unshift({ ...voce.voce, quando: new Date().toISOString() });
    }
    if (voce.voce.genere === "ticket" && archivio.ticket[voce.voce.id]) {
      archivio.ticket[voce.voce.id].sulTablet = voce.logon;
    }
  } else if (voce.tipo === "riassegnazione") {
    await eseguiRiassegnazione(archivio, voce.movimento);
  } else if (voce.tipo === "pending") {
    const risposta = await fetch(`${URL_APP}/api/sara/pending`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(voce.pending),
    });
    if (!risposta.ok) {
      archivio.attese.unshift(voce);
      await salva(archivio);
      return;
    }
    const salvato = archivio.pending.find((pending) => pending.id === voce.pending.id);
    if (salvato) salvato.inoltrato = true;
  }
  const soggettoId = idSoggetto(voce);
  archivio.trasferimenti.unshift({
    id: voce.id,
    tipo: voce.tipo,
    titolo: voce.titolo,
    quando: new Date().toISOString(),
    tecnico: logonSoggetto(archivio, voce, soggettoId),
    clienteId: clienteSoggetto(archivio, voce, soggettoId),
    soggettoId,
  });
  archivio.trasferimenti = archivio.trasferimenti.slice(0, 30);
  await salva(archivio);
}

async function eseguiRiassegnazione(archivio, movimento) {
  togliId(archivio, movimento.id);
  if (movimento.avviato) {
    const pending = {
      id: `pending-avvio-${movimento.id}`,
      tipologia: "Assenza dell'operatore",
      causale: "extra tecnico",
      nota: `Intervento già avviato da ${movimento.da}. Il tecnico cambia, il lavoro torna in pending.`,
      riferimento: movimento.id,
      quando: new Date().toISOString(),
      archiviato: false,
    };
    if (!archivio.pending.some((voce) => voce.id === pending.id)) archivio.pending.unshift(pending);
    archivio.interventi[movimento.id].sospeso = true;
    archivio.interventi[movimento.id].logon = movimento.a;
    await salva(archivio);
    await fetch(`${URL_APP}/api/sara/pending`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(pending),
    }).catch(() => {});
    return;
  }
  const coda = assicuratiCoda(archivio, movimento.a);
  coda.interventi.unshift({
    id: movimento.id,
    titolo: movimento.titolo,
    stato: movimento.stato || "programmato",
    segnalazioneImmediata: false,
    genere: "intervento",
    quando: new Date().toISOString(),
  });
  archivio.interventi[movimento.id].logon = movimento.a;
  archivio.interventi[movimento.id].sospeso = false;
}

async function assorbiAssegnazioni() {
  const remoto = await leggiApplicazione();
  if (!remoto) return;
  const archivio = await carica();
  for (const intervento of remoto.interventi ?? []) {
    if (archivio.interventi[intervento.id]) continue;
    const logon = normalizza(intervento.logonTecnico);
    archivio.interventi[intervento.id] = {
      id: intervento.id,
      titolo: intervento.titolo,
      logon,
      stato: intervento.stato,
      sospeso: false,
    };
    if (logon) {
      const coda = assicuratiCoda(archivio, logon);
      coda.interventi.unshift({
        id: intervento.id,
        titolo: intervento.titolo,
        stato: intervento.stato,
        segnalazioneImmediata: false,
        genere: "intervento",
        quando: new Date().toISOString(),
      });
    }
  }
  await salva(archivio);
}

async function verificaSara() {
  await assorbiAssegnazioni();
  const archivio = await carica();
  const remoto = await leggiApplicazione();
  const ritrasferiti = [];
  if (!remoto) {
    const report = { coincide: false, trasferimentoCompleto: false, errore: "Applicazione non raggiungibile.", operatori: [], pending: [], ritrasferiti };
    archivio.report = report;
    await salva(archivio);
    return report;
  }

  for (const [logon, coda] of Object.entries(archivio.tablet)) {
    coda.interventi = coda.interventi.filter((voce) => {
      const master = archivio.interventi[voce.id];
      const tiene = master && !master.sospeso && master.logon === logon;
      if (!tiene) ritrasferiti.push({ id: voce.id, azione: "tolto dal tablet", logon });
      return tiene;
    });
    coda.ticket = coda.ticket.filter((voce) => {
      const master = archivio.ticket[voce.id];
      const tiene = master && master.segnalazioneIpad && master.sulTablet === logon && master.logon === logon;
      if (!tiene) ritrasferiti.push({ id: voce.id, azione: "tolto dal tablet", logon });
      return tiene;
    });
  }

  for (const intervento of Object.values(archivio.interventi)) {
    if (intervento.sospeso) {
      togliId(archivio, intervento.id);
      continue;
    }
    const coda = assicuratiCoda(archivio, intervento.logon);
    if (intervento.logon && !coda.interventi.some((voce) => voce.id === intervento.id)) {
      coda.interventi.unshift({ id: intervento.id, titolo: intervento.titolo, stato: intervento.stato, genere: "intervento", quando: new Date().toISOString() });
      ritrasferiti.push({ id: intervento.id, azione: "rimesso sul tablet", logon: intervento.logon });
    }
    const sullApp = (remoto.interventi ?? []).find((voce) => voce.id === intervento.id);
    if (sullApp && normalizza(sullApp.logonTecnico) !== intervento.logon) {
      await fetch(`${URL_APP}/api/sara/allinea`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ interventi: [{ id: intervento.id, logonTecnico: intervento.logon }] }),
      });
      ritrasferiti.push({ id: intervento.id, azione: "logon riallineato sull'applicazione", logon: intervento.logon });
    }
  }

  for (const ticket of Object.values(archivio.ticket)) {
    if (!ticket.inoltrato && ticket.pacchetto && !inAttesa(archivio, ticket.id)) {
      await esegui(archivio, { id: randomUUID(), tipo: "applicazione", pacchetto: ticket.pacchetto, titolo: ticket.titolo });
      ritrasferiti.push({ id: ticket.id, azione: "reinoltrato all'applicazione" });
    }
    if (ticket.segnalazioneIpad && ticket.sulTablet && !inAttesa(archivio, ticket.id)) {
      const coda = assicuratiCoda(archivio, ticket.sulTablet);
      if (!coda.ticket.some((voce) => voce.id === ticket.id)) {
        coda.ticket.unshift({ id: ticket.id, titolo: ticket.titolo, stato: ticket.stato, segnalazioneImmediata: true, genere: "ticket", quando: new Date().toISOString() });
        ritrasferiti.push({ id: ticket.id, azione: "segnalato di nuovo sul tablet", logon: ticket.sulTablet });
      }
    }
  }

  for (const pending of archivio.pending) {
    const presente = (remoto.pending ?? []).some((voce) => voce.id === pending.id);
    if (!presente && !inAttesa(archivio, pending.id)) {
      await fetch(`${URL_APP}/api/sara/pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(pending),
      });
      pending.inoltrato = true;
      ritrasferiti.push({ id: pending.id, azione: "pending riportato sull'applicazione" });
    }
  }

  await salva(archivio);
  const dopo = await leggiApplicazione();
  const report = costruisciReport(archivio, dopo, ritrasferiti);
  if (report.coincide) {
    const etichette = Object.values(archivio.ticket).filter((ticket) => ticket.inoltrato).map((ticket) => ticket.id);
    await fetch(`${URL_APP}/api/sara/allinea`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ etichette }),
    });
    report.etichetta = "sincronizzato correttamente";
  }
  const aggiornato = await carica();
  aggiornato.report = report;
  await salva(aggiornato);
  return report;
}

function costruisciReport(archivio, remoto, ritrasferiti) {
  const nomi = new Map((remoto?.tecnici ?? []).map((tecnico) => [tecnico.logon, tecnico.nome]));
  const logon = new Set([
    ...Object.keys(archivio.tablet),
    ...Object.values(archivio.interventi).map((voce) => voce.logon),
    ...Object.values(archivio.ticket).map((voce) => voce.logon),
  ].filter(Boolean));
  const operatori = [...logon].sort().map((chiave) => {
    const coda = archivio.tablet[chiave] ?? { interventi: [], ticket: [] };
    const voci = [...coda.interventi, ...coda.ticket];
    const eseguiti = voci.filter((voce) => ESEGUITI.has(voce.stato)).length;
    const pending = archivio.pending.filter((voce) => voce.riferimento && (archivio.interventi[voce.riferimento]?.logon === chiave || archivio.ticket[voce.riferimento]?.logon === chiave));
    return {
      logon: chiave,
      nome: nomi.get(chiave) || chiave,
      ricevuti: voci.length,
      eseguiti,
      daFare: voci.length - eseguiti,
      pending: pending.length,
    };
  });
  const differenze = [];
  if (remoto) {
    for (const [chiave, coda] of Object.entries(archivio.tablet)) {
      for (const voce of [...coda.interventi, ...coda.ticket]) {
        const elenco = voce.genere === "ticket" ? remoto.ticket : remoto.interventi;
        const sullApp = (elenco ?? []).find((candidato) => candidato.id === voce.id);
        if (!sullApp) differenze.push({ id: voce.id, motivo: "sul tablet e assente dall'applicazione" });
        else if (normalizza(sullApp.logonTecnico) !== chiave && !archivio.interventi[voce.id]?.sospeso) {
          differenze.push({ id: voce.id, motivo: "tecnico diverso tra tablet e applicazione" });
        }
      }
    }
    for (const ticket of Object.values(archivio.ticket)) {
      if (!ticket.inoltrato || inAttesa(archivio, ticket.id)) continue;
      if (!(remoto.ticket ?? []).some((voce) => voce.id === ticket.id)) {
        differenze.push({ id: ticket.id, motivo: "inoltrato ma assente dall'applicazione" });
      }
    }
    for (const pending of archivio.pending) {
      const sullApp = (remoto.pending ?? []).find((voce) => voce.id === pending.id);
      if (!sullApp) differenze.push({ id: pending.id, motivo: "pending assente dall'applicazione" });
      else if ((sullApp.causale || "") !== (pending.causale || "")) differenze.push({ id: pending.id, motivo: "causale diversa" });
    }
  }
  const pending = archivio.pending.map((voce) => ({
    id: voce.id,
    tipologia: voce.tipologia,
    causale: voce.causale,
    quando: voce.quando,
    riferimento: voce.riferimento,
    ancoraInPending: voce.archiviato !== true,
  }));
  return {
    coincide: differenze.length === 0 && Boolean(remoto),
    trasferimentoCompleto: differenze.length === 0 && Boolean(remoto),
    operatori,
    pending,
    differenze,
    ritrasferiti,
    inAttesa: archivio.attese.length,
    applicazione: { ticket: remoto?.ticket?.length ?? 0, interventi: remoto?.interventi?.length ?? 0 },
    tablet: {
      ticket: Object.values(archivio.tablet).reduce((totale, coda) => totale + coda.ticket.length, 0),
      interventi: Object.values(archivio.tablet).reduce((totale, coda) => totale + coda.interventi.length, 0),
    },
  };
}

function inAttesa(archivio, id) {
  return archivio.attese.some((voce) => voce.pacchetto?.ticket?.some((ticket) => ticket.id === id) || voce.pending?.id === id || voce.voce?.id === id || voce.movimento?.id === id);
}

async function statoIntervento(id) {
  const remoto = await leggiApplicazione();
  return remoto?.interventi?.find((voce) => voce.id === id)?.stato || "";
}

async function leggiApplicazione() {
  try {
    const risposta = await fetch(`${URL_APP}/api/sara/stato`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(1500) });
    if (!risposta.ok) return null;
    return await risposta.json();
  } catch {
    return null;
  }
}

function assicuratiCoda(archivio, logon) {
  if (!archivio.tablet[logon]) archivio.tablet[logon] = { interventi: [], ticket: [] };
  return archivio.tablet[logon];
}

function togliId(archivio, id) {
  for (const coda of Object.values(archivio.tablet)) {
    coda.interventi = coda.interventi.filter((voce) => voce.id !== id);
    coda.ticket = coda.ticket.filter((voce) => voce.id !== id);
  }
}

function togliDalTablet(archivio, logon, id) {
  const coda = archivio.tablet[logon];
  if (!coda) return;
  coda.interventi = coda.interventi.filter((voce) => voce.id !== id);
  coda.ticket = coda.ticket.filter((voce) => voce.id !== id);
}

function eCritica(archivio, tipologia) {
  const valore = String(tipologia ?? "").trim().toLowerCase();
  return archivio.tipologieCritiche.some((voce) => voce.trim().toLowerCase() === valore);
}

function normalizza(logon) {
  return String(logon ?? "").trim().toLowerCase();
}

async function carica() {
  try {
    return assicurati(JSON.parse(await readFile(PERCORSO_ARCHIVIO, "utf8")));
  } catch (errore) {
    if (errore.code !== "ENOENT") throw errore;
    const vuoto = assicurati({});
    await salva(vuoto);
    return vuoto;
  }
}

function assicurati(archivio) {
  archivio.modalita = archivio.modalita === "manuale" ? "manuale" : "automatica";
  archivio.tipologieCritiche = Array.isArray(archivio.tipologieCritiche) && archivio.tipologieCritiche.length ? archivio.tipologieCritiche : [...CRITICHE_INIZIALI];
  archivio.ticket = archivio.ticket && !Array.isArray(archivio.ticket) ? archivio.ticket : {};
  archivio.interventi = archivio.interventi && !Array.isArray(archivio.interventi) ? archivio.interventi : {};
  archivio.tablet = archivio.tablet && !Array.isArray(archivio.tablet) ? archivio.tablet : {};
  for (const chiave of ["pending", "attese", "riassegnazioni", "trasferimenti", "dialogo"]) {
    if (!Array.isArray(archivio[chiave])) archivio[chiave] = [];
  }
  return archivio;
}

async function salva(archivio) {
  await mkdir(CARTELLA_DATI, { recursive: true });
  const temporaneo = `${PERCORSO_ARCHIVIO}.${process.pid}.tmp`;
  await writeFile(temporaneo, `${JSON.stringify(archivio, null, 2)}\n`, "utf8");
  await rename(temporaneo, PERCORSO_ARCHIVIO);
}

async function leggiOggetto(richiesta) {
  const pezzi = [];
  for await (const pezzo of richiesta) pezzi.push(pezzo);
  const corpo = Buffer.concat(pezzi).toString("utf8");
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
    risposta.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
    risposta.end();
    return;
  }
  json(risposta, codice, corpo);
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

function html(risposta, corpo) {
  const dati = Buffer.from(corpo);
  risposta.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": dati.length,
    "Cache-Control": "no-store",
  });
  risposta.end(dati);
}

function pagina(archivio) {
  const report = archivio.report;
  const operatori = (report?.operatori ?? []).map((voce) => `<li>${escape(voce.nome)}: ${voce.ricevuti} ricevuti, ${voce.eseguiti} eseguiti, ${voce.daFare} da fare, ${voce.pending} in pending</li>`).join("");
  const pending = (archivio.pending ?? []).map((voce) => `<li>${escape(voce.tipologia)} · causale ${escape(voce.causale)} · ${escape(voce.quando || "")} · ${voce.archiviato ? "archiviato" : "ancora in pending"}</li>`).join("");
  const tablet = Object.entries(archivio.tablet).map(([logon, coda]) => {
    const voci = [...coda.interventi.map((voce) => `intervento ${voce.titolo}`), ...coda.ticket.map((voce) => `ticket ${voce.titolo}${voce.segnalazioneImmediata ? " · segnalazione immediata" : ""}`)];
    return `<li><strong>${escape(logon)}</strong>: ${voci.length ? escape(voci.join("; ")) : "vuoto"}</li>`;
  }).join("");
  const attese = archivio.attese.map((voce) => `<form method="post" action="/api/conferma"><input type="hidden" name="id" value="${escape(voce.id)}"><button type="submit">Conferma ${escape(voce.tipo)}${voce.immediata ? " · segnalazione immediata" : ""} · ${escape(voce.titolo || "")}</button></form>`).join("");
  const primoTablet = Object.entries(archivio.tablet).find(([, coda]) => coda.ticket.length || coda.interventi.length);
  const dimentica = primoTablet
    ? `<form method="post" action="/api/tablet/dimentica"><input type="hidden" name="logon" value="${escape(primoTablet[0])}"><input type="hidden" name="id" value="${escape((primoTablet[1].ticket[0] || primoTablet[1].interventi[0]).id)}"><button type="submit">Simula uno stato diverso sul tablet</button></form>`
    : "";
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sincronia</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", sans-serif; background: #f4f1ea; color: #1c2430; }
    header { background: #243044; color: white; padding: 28px 32px; }
    header p { margin: 8px 0 0; max-width: 48rem; }
    main { padding: 28px 32px 64px; display: grid; gap: 24px; }
    section { background: white; border-radius: 16px; padding: 20px 22px; }
    h2 { margin: 0 0 12px; font-size: 1.2rem; }
    .meta { color: #5c6770; }
    .ok { color: #1f7a4d; font-weight: 700; }
    button { font: inherit; background: #243044; color: white; border: 0; border-radius: 10px; padding: 10px 16px; cursor: pointer; }
    form { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin: 8px 0; }
    input, select { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid #d5cec3; }
    .nuovo { display: inline-block; margin-left: 8px; background: #b45309; color: white; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; vertical-align: middle; }
    a { color: #1d4e89; }
    header a { color: #f4f1ea; }
    nav { margin-top: 14px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e6e0d6; vertical-align: top; }
    th { font-size: 0.85rem; color: #5c6770; font-weight: 650; }
    label { display: grid; gap: 4px; font-size: 0.92rem; }
    .filtri { align-items: end; }
  </style>
</head>
<body>
  <header>
    <h1>Sincronia <span class="nuovo">Nuovo</span></h1>
    <p>Riceve i ticket dalla macchina, li inoltra sempre all'applicazione e, se la tipologia è critica, li segnala sul tablet. Sara confronta gli stati e il suo fa fede.</p>
    <nav><a href="/log">Log</a></nav>
  </header>
  <main>
    <section>
      <h2>Modalità <span class="nuovo">Nuovo</span></h2>
      <p class="meta">Ora è ${escape(archivio.modalita)}. In automatico i trasferimenti partono da soli. In manuale restano qui fino a Conferma. Una segnalazione critica, in manuale, resta in cima alla coda.</p>
      <form method="post" action="/api/modalita">
        <input type="hidden" name="modalita" value="${archivio.modalita === "automatica" ? "manuale" : "automatica"}">
        <button type="submit">Passa a ${archivio.modalita === "automatica" ? "manuale" : "automatica"}</button>
      </form>
      ${attese || "<p class=\"meta\">Nessun trasferimento in attesa.</p>"}
    </section>
    <section>
      <h2>Tablet <span class="nuovo">Nuovo</span></h2>
      <p class="meta">Quello che la sincronia ha messo sul tablet di ciascun tecnico. Un cambio tecnico toglie l'intervento dal primo e lo mette sul secondo.</p>
      ${tablet ? `<ul>${tablet}</ul>` : "<p class=\"meta\">Nessun tablet ha ancora un intervento.</p>"}
      ${dimentica}
    </section>
    <section>
      <h2>Pending <span class="nuovo">Nuovo</span></h2>
      <p class="meta">La causale distingue il problema tecnico dal motivo extra tecnico. Sara riporta il pending sull'applicazione.</p>
      ${pending ? `<ul>${pending}</ul>` : "<p class=\"meta\">Nessun pending.</p>"}
      <form method="post" action="/api/pending">
        <select name="tipologia">
          <option>Problema tecnico</option>
          <option>Assenza dell'operatore</option>
          <option>Attesa ricambio</option>
          <option>Indisponibilità dell'impianto</option>
        </select>
        <select name="causale">
          <option>problema tecnico</option>
          <option>extra tecnico</option>
        </select>
        <input name="nota" placeholder="Nota">
        <input name="riferimento" placeholder="Ticket o intervento">
        <button type="submit">Metti in pending</button>
      </form>
    </section>
    <section>
      <h2>Agente Sara <span class="nuovo">Nuovo</span></h2>
      <p class="meta">Report per operatore, pending ancora aperti e controllo che il tablet e l'applicazione raccontino la stessa cosa.</p>
      <p class="${report?.coincide ? "ok" : "meta"}">${report ? (report.coincide ? "Il report coincide. Trasferimento completo." : "Ci sono differenze.") : "Il report arriva alla prima verifica."} ${report?.etichetta ? escape(report.etichetta) : ""}</p>
      ${operatori ? `<ul>${operatori}</ul>` : ""}
      ${(report?.ritrasferiti ?? []).length ? `<p class="meta">Ritrasferiti da Sara: ${escape(report.ritrasferiti.map((voce) => voce.id).join(", "))}</p>` : ""}
      <form method="post" action="/api/sara/verifica"><button type="submit">Verifica di Sara</button></form>
    </section>
    <section>
      <h2>Log <span class="nuovo">Nuovo</span></h2>
      <p class="meta">I movimenti sono in una tabella, con i filtri Data, Cliente e Tecnico.</p>
      <p><a href="/log">Apri il log</a></p>
    </section>
  </main>
</body>
</html>`;
}

const TIPI_LOG = {
  applicazione: "Applicazione",
  tablet: "Tablet",
  chiusura: "Chiusura",
  pending: "Pending",
  riassegnazione: "Riassegnazione",
};

function idSoggetto(voce) {
  if (voce.tipo === "tablet") return voce.voce?.id || "";
  if (voce.tipo === "chiusura") return voce.pacchetto?.ticket?.[0]?.id || voce.pacchetto?.interventi?.[0]?.id || voce.titolo || "";
  if (voce.tipo === "riassegnazione") return voce.movimento?.id || "";
  if (voce.tipo === "pending") return voce.pending?.riferimento || "";
  if (voce.tipo === "applicazione") return voce.pacchetto?.ticket?.[0]?.id || voce.pacchetto?.interventi?.[0]?.id || "";
  return "";
}

function logonSoggetto(archivio, voce, id) {
  if (voce.tipo === "riassegnazione") return normalizza(voce.movimento?.a);
  if (voce.logon) return normalizza(voce.logon);
  if (voce.pacchetto?.tecnico?.logon) return normalizza(voce.pacchetto.tecnico.logon);
  return normalizza(archivio.ticket[id]?.logon || archivio.interventi[id]?.logon);
}

function clienteSoggetto(archivio, voce, id) {
  const dalPacchetto = voce.pacchetto?.ticket?.[0]?.clienteId || voce.pacchetto?.interventi?.[0]?.clienteId || "";
  if (dalPacchetto) return String(dalPacchetto);
  return String(archivio.ticket[id]?.pacchetto?.ticket?.[0]?.clienteId || "");
}

function piuVicino(elenco, quando, accettato) {
  const istante = Date.parse(quando || "");
  let migliore = null;
  let distanza = 8000;
  for (const candidato of elenco ?? []) {
    if (accettato && !accettato(candidato)) continue;
    const altro = Date.parse(candidato.quando || "");
    if (Number.isNaN(istante) || Number.isNaN(altro)) continue;
    const delta = Math.abs(istante - altro);
    if (delta <= distanza) {
      distanza = delta;
      migliore = candidato;
    }
  }
  return migliore;
}

function indovinaSoggetto(archivio, voce) {
  if (voce.soggettoId) return voce.soggettoId;
  if (voce.tipo === "chiusura" && (archivio.ticket[voce.titolo] || archivio.interventi[voce.titolo])) return voce.titolo;
  if (voce.tipo === "pending") {
    const pending = piuVicino(archivio.pending, voce.quando, (candidato) => candidato.tipologia === voce.titolo);
    if (pending?.riferimento) return pending.riferimento;
  }
  if (voce.tipo === "riassegnazione") {
    const movimento = piuVicino(archivio.riassegnazioni, voce.quando, (candidato) => {
      const intervento = archivio.interventi[candidato.interventoId];
      return !voce.titolo || intervento?.titolo === voce.titolo;
    });
    if (movimento?.interventoId) return movimento.interventoId;
  }
  const ticket = Object.values(archivio.ticket).find((candidato) => candidato.titolo === voce.titolo);
  if (ticket) return ticket.id;
  const intervento = Object.values(archivio.interventi).find((candidato) => candidato.titolo === voce.titolo);
  return intervento?.id || "";
}

function giornoDi(iso) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(data);
}

function oraDi(iso) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return String(iso ?? "");
  return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "medium" }).format(data);
}

function righeLog(archivio, remoto) {
  const nomiTecnici = new Map((remoto?.tecnici ?? []).map((tecnico) => [tecnico.logon, tecnico.nome]));
  const nomiClienti = new Map((remoto?.clienti ?? []).map((cliente) => [cliente.id, cliente.nome]));
  const soggetti = new Map([
    ...(remoto?.ticket ?? []).map((voce) => [voce.id, voce]),
    ...(remoto?.interventi ?? []).map((voce) => [voce.id, voce]),
  ]);
  return (archivio.trasferimenti ?? []).map((voce) => {
    const soggettoId = indovinaSoggetto(archivio, voce);
    const locale = archivio.ticket[soggettoId] || archivio.interventi[soggettoId];
    const remotoSoggetto = soggetti.get(soggettoId);
    let tecnico = voce.tecnico || "";
    if (!tecnico && voce.tipo === "riassegnazione") {
      const movimento = piuVicino(archivio.riassegnazioni, voce.quando, (candidato) => candidato.interventoId === soggettoId);
      tecnico = movimento?.a || "";
    }
    if (!tecnico) tecnico = locale?.logon || remotoSoggetto?.logonTecnico || "";
    tecnico = normalizza(tecnico);
    const clienteId = voce.clienteId || remotoSoggetto?.clienteId || locale?.pacchetto?.ticket?.[0]?.clienteId || "";
    return {
      ...voce,
      soggettoId,
      tecnico,
      nomeTecnico: nomiTecnici.get(tecnico) || tecnico,
      clienteId: String(clienteId || ""),
      nomeCliente: nomiClienti.get(clienteId) || "",
      giorno: giornoDi(voce.quando),
    };
  });
}

function opzione(valore, etichetta, scelto) {
  const selected = valore === scelto ? " selected" : "";
  return `<option value="${escape(valore)}"${selected}>${escape(etichetta)}</option>`;
}

function paginaLog(archivio, remoto, parametri) {
  const righe = righeLog(archivio, remoto);
  const data = String(parametri.get("data") ?? "");
  const cliente = String(parametri.get("cliente") ?? "");
  const tecnico = String(parametri.get("tecnico") ?? "");
  const filtrate = righe.filter((riga) => {
    if (data && riga.giorno !== data) return false;
    if (cliente && riga.clienteId !== cliente) return false;
    if (tecnico && riga.tecnico !== tecnico) return false;
    return true;
  });
  const clienti = new Map((remoto?.clienti ?? []).map((voce) => [voce.id, voce.nome]));
  for (const riga of righe) {
    if (riga.clienteId && !clienti.has(riga.clienteId)) clienti.set(riga.clienteId, riga.nomeCliente || riga.clienteId);
  }
  const tecnici = new Map((remoto?.tecnici ?? []).map((voce) => [voce.logon, voce.nome]));
  for (const riga of righe) {
    if (riga.tecnico && !tecnici.has(riga.tecnico)) tecnici.set(riga.tecnico, riga.nomeTecnico || riga.tecnico);
  }
  const opzioniClienti = [...clienti.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "it"))
    .map(([id, nome]) => opzione(id, nome, cliente))
    .join("");
  const opzioniTecnici = [...tecnici.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "it"))
    .map(([logon, nome]) => opzione(logon, nome, tecnico))
    .join("");
  const corpo = filtrate.map((riga) => `<tr>
      <td>${escape(oraDi(riga.quando))}</td>
      <td>${escape(TIPI_LOG[riga.tipo] || riga.tipo || "")}</td>
      <td>${escape(riga.titolo || "")}</td>
      <td>${escape(riga.nomeCliente || "—")}</td>
      <td>${escape(riga.nomeTecnico || "—")}</td>
    </tr>`).join("");
  const vuoto = righe.length
    ? "Nessun movimento con questi filtri."
    : "Nessun movimento nel log.";
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Log della sincronia</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", sans-serif; background: #f4f1ea; color: #1c2430; }
    header { background: #243044; color: white; padding: 28px 32px; }
    header p { margin: 8px 0 0; max-width: 48rem; }
    main { padding: 28px 32px 64px; display: grid; gap: 24px; }
    section { background: white; border-radius: 16px; padding: 20px 22px; }
    h2 { margin: 0 0 12px; font-size: 1.2rem; }
    .meta { color: #5c6770; }
    button { font: inherit; background: #243044; color: white; border: 0; border-radius: 10px; padding: 10px 16px; cursor: pointer; }
    form { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin: 8px 0; }
    input, select { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid #d5cec3; background: white; }
    .nuovo { display: inline-block; margin-left: 8px; background: #b45309; color: white; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; vertical-align: middle; }
    a { color: #1d4e89; }
    header a { color: #f4f1ea; }
    nav { margin-top: 14px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e6e0d6; vertical-align: top; }
    th { font-size: 0.85rem; color: #5c6770; }
    label { display: grid; gap: 4px; font-size: 0.92rem; }
    .filtri { align-items: end; }
    .secondario { background: transparent; color: #243044; border: 1px solid #d5cec3; text-decoration: none; padding: 10px 16px; border-radius: 10px; }
  </style>
</head>
<body>
  <header>
    <h1>Log <span class="nuovo">Nuovo</span></h1>
    <p>I movimenti della sincronia, una riga per ciascuno. I filtri Data, Cliente e Tecnico si sommano.</p>
    <nav><a href="/">Torna alla sincronia</a></nav>
  </header>
  <main>
    <section>
      <h2>Filtri</h2>
      <form class="filtri" method="get" action="/log">
        <label>Data <input type="date" name="data" value="${escape(data)}"></label>
        <label>Cliente <select name="cliente"><option value="">Tutti</option>${opzioniClienti}</select></label>
        <label>Tecnico <select name="tecnico"><option value="">Tutti</option>${opzioniTecnici}</select></label>
        <button type="submit">Filtra</button>
        <a class="secondario" href="/log">Azzera</a>
      </form>
      <p class="meta">${filtrate.length} di ${righe.length}. La data è il giorno a Roma. Cliente e tecnico vuoti significano tutti.</p>
    </section>
    <section>
      <h2>Movimenti</h2>
      <table>
        <thead>
          <tr><th>Data</th><th>Tipo</th><th>Titolo</th><th>Cliente</th><th>Tecnico</th></tr>
        </thead>
        <tbody>
          ${corpo || `<tr><td colspan="5">${vuoto}</td></tr>`}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function escape(valore) {
  return String(valore ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

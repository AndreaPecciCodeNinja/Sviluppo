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

const ETICHETTE_INTERVENTO = {
  programmato: "Programmato",
  in_corso: "In corso",
  in_attesa: "In attesa",
  completato: "Completato",
  annullato: "Annullato",
};

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
      return html(risposta, 200, pagina(archivio));
    }

    const assegnazioni = url.pathname.match(/^\/api\/tecnici\/([^/]+)\/assegnazioni$/);
    if (richiesta.method === "GET" && assegnazioni) {
      const logon = normalizza(decodeURIComponent(assegnazioni[1]));
      const archivio = await carica();
      const tecnico = tecnicoDi(archivio, logon);
      if (!tecnico) return json(risposta, 404, { errore: "Nessun tecnico con questo logon." });
      return json(risposta, 200, pacchettoAssegnazioni(archivio, tecnico.logon));
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
  const ticket = (archivio.ticket ?? []).filter((voce) => voce.logonTecnico === logon);
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
  for (const aggiornamento of pacchetto.ticket) {
    const record = (archivio.ticket ?? []).find((voce) => voce.id === aggiornamento.id && voce.logonTecnico === tecnico.logon);
    if (!record) continue;
    if (STATI_TICKET.has(aggiornamento.stato)) record.stato = aggiornamento.stato;
    if (aggiornamento.aggiornato) record.aggiornato = String(aggiornamento.aggiornato);
    record.risposte = unisciAnnotazioni(record.risposte, aggiornamento.risposte);
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

function pagina(archivio) {
  const tecnici = archivio.tecnici ?? [];
  const blocchi = tecnici.map((tecnico) => schedaTecnico(archivio, tecnico)).join("");
  const aggiornamenti = (archivio.aggiornamenti ?? []).map((voce) => {
    return `<li><strong>${escape(voce.nome || voce.logon)}</strong> · ${escape(voce.inviato)} · ${voce.interventi} interventi · ${voce.ticket} ticket</li>`;
  }).join("");
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
  </style>
</head>
<body>
  <header>
    <h1>Assistenza Tecnica Demo</h1>
    <p>Dati locali del server sulla porta 3012. L'iPad scarica le assegnazioni e reinvia stato, note e risposte.</p>
  </header>
  <main>
    <section>
      <h2>Aggiornamenti arrivati dall'iPad</h2>
      ${aggiornamenti ? `<ul>${aggiornamenti}</ul>` : "<p class=\"meta\">Nessun invio ancora. I dati di partenza sono quelli del seed.</p>"}
      <p><a href="/">Aggiorna la pagina</a></p>
    </section>
    ${blocchi}
  </main>
</body>
</html>`;
}

function schedaTecnico(archivio, tecnico) {
  const interventi = (archivio.interventi ?? []).filter((voce) => voce.logonTecnico === tecnico.logon);
  const ticket = (archivio.ticket ?? []).filter((voce) => voce.logonTecnico === tecnico.logon);
  const lavori = interventi.map((intervento) => {
    const note = (intervento.note ?? []).map((nota) => `<li>${escape(nota.testo)} <span class="meta">— ${escape(nota.autore)}, ${escape(nota.data)}</span></li>`).join("");
    return `<article>
      <h3>${escape(intervento.titolo)}</h3>
      <p class="meta">${escape(ETICHETTE_INTERVENTO[intervento.stato] || intervento.stato)} · ${escape(nomeCliente(archivio, intervento.clienteId))} · ${escape(intervento.appuntamento || "")}</p>
      ${note ? `<ul>${note}</ul>` : "<p class=\"meta\">Nessuna nota.</p>"}
    </article>`;
  }).join("");
  const richieste = ticket.map((voce) => {
    const risposte = (voce.risposte ?? []).map((risposta) => `<li>${escape(risposta.testo)} <span class="meta">— ${escape(risposta.autore)}, ${escape(risposta.data)}</span></li>`).join("");
    return `<article>
      <h3>${escape(voce.titolo)}</h3>
      <p class="meta">${escape(ETICHETTE_TICKET[voce.stato] || voce.stato)} · ${escape(nomeCliente(archivio, voce.clienteId))}</p>
      ${risposte ? `<ul>${risposte}</ul>` : "<p class=\"meta\">Nessuna risposta.</p>"}
    </article>`;
  }).join("");
  return `<section>
    <h2>${escape(tecnico.nome)}</h2>
    <p class="meta">${escape(tecnico.logon)} · password dimostrativa assistenza</p>
    <h3>Interventi</h3>
    ${lavori || "<p class=\"meta\">Nessun intervento.</p>"}
    <h3>Ticket</h3>
    ${richieste || "<p class=\"meta\">Nessun ticket.</p>"}
  </section>`;
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

# Sviluppo

App iPad **Assistenza** per il tecnico sul campo: interventi, clienti e ticket. I dati restano sull'iPad e l'app funziona senza rete. Non c'è un backend.

## Avvio sul simulatore iPad

Serve un Mac con Xcode 16 o successivo.

1. Apri `AssistenzaMobile.xcodeproj`.
2. Nella barra di Xcode scegli un simulatore iPad, per esempio iPad Pro 13".
3. Premi Run.

Da terminale, dopo aver letto il nome esatto del simulatore:

```bash
xcrun simctl list devices available | grep iPad

xcodebuild \
  -project AssistenzaMobile.xcodeproj \
  -scheme AssistenzaMobile \
  -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M4)' \
  -derivedDataPath build \
  build

xcrun simctl boot "iPad Pro 13-inch (M4)" || true
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/AssistenzaMobile.app
xcrun simctl launch booted it.sviluppo.assistenza
```

Per compilare senza un simulatore specifico:

```bash
xcodebuild \
  -project AssistenzaMobile.xcodeproj \
  -scheme AssistenzaMobile \
  -destination 'generic/platform=iOS Simulator' \
  build
```

L'app è solo iPad (iPadOS 17 o successivo).

## Accessi dimostrativi

Al primo avvio l'archivio locale contiene due tecnici. La password è `assistenza`.

- `marco.bianchi` vede clienti e interventi a Roma
- `lucia.ferrari` vede clienti e interventi a Milano

Il logon è locale: filtra ciò che l'app mostra. Non è un account su un server.

## Importare gli interventi assegnati

In **Importazione**:

- **Scegli un file JSON** legge un file già sull'iPad (anche in modalità aereo).
- **Importa l'esempio di Paolo Conti** crea il logon `paolo.conti` con la stessa password e i suoi interventi. Per vederli, esci e entra con quel logon.
- **Importa un intervento per Marco Bianchi** aggiunge un lavoro visibile subito se sei entrato come Marco.

Sul simulatore puoi trascinare un JSON nella finestra e poi sceglierlo da File. Su un iPad collegato al Mac: Finder, iPad, Documenti, Assistenza, copia il file e nell'app tocca **Aggiorna elenco**.

Esempi nel repository:

- `esempi/assegnazioni-paolo-conti.json`
- `esempi/interventi-marco-bianchi.json`

Il file può essere un oggetto con `tecnici`, `clienti` (oppure `utenti`), `interventi` e `ticket`, oppure un elenco di soli interventi. Un `id` già presente aggiorna la scheda; le note scritte sull'iPad restano. La password di un tecnico nuovo si salva solo come impronta e solo alla prima importazione di quel logon.

Campi principali di un intervento: `titolo`, `logonTecnico`, `appuntamento` (ISO 8601), `clienteId` oppure un oggetto `cliente`, `stato` (`programmato`, `in_corso`, `in_attesa`, `completato`, `annullato`), `priorita` (`bassa`, `media`, `alta`, `urgente`), `note`.

## Avvio dei tre servizi

Dalla cartella del repository. Su macOS è `~/Documents/Sviluppo`.

```bash
./avvia-demo.sh
./spegni-demo.sh
```

Il primo avvia in background l'assistenza sulla porta 3021, la sincronia sulla 3022 e la macchina sulla 3023. Il secondo le ferma. Serve `node` nel PATH. I log restano in `.demo/`.

## Pannello demo

Pagina a parte, porta **3020**.

```bash
node pannello-demo/server.mjs
```

Apri http://127.0.0.1:3020/. **Avvia le demo** e **Spegni le demo** accendono e fermano assistenza (3021), sincronia (3022), macchina (3023) e Assistenza Tecnica Demo (3014). Accanto ai pulsanti, lo stato di ciascuna è «accesa» o «spenta» e si aggiorna da solo. Assistenza Tecnica Demo parte con `PORT=3014 npm start` dalla cartella `/Users/macair_andrea/Documents/ChatGPT/Progetto CRM/assistenza-demo-clone`. La porta 3011 resta libera.

## Demo Assistenza Tecnica

Il server è in `demo-assistenza/`. I dati restano nel file locale `demo-assistenza/dati/archivio.json`, creato al primo avvio dal seed. Non serve installare pacchetti.

```bash
node demo-assistenza/server.mjs
```

Poi apri http://127.0.0.1:3021/. In cima, sopra la scelta dell'operatore, ci sono due comandi affiancati: **Simula un ticket e invialo** e, in verde con il segno di spunta, **Completa un ticket di prova**. Poi scegli l'operatore, per esempio Marco Bianchi. **Ticket da inviare** elenca solo i ticket ancora da mandare alla sua app. **Ticket ricevuti** elenca solo quelli arrivati dalla sua app. Completa un ticket di prova lo segna come eseguito per l'operatore selezionato.

Sull'iPad, in **Ticket**, premi **Scarica eseguiti**: arrivano solo i ticket risolti o chiusi di chi ha fatto l'accesso.

Logon di prova, password `assistenza`: `marco.bianchi`, `lucia.ferrari`, `paolo.conti`.

L'iPad, in **Sincronizzazione**, usa la stessa origine:

1. `GET /api/tecnici/{logon}/assegnazioni` restituisce il JSON dell'importazione, solo per quel logon.
2. `GET /api/tecnici/{logon}/ticket-eseguiti` restituisce solo i ticket risolti o chiusi di quel logon.
3. `POST /api/sincronizzazione` registra stato, note e risposte. Le date sono ISO 8601.

Se il server è spento, l'app iPad continua a funzionare con l'archivio sul dispositivo.

## Macchina simulata

Servizio a parte, porta **3023**. Il tipo di macchina è il file `demo-macchina/macchine/lavatrice-lavanderia.json` (lavatrice di lavanderia industriale). I parametri di funzionamento e di consumo cambiano in continuo. I comandi generano i ticket e li inviano alla sincronia, porta 3022.

```bash
node demo-macchina/server.mjs
```

Poi apri http://127.0.0.1:3023/. Le parti nuove sono segnate con **Nuovo**.

Sulla demo, in **Manutenzione predittiva**, i ticket della macchina mostrano origine e anomalia rispetto al piano. Un ticket nuovo o assegnato parte verso la sincronia: subito in modalità automatica, dopo **Conferma invio** in modalità manuale. Lo stato critico è «ticket in gestione urgente». La label «sincronizzato correttamente» la scrive Sara, quando il suo report coincide.

## Sincronia

Porta **3022**. Va avviata con la demo già accesa.

```bash
node demo-sincronia/server.mjs
```

Poi apri http://127.0.0.1:3022/. La macchina parla solo con questa porta. La sincronia inoltra ogni ticket all'applicazione e, se la tipologia è critica, lo segnala sul tablet del tecnico. In automatico il trasferimento parte da solo. In manuale parte da **Conferma**. Sara pubblica il report per operatore e, se tablet e applicazione non coincidono, ritrasferisce lei: il suo stato fa fede. Un cambio tecnico toglie l'intervento dal primo tablet e lo mette sul secondo. Se l'intervento era già in corso, torna in pending con la causale e rientra sull'applicazione. Le parti nuove sono segnate con **Nuovo**.

## iPad, manutenzione predittiva

Con demo, sincronia e macchina accese, apri l'app in landscape ed entra come `marco.bianchi`. In **Sincronizzazione** premi **Sincronizza con la demo**.

Sulla macchina premi **Rischio di blocco**, poi sincronizza di nuovo l'iPad. Compare l'avviso **Ticket in gestione urgente**: il ticket è in cima, con il contrassegno **Nuovo**. Nel dettaglio ci sono il manuale e il workflow. **Ho fatto questo passo** avanza un passo alla volta. **Chiuso** e **Risolto** restano bloccati fino all'ultimo passo. Poi chiudi il ticket e sincronizza: la chiusura va alla sincronia sulla porta 3022 e sull'applicazione compare **sincronizzato correttamente**.

**Metti in pending** sceglie la tipologia, sul ticket o sull'intervento, e la manda alla sincronia con la causale. Un intervento riassegnato sulla demo sparisce dall'iPad del tecnico precedente alla sincronizzazione successiva e compare su quello del nuovo tecnico.

## Dati sul dispositivo

L'archivio è un JSON nella cartella Application Support dell'app. Chiudere l'app e riaprirla, anche senza rete, conserva interventi, note, ticket e risposte.

import Foundation
import Observation

enum DatiDimostrativi {
    static let password = "assistenza"
    static let marco = "marco.bianchi"
    static let lucia = "lucia.ferrari"
}

enum EsitoTecnico {
    case nuovo
    case aggiornato
    case invariato
    case passwordMancante
    case logonNonValido
}

/// Archivio JSON in Application Support. Lettura e scrittura solo su questo iPad.
@Observable
final class ArchivioLocale {
    private let percorso: URL
    private(set) var tecnici: [Tecnico] = []
    private(set) var clienti: [Cliente] = []
    private(set) var interventi: [Intervento] = []
    private(set) var ticket: [Ticket] = []
    private(set) var sessioneTecnicoID: String?
    var erroreSalvataggio: String?
    var ultimoEsito: EsitoImportazione?
    var ultimoErroreImportazione: String?
    var ultimoNomeFile: String?

    init(percorso: URL? = nil) {
        self.percorso = percorso ?? Self.percorsoPredefinito()
        carica()
    }

    func tecnico(id: String) -> Tecnico? {
        tecnici.first { $0.id == id }
    }

    func tecnico(logon: String) -> Tecnico? {
        let chiave = Self.normalizzaLogon(logon)
        return tecnici.first { $0.logon == chiave }
    }

    func clientiAssegnati(a tecnicoID: String) -> [Cliente] {
        let daInterventi = Set(interventi.filter { $0.tecnicoID == tecnicoID }.map(\.clienteID))
        let daTicket = Set(ticket.filter { $0.tecnicoID == tecnicoID }.map(\.clienteID))
        return clienti
            .filter { $0.tecnicoID == tecnicoID || daInterventi.contains($0.id) || daTicket.contains($0.id) }
            .sorted { $0.nome.localizedStandardCompare($1.nome) == .orderedAscending }
    }

    func interventiAssegnati(a tecnicoID: String) -> [Intervento] {
        interventi.filter { $0.tecnicoID == tecnicoID }
    }

    func ticketAssegnati(a tecnicoID: String) -> [Ticket] {
        ticket.filter { $0.tecnicoID == tecnicoID }
    }

    func clienteRegistrato(id: String) -> Cliente? {
        clienti.first { $0.id == id }
    }

    func interventoRegistrato(id: String) -> Intervento? {
        interventi.first { $0.id == id }
    }

    func ticketRegistrato(id: String) -> Ticket? {
        ticket.first { $0.id == id }
    }

    func cliente(id: String, visibileA tecnicoID: String) -> Cliente? {
        guard let cliente = clienteRegistrato(id: id) else { return nil }
        if cliente.tecnicoID == tecnicoID { return cliente }
        if interventi.contains(where: { $0.clienteID == id && $0.tecnicoID == tecnicoID }) { return cliente }
        if ticket.contains(where: { $0.clienteID == id && $0.tecnicoID == tecnicoID }) { return cliente }
        return nil
    }

    func intervento(id: String, visibileA tecnicoID: String) -> Intervento? {
        interventi.first { $0.id == id && $0.tecnicoID == tecnicoID }
    }

    func ticket(id: String, visibileA tecnicoID: String) -> Ticket? {
        ticket.first { $0.id == id && $0.tecnicoID == tecnicoID }
    }

    @discardableResult
    func registraTecnico(logon: String, nome: String, password: String?) -> EsitoTecnico {
        let chiave = Self.normalizzaLogon(logon)
        guard !chiave.isEmpty, chiave.count <= 80, !chiave.contains(where: { $0.isNewline }) else {
            return .logonNonValido
        }
        let nomePulito = nome.trimmingCharacters(in: .whitespacesAndNewlines)
        if let index = tecnici.firstIndex(where: { $0.logon == chiave }) {
            guard !nomePulito.isEmpty, tecnici[index].nome != nomePulito else { return .invariato }
            tecnici[index].nome = nomePulito
            return .aggiornato
        }
        guard let password, !password.isEmpty, password.count <= 200 else { return .passwordMancante }
        tecnici.append(
            Tecnico(
                id: Tecnico.id(perLogon: chiave),
                logon: chiave,
                nome: nomePulito.isEmpty ? chiave : nomePulito,
                passwordHash: Impronta.di(password)
            )
        )
        return .nuovo
    }

    @discardableResult
    func upsertCliente(_ cliente: Cliente) -> Bool {
        if let index = clienti.firstIndex(where: { $0.id == cliente.id }) {
            clienti[index] = cliente
            return false
        }
        clienti.append(cliente)
        return true
    }

    @discardableResult
    func upsertIntervento(_ intervento: Intervento) -> Bool {
        if let index = interventi.firstIndex(where: { $0.id == intervento.id }) {
            interventi[index] = intervento
            return false
        }
        interventi.append(intervento)
        return true
    }

    @discardableResult
    func upsertTicket(_ ticket: Ticket) -> Bool {
        if let index = self.ticket.firstIndex(where: { $0.id == ticket.id }) {
            self.ticket[index] = ticket
            return false
        }
        self.ticket.append(ticket)
        return true
    }

    func salvaCliente(_ cliente: Cliente, tecnicoID: String) {
        if let esistente = clienteRegistrato(id: cliente.id) {
            guard self.cliente(id: cliente.id, visibileA: tecnicoID) != nil else { return }
            guard cliente.tecnicoID == esistente.tecnicoID else { return }
        } else {
            guard cliente.tecnicoID == tecnicoID else { return }
        }
        upsertCliente(cliente)
        salva()
    }

    func salvaIntervento(_ intervento: Intervento, tecnicoID: String) {
        if let esistente = interventoRegistrato(id: intervento.id), esistente.tecnicoID != tecnicoID {
            return
        }
        guard intervento.tecnicoID == tecnicoID else { return }
        upsertIntervento(intervento)
        salva()
    }

    func salvaTicket(_ ticket: Ticket, tecnicoID: String) {
        if let esistente = ticketRegistrato(id: ticket.id), esistente.tecnicoID != tecnicoID {
            return
        }
        guard ticket.tecnicoID == tecnicoID else { return }
        upsertTicket(ticket)
        salva()
    }

    func aggiornaStatoIntervento(id: String, tecnicoID: String, stato: StatoIntervento) {
        guard let index = interventi.firstIndex(where: { $0.id == id && $0.tecnicoID == tecnicoID }) else { return }
        interventi[index].stato = stato
        interventi[index].aggiornato = .now
        salva()
    }

    func aggiornaStatoTicket(id: String, tecnicoID: String, stato: StatoTicket) {
        guard let index = ticket.firstIndex(where: { $0.id == id && $0.tecnicoID == tecnicoID }) else { return }
        ticket[index].stato = stato
        ticket[index].aggiornato = .now
        salva()
    }

    func aggiungiNota(interventoID: String, tecnicoID: String, testo: String, autore: String) {
        let pulito = testo.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !pulito.isEmpty,
              let index = interventi.firstIndex(where: { $0.id == interventoID && $0.tecnicoID == tecnicoID }) else { return }
        interventi[index].note.append(
            Annotazione(id: UUID().uuidString, testo: pulito, autore: autore, data: .now)
        )
        interventi[index].note.sort { $0.data < $1.data }
        interventi[index].aggiornato = .now
        salva()
    }

    func aggiungiRisposta(ticketID: String, tecnicoID: String, testo: String, autore: String) {
        let pulito = testo.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !pulito.isEmpty,
              let index = ticket.firstIndex(where: { $0.id == ticketID && $0.tecnicoID == tecnicoID }) else { return }
        ticket[index].risposte.append(
            Annotazione(id: UUID().uuidString, testo: pulito, autore: autore, data: .now)
        )
        ticket[index].risposte.sort { $0.data < $1.data }
        ticket[index].aggiornato = .now
        salva()
    }

    func impostaSessione(_ id: String?) {
        sessioneTecnicoID = id
        salva()
    }

    @discardableResult
    func importa(dati: Data, nomeFile: String? = nil) -> Result<EsitoImportazione, Error> {
        do {
            let esito = try ImportatoreJSON.applica(dati: dati, a: self)
            ultimoEsito = esito
            ultimoErroreImportazione = nil
            ultimoNomeFile = nomeFile
            return .success(esito)
        } catch let errore as ErroreImportazione {
            ultimoEsito = nil
            ultimoErroreImportazione = errore.messaggio
            ultimoNomeFile = nomeFile
            return .failure(errore)
        } catch {
            let messaggio = "Impossibile leggere il file."
            ultimoEsito = nil
            ultimoErroreImportazione = messaggio
            ultimoNomeFile = nomeFile
            return .failure(ErroreImportazione(messaggio: messaggio))
        }
    }

    @discardableResult
    func importaFile(da url: URL) -> Result<EsitoImportazione, Error> {
        let estensione = url.pathExtension.lowercased()
        if !estensione.isEmpty && estensione != "json" {
            let errore = ErroreImportazione(messaggio: "Il file deve avere estensione .json.")
            ultimoEsito = nil
            ultimoErroreImportazione = errore.messaggio
            ultimoNomeFile = url.lastPathComponent
            return .failure(errore)
        }
        let accesso = url.startAccessingSecurityScopedResource()
        defer {
            if accesso {
                url.stopAccessingSecurityScopedResource()
            }
        }
        do {
            let dati = try Data(contentsOf: url)
            return importa(dati: dati, nomeFile: url.lastPathComponent)
        } catch {
            let errore = ErroreImportazione(messaggio: "Impossibile leggere il file.")
            ultimoEsito = nil
            ultimoErroreImportazione = errore.messaggio
            ultimoNomeFile = url.lastPathComponent
            return .failure(errore)
        }
    }

    func salva() {
        let file = ArchivioFile(
            versione: 1,
            tecnici: tecnici,
            clienti: clienti,
            interventi: interventi,
            ticket: ticket,
            sessioneTecnicoID: sessioneTecnicoID
        )
        do {
            let cartella = percorso.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: cartella, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .custom { data, encoder in
                var contenitore = encoder.singleValueContainer()
                try contenitore.encode(Self.iso.string(from: data))
            }
            let dati = try encoder.encode(file)
            try dati.write(to: percorso, options: .atomic)
            if erroreSalvataggio != nil {
                erroreSalvataggio = nil
            }
        } catch {
            let messaggio = "Impossibile salvare i dati su questo iPad."
            if erroreSalvataggio != messaggio {
                erroreSalvataggio = messaggio
            }
        }
    }

    private func carica() {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: percorso.path) else {
            applica(Self.dimostrativo())
            salva()
            return
        }
        do {
            let dati = try Data(contentsOf: percorso)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .custom { decoder in
                let contenitore = try decoder.singleValueContainer()
                let testo = try contenitore.decode(String.self)
                guard let data = Self.data(da: testo) else {
                    throw DecodingError.dataCorruptedError(
                        in: contenitore,
                        debugDescription: "Data non valida"
                    )
                }
                return data
            }
            applica(try decoder.decode(ArchivioFile.self, from: dati))
        } catch {
            let backup = percorso.deletingLastPathComponent().appendingPathComponent("archivio-illeggibile.json")
            try? fileManager.removeItem(at: backup)
            try? fileManager.copyItem(at: percorso, to: backup)
            erroreSalvataggio = "L'archivio locale era illeggibile. È stata tenuta una copia e sono stati ripristinati i dati dimostrativi."
            applica(Self.dimostrativo())
            salva()
        }
    }

    private func applica(_ file: ArchivioFile) {
        tecnici = file.tecnici
        clienti = file.clienti
        interventi = file.interventi
        ticket = file.ticket
        sessioneTecnicoID = file.sessioneTecnicoID
    }

    private static func percorsoPredefinito() -> URL {
        let fileManager = FileManager.default
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        let cartella = base.appendingPathComponent("Assistenza", isDirectory: true)
        try? fileManager.createDirectory(at: cartella, withIntermediateDirectories: true)
        return cartella.appendingPathComponent("archivio.json")
    }

    private static func normalizzaLogon(_ logon: String) -> String {
        logon.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let isoConFrazioni: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func data(da testo: String) -> Date? {
        if let data = isoConFrazioni.date(from: testo) { return data }
        if let data = iso.date(from: testo) { return data }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        for formato in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd"] {
            formatter.dateFormat = formato
            if let data = formatter.date(from: testo) { return data }
        }
        return nil
    }

    private static func dimostrativo() -> ArchivioFile {
        let passwordHash = Impronta.di(DatiDimostrativi.password)
        let marcoID = Tecnico.id(perLogon: DatiDimostrativi.marco)
        let luciaID = Tecnico.id(perLogon: DatiDimostrativi.lucia)
        let marco = Tecnico(id: marcoID, logon: DatiDimostrativi.marco, nome: "Marco Bianchi", passwordHash: passwordHash)
        let lucia = Tecnico(id: luciaID, logon: DatiDimostrativi.lucia, nome: "Lucia Ferrari", passwordHash: passwordHash)

        let studio = Cliente(
            id: "cli-studio-conti",
            nome: "Studio Legale Conti",
            referente: "Anna Conti",
            telefono: "+39 06 555 0101",
            email: "anna.conti@studio-conti.example",
            indirizzo: "Via del Corso 18, Roma",
            note: "Citofono 4, terzo piano. Chiedere di Anna in reception.",
            tecnicoID: marcoID
        )
        let farmacia = Cliente(
            id: "cli-farmacia-san-marco",
            nome: "Farmacia San Marco",
            referente: "Luca Greco",
            telefono: "+39 06 555 0102",
            email: "luca.greco@farmacia-san-marco.example",
            indirizzo: "Piazza Navona 4, Roma",
            note: "Entrata su Piazza Navona, banco ricette a sinistra.",
            tecnicoID: marcoID
        )
        let bar = Cliente(
            id: "cli-bar-centrale",
            nome: "Bar Centrale",
            referente: "Paolo Neri",
            telefono: "+39 02 555 0103",
            email: "paolo.neri@bar-centrale.example",
            indirizzo: "Via Torino 9, Milano",
            note: "Serranda laterale in via Torino se il bar è chiuso.",
            tecnicoID: luciaID
        )
        let scuola = Cliente(
            id: "cli-scuola-manzoni",
            nome: "Scuola Manzoni",
            referente: "Elena Riva",
            telefono: "+39 02 555 0104",
            email: "elena.riva@scuola-manzoni.example",
            indirizzo: "Viale Monza 40, Milano",
            note: "Presentarsi in portineria con un documento.",
            tecnicoID: luciaID
        )

        let router = Intervento(
            id: "int-marco-router",
            titolo: "Sostituzione router in sala riunioni",
            descrizione: "Il router si spegne dopo qualche ora e la rete dello studio cade. Portare un apparato di ricambio e verificare l'alimentatore.",
            clienteID: studio.id,
            tecnicoID: marcoID,
            stato: .inCorso,
            priorita: .alta,
            appuntamento: data(giorno: 0, ora: 9, minuto: 30),
            indirizzo: studio.indirizzo,
            note: [
                Annotazione(
                    id: "nota-marco-router-1",
                    testo: "Il cliente segnala che il router si spegne da solo. Portare un ricambio.",
                    autore: "Coordinamento",
                    data: data(giorno: -1, ora: 18, minuto: 10)
                ),
                Annotazione(
                    id: "nota-marco-router-2",
                    testo: "Sono in sede. L'alimentatore scotta: lo sostituisco.",
                    autore: "Marco Bianchi",
                    data: data(giorno: 0, ora: 9, minuto: 40)
                )
            ],
            aggiornato: data(giorno: 0, ora: 9, minuto: 40)
        )
        let stampante = Intervento(
            id: "int-marco-stampante",
            titolo: "Configurazione stampante etichette",
            descrizione: "Nuova stampante per le etichette dei preparati. Va collegata al gestionale della farmacia.",
            clienteID: farmacia.id,
            tecnicoID: marcoID,
            stato: .programmato,
            priorita: .media,
            appuntamento: data(giorno: 0, ora: 15, minuto: 0),
            indirizzo: farmacia.indirizzo,
            note: [],
            aggiornato: data(giorno: 0, ora: 8, minuto: 0)
        )
        let gestionale = Intervento(
            id: "int-marco-gestionale",
            titolo: "Aggiornamento gestionale",
            descrizione: "Installare l'aggiornamento del gestionale e verificare l'accesso dei collaboratori.",
            clienteID: studio.id,
            tecnicoID: marcoID,
            stato: .completato,
            priorita: .bassa,
            appuntamento: data(giorno: -1, ora: 11, minuto: 0),
            indirizzo: studio.indirizzo,
            note: [
                Annotazione(
                    id: "nota-marco-gestionale-1",
                    testo: "Aggiornamento installato. Anna ha verificato l'accesso.",
                    autore: "Marco Bianchi",
                    data: data(giorno: -1, ora: 12, minuto: 30)
                )
            ],
            aggiornato: data(giorno: -1, ora: 12, minuto: 30)
        )
        let cassa = Intervento(
            id: "int-lucia-cassa",
            titolo: "Cassa non stampa gli scontrini",
            descrizione: "La stampante fiscale non emette gli scontrini. Il bar è aperto e la coda cresce.",
            clienteID: bar.id,
            tecnicoID: luciaID,
            stato: .inAttesa,
            priorita: .urgente,
            appuntamento: data(giorno: 0, ora: 10, minuto: 15),
            indirizzo: bar.indirizzo,
            note: [
                Annotazione(
                    id: "nota-lucia-cassa-1",
                    testo: "In attesa del codice errore che Paolo legge sul display.",
                    autore: "Lucia Ferrari",
                    data: data(giorno: 0, ora: 10, minuto: 20)
                )
            ],
            aggiornato: data(giorno: 0, ora: 10, minuto: 20)
        )
        let aula = Intervento(
            id: "int-lucia-aula",
            titolo: "Cablaggio aula informatica",
            descrizione: "Predisporre i punti rete dei dodici banchi e provare l'accesso al registro elettronico.",
            clienteID: scuola.id,
            tecnicoID: luciaID,
            stato: .programmato,
            priorita: .alta,
            appuntamento: data(giorno: 1, ora: 8, minuto: 30),
            indirizzo: scuola.indirizzo,
            note: [],
            aggiornato: data(giorno: 0, ora: 8, minuto: 0)
        )

        let posta = Ticket(
            id: "tck-marco-posta",
            titolo: "Posta che richiede la password",
            descrizione: "Da stamattina Outlook chiede la password in continuazione a tutti i posti di lavoro.",
            clienteID: studio.id,
            tecnicoID: marcoID,
            stato: .aperto,
            priorita: .alta,
            risposte: [
                Annotazione(
                    id: "ris-marco-posta-1",
                    testo: "Succede su tre computer, non solo sul mio.",
                    autore: "Anna Conti",
                    data: data(giorno: 0, ora: 8, minuto: 15)
                ),
                Annotazione(
                    id: "ris-marco-posta-2",
                    testo: "Controllo il profilo e la scadenza della password di rete.",
                    autore: "Marco Bianchi",
                    data: data(giorno: 0, ora: 8, minuto: 40)
                )
            ],
            aperto: data(giorno: 0, ora: 8, minuto: 5),
            aggiornato: data(giorno: 0, ora: 8, minuto: 40)
        )
        let cassetto = Ticket(
            id: "tck-marco-cassetto",
            titolo: "Cassetto contanti non si apre",
            descrizione: "Il cassetto collegato alla cassa non risponde al comando di apertura.",
            clienteID: farmacia.id,
            tecnicoID: marcoID,
            stato: .inLavorazione,
            priorita: .media,
            risposte: [
                Annotazione(
                    id: "ris-marco-cassetto-1",
                    testo: "Si è bloccato dopo la chiusura di ieri sera.",
                    autore: "Luca Greco",
                    data: data(giorno: 0, ora: 9, minuto: 5)
                )
            ],
            aperto: data(giorno: 0, ora: 9, minuto: 0),
            aggiornato: data(giorno: 0, ora: 9, minuto: 5)
        )
        let wifi = Ticket(
            id: "tck-lucia-wifi",
            titolo: "Wi-Fi ospiti non disponibile",
            descrizione: "La rete ospiti del bar non compare tra le reti disponibili.",
            clienteID: bar.id,
            tecnicoID: luciaID,
            stato: .inAttesaCliente,
            priorita: .media,
            risposte: [
                Annotazione(
                    id: "ris-lucia-wifi-1",
                    testo: "I clienti del bar non vedono la rete Ospiti da ieri pomeriggio.",
                    autore: "Paolo Neri",
                    data: data(giorno: -1, ora: 16, minuto: 45)
                )
            ],
            aperto: data(giorno: -1, ora: 16, minuto: 40),
            aggiornato: data(giorno: -1, ora: 16, minuto: 45)
        )

        return ArchivioFile(
            versione: 1,
            tecnici: [marco, lucia],
            clienti: [studio, farmacia, bar, scuola],
            interventi: [router, stampante, gestionale, cassa, aula],
            ticket: [posta, cassetto, wifi],
            sessioneTecnicoID: nil
        )
    }

    private static func data(giorno: Int, ora: Int, minuto: Int) -> Date {
        let calendario = Calendar.current
        let inizio = calendario.startOfDay(for: .now)
        let giornoBase = calendario.date(byAdding: .day, value: giorno, to: inizio) ?? inizio
        return calendario.date(bySettingHour: ora, minute: minuto, second: 0, of: giornoBase) ?? giornoBase
    }
}

private struct ArchivioFile: Codable {
    var versione: Int
    var tecnici: [Tecnico]
    var clienti: [Cliente]
    var interventi: [Intervento]
    var ticket: [Ticket]
    var sessioneTecnicoID: String?

    init(versione: Int, tecnici: [Tecnico], clienti: [Cliente], interventi: [Intervento], ticket: [Ticket], sessioneTecnicoID: String?) {
        self.versione = versione
        self.tecnici = tecnici
        self.clienti = clienti
        self.interventi = interventi
        self.ticket = ticket
        self.sessioneTecnicoID = sessioneTecnicoID
    }
}

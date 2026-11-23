import CoreFoundation
import Foundation

struct ErroreImportazione: Error {
    var messaggio: String
}

struct EsitoImportazione: Equatable {
    var tecniciNuovi = 0
    var tecniciAggiornati = 0
    var clientiNuovi = 0
    var clientiAggiornati = 0
    var interventiNuovi = 0
    var interventiAggiornati = 0
    var ticketNuovi = 0
    var ticketAggiornati = 0
    var logon: [String] = []
    var avvisi: [String] = []

    func riepilogo(logonCorrente: String?) -> String {
        var pezzi: [String] = []
        func aggiungi(_ numero: Int, uno: String, molti: String) {
            if numero == 1 {
                pezzi.append("1 \(uno)")
            } else if numero > 1 {
                pezzi.append("\(numero) \(molti)")
            }
        }
        aggiungi(tecniciNuovi, uno: "tecnico nuovo", molti: "tecnici nuovi")
        aggiungi(tecniciAggiornati, uno: "tecnico aggiornato", molti: "tecnici aggiornati")
        aggiungi(clientiNuovi, uno: "cliente nuovo", molti: "clienti nuovi")
        aggiungi(clientiAggiornati, uno: "cliente aggiornato", molti: "clienti aggiornati")
        aggiungi(interventiNuovi, uno: "intervento nuovo", molti: "interventi nuovi")
        aggiungi(interventiAggiornati, uno: "intervento aggiornato", molti: "interventi aggiornati")
        aggiungi(ticketNuovi, uno: "ticket nuovo", molti: "ticket nuovi")
        aggiungi(ticketAggiornati, uno: "ticket aggiornato", molti: "ticket aggiornati")

        var testo = pezzi.isEmpty
            ? (avvisi.isEmpty
                ? "Nessun dato nuovo: queste assegnazioni erano già sull'iPad."
                : "Nessun dato importato.")
            : "Salvato sull'iPad: \(pezzi.joined(separator: ", "))."

        if !logon.isEmpty {
            testo += " Assegnazioni per: \(logon.joined(separator: ", "))."
            if let logonCorrente, logon.contains(logonCorrente) {
                testo += " Le tue sono già visibili nell'elenco."
            }
            if logonCorrente == nil {
                testo += " Entra con il logon indicato nel file."
            } else if logon.contains(where: { $0 != logonCorrente }) {
                testo += " Per vedere quelle di un altro tecnico, esci e entra con il suo logon."
            }
        }
        return testo
    }
}

private struct NotaImportata {
    var annotazione: Annotazione
    var sovrascrive: Bool
}

private struct ClienteImportato {
    var id: String
    var mutato: Bool
}

enum ImportatoreJSON {
    private static let limiteRighe = 2000

    static func applica(dati: Data, a archivio: ArchivioLocale) throws -> EsitoImportazione {
        guard !dati.isEmpty else {
            throw ErroreImportazione(messaggio: "Il file è vuoto.")
        }
        let radice: Any
        do {
            radice = try JSONSerialization.jsonObject(with: dati)
        } catch {
            throw ErroreImportazione(messaggio: "Il file non è un JSON valido.")
        }

        let oggetto: [String: Any]
        if let dizionario = radice as? [String: Any] {
            oggetto = dizionario
        } else if let elenco = radice as? [Any] {
            oggetto = ["interventi": elenco]
        } else {
            throw ErroreImportazione(messaggio: "Il JSON deve essere un oggetto o un elenco di interventi.")
        }

        let chiaviNote = ["tecnici", "clienti", "utenti", "interventi", "ticket"]
        guard chiaviNote.contains(where: { oggetto[$0] != nil }) else {
            throw ErroreImportazione(messaggio: "Il file non contiene tecnici, clienti, interventi o ticket.")
        }

        var esito = EsitoImportazione()
        let tecnici = leggiElenco(oggetto, chiavi: ["tecnici"], esito: &esito)
        let clienti = leggiElenco(oggetto, chiavi: ["clienti", "utenti"], esito: &esito)
        let interventi = leggiElenco(oggetto, chiavi: ["interventi"], esito: &esito)
        let ticket = leggiElenco(oggetto, chiavi: ["ticket"], esito: &esito)

        if tecnici.isEmpty && clienti.isEmpty && interventi.isEmpty && ticket.isEmpty && esito.avvisi.isEmpty {
            throw ErroreImportazione(messaggio: "Gli elenchi nel file sono vuoti.")
        }

        var mutato = false
        mutato = importaTecnici(tecnici, a: archivio, esito: &esito) || mutato
        mutato = importaClienti(clienti, etichetta: "Cliente", logonPredefinito: nil, a: archivio, esito: &esito) || mutato
        mutato = importaInterventi(interventi, a: archivio, esito: &esito) || mutato
        mutato = importaTicket(ticket, a: archivio, esito: &esito) || mutato

        if mutato {
            archivio.salva()
        }
        if esito.avvisi.count > 40 {
            let extra = esito.avvisi.count - 40
            esito.avvisi = Array(esito.avvisi.prefix(40))
            esito.avvisi.append("Altri \(extra) avvisi non mostrati.")
        }
        esito.logon = Array(Set(esito.logon)).sorted()
        return esito
    }

    private static func importaTecnici(_ elenco: [Any], a archivio: ArchivioLocale, esito: inout EsitoImportazione) -> Bool {
        var mutato = false
        for (indice, elemento) in elenco.prefix(limiteRighe).enumerated() {
            guard let dizionario = elemento as? [String: Any] else {
                esito.avvisi.append("Tecnico \(indice + 1): la riga non è un oggetto.")
                continue
            }
            guard let logon = testo(dizionario, "logon", "nomeUtente") else {
                esito.avvisi.append("Tecnico \(indice + 1): manca il logon.")
                continue
            }
            let nome = testo(dizionario, "nome", "nomeCompleto") ?? ""
            let password = testo(dizionario, "password")
            let chiave = logon.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            switch archivio.registraTecnico(logon: logon, nome: nome, password: password) {
            case .nuovo:
                esito.tecniciNuovi += 1
                esito.logon.append(chiave)
                mutato = true
            case .aggiornato:
                esito.tecniciAggiornati += 1
                esito.logon.append(chiave)
                mutato = true
            case .invariato:
                break
            case .passwordMancante:
                esito.avvisi.append("Tecnico \(chiave): per un logon nuovo serve la password.")
            case .logonNonValido:
                esito.avvisi.append("Tecnico \(indice + 1): logon non valido.")
            }
        }
        if elenco.count > limiteRighe {
            esito.avvisi.append("Sono stati letti solo i primi \(limiteRighe) tecnici.")
        }
        return mutato
    }

    @discardableResult
    private static func importaClienti(
        _ elenco: [Any],
        etichetta: String,
        logonPredefinito: String?,
        a archivio: ArchivioLocale,
        esito: inout EsitoImportazione
    ) -> Bool {
        var mutato = false
        for (indice, elemento) in elenco.prefix(limiteRighe).enumerated() {
            guard let dizionario = elemento as? [String: Any] else {
                esito.avvisi.append("\(etichetta) \(indice + 1): la riga non è un oggetto.")
                continue
            }
            if let importato = importaCliente(
                dizionario,
                etichetta: "\(etichetta) \(indice + 1)",
                logonPredefinito: logonPredefinito,
                a: archivio,
                esito: &esito
            ), importato.mutato {
                mutato = true
            }
        }
        if elenco.count > limiteRighe {
            esito.avvisi.append("Sono stati letti solo i primi \(limiteRighe) clienti.")
        }
        return mutato
    }

    @discardableResult
    private static func importaCliente(
        _ dizionario: [String: Any],
        etichetta: String,
        logonPredefinito: String?,
        a archivio: ArchivioLocale,
        esito: inout EsitoImportazione
    ) -> ClienteImportato? {
        guard let nome = testo(dizionario, "nome", "ragioneSociale") else {
            esito.avvisi.append("\(etichetta): manca il nome.")
            return nil
        }
        let logon = testo(dizionario, "logonTecnico", "logon_tecnico", "tecnico") ?? logonPredefinito
        guard let logon, let tecnico = archivio.tecnico(logon: logon) else {
            esito.avvisi.append("\(etichetta) (\(nome)): logon tecnico sconosciuto o mancante.")
            return nil
        }
        let id = testo(dizionario, "id") ?? "cli-\(Impronta.breve(nome.lowercased() + "|" + tecnico.id))"
        let precedente = archivio.clienteRegistrato(id: id)
        var cliente = precedente ?? Cliente(
            id: id,
            nome: nome,
            referente: "",
            telefono: "",
            email: "",
            indirizzo: "",
            note: "",
            tecnicoID: tecnico.id
        )
        cliente.nome = nome
        if let referente = testo(dizionario, "referente", "utente", "utenteRiferimento") {
            cliente.referente = referente
        }
        if let telefono = testo(dizionario, "telefono", "tel") {
            cliente.telefono = telefono
        }
        if let email = testo(dizionario, "email", "mail") {
            cliente.email = email
        }
        if let indirizzo = testo(dizionario, "indirizzo") {
            cliente.indirizzo = indirizzo
        }
        if let note = testo(dizionario, "note") {
            cliente.note = note
        }
        if testo(dizionario, "logonTecnico", "logon_tecnico", "tecnico") != nil || logonPredefinito != nil {
            cliente.tecnicoID = tecnico.id
        }
        guard precedente != cliente else {
            return ClienteImportato(id: id, mutato: false)
        }
        let nuovo = archivio.upsertCliente(cliente)
        if nuovo {
            esito.clientiNuovi += 1
        } else {
            esito.clientiAggiornati += 1
        }
        esito.logon.append(tecnico.logon)
        return ClienteImportato(id: id, mutato: true)
    }

    private static func importaInterventi(_ elenco: [Any], a archivio: ArchivioLocale, esito: inout EsitoImportazione) -> Bool {
        var mutato = false
        for (indice, elemento) in elenco.prefix(limiteRighe).enumerated() {
            guard let dizionario = elemento as? [String: Any] else {
                esito.avvisi.append("Intervento \(indice + 1): la riga non è un oggetto.")
                continue
            }
            if importaIntervento(dizionario, indice: indice + 1, a: archivio, esito: &esito) {
                mutato = true
            }
        }
        if elenco.count > limiteRighe {
            esito.avvisi.append("Sono stati letti solo i primi \(limiteRighe) interventi.")
        }
        return mutato
    }

    private static func importaIntervento(
        _ dizionario: [String: Any],
        indice: Int,
        a archivio: ArchivioLocale,
        esito: inout EsitoImportazione
    ) -> Bool {
        let idEsplicito = testo(dizionario, "id", "codice")
        let esistenteIniziale = idEsplicito.flatMap { archivio.interventoRegistrato(id: $0) }
        let logonEsplicito = testo(dizionario, "logonTecnico", "logon_tecnico", "tecnico")
        let logon: String?
        if let logonEsplicito {
            logon = logonEsplicito
        } else if let esistenteIniziale, let tecnico = archivio.tecnico(id: esistenteIniziale.tecnicoID) {
            logon = tecnico.logon
        } else {
            logon = nil
        }
        guard let logon, let tecnico = archivio.tecnico(logon: logon) else {
            esito.avvisi.append("Intervento \(indice): logon tecnico sconosciuto o mancante.")
            return false
        }

        var mutato = false
        var clienteID = testo(dizionario, "clienteId", "clienteID", "cliente_id", "idCliente")
        if let grezzoCliente = valore(dizionario, chiavi: ["cliente"]), !(grezzoCliente is NSNull) {
            let nidificato: [String: Any]?
            if let dizionarioCliente = grezzoCliente as? [String: Any] {
                nidificato = dizionarioCliente
            } else if let nome = grezzoCliente as? String {
                var creato: [String: Any] = ["nome": nome]
                if let clienteID {
                    creato["id"] = clienteID
                }
                nidificato = creato
            } else {
                nidificato = nil
                if clienteID == nil {
                    esito.avvisi.append("Intervento \(indice): il cliente non è riconosciuto.")
                }
            }
            if let nidificato,
               let importato = importaCliente(
                nidificato,
                etichetta: "Cliente dell'intervento \(indice)",
                logonPredefinito: logon,
                a: archivio,
                esito: &esito
               ) {
                clienteID = importato.id
                mutato = importato.mutato
            }
        }
        guard let clienteID else {
            esito.avvisi.append("Intervento \(indice): manca il cliente.")
            return mutato
        }
        guard archivio.clienteRegistrato(id: clienteID) != nil else {
            esito.avvisi.append("Intervento \(indice): il cliente \(clienteID) non è nell'archivio.")
            return mutato
        }

        let appuntamento: Date
        if let testoData = testo(dizionario, "appuntamento", "data", "quando") {
            guard let data = ArchivioLocale.data(da: testoData) else {
                esito.avvisi.append("Intervento \(indice): data non valida.")
                return mutato
            }
            appuntamento = data
        } else if let esistenteIniziale {
            appuntamento = esistenteIniziale.appuntamento
        } else {
            esito.avvisi.append("Intervento \(indice): manca l'appuntamento.")
            return mutato
        }

        let titolo = testo(dizionario, "titolo", "oggetto") ?? esistenteIniziale?.titolo
        guard let titolo else {
            esito.avvisi.append("Intervento \(indice): manca il titolo.")
            return mutato
        }

        let id = idEsplicito ?? "int-\(Impronta.breve([titolo, clienteID, tecnico.id, iso(appuntamento)].joined(separator: "|")))"
        let esistente = archivio.interventoRegistrato(id: id)

        var stato = esistente?.stato ?? .programmato
        if let testoStato = testo(dizionario, "stato") {
            if let riconosciuto = StatoIntervento(testo: testoStato) {
                stato = riconosciuto
            } else {
                esito.avvisi.append("Intervento \(indice): stato \"\(testoStato)\" non riconosciuto.")
            }
        }
        var priorita = esistente?.priorita ?? .media
        if let testoPriorita = testo(dizionario, "priorita", "priorità") {
            if let riconosciuta = Priorita(testo: testoPriorita) {
                priorita = riconosciuta
            } else {
                esito.avvisi.append("Intervento \(indice): priorità \"\(testoPriorita)\" non riconosciuta.")
            }
        }

        var note = esistente?.note ?? []
        if let grezze = valore(dizionario, chiavi: ["note"]) as? [Any] {
            note = unisci(note, annotazioni(da: grezze, contesto: id, etichetta: "Intervento \(indice)", esito: &esito))
        }

        let record = Intervento(
            id: id,
            titolo: titolo,
            descrizione: testo(dizionario, "descrizione", "dettaglio") ?? esistente?.descrizione ?? "",
            clienteID: clienteID,
            tecnicoID: tecnico.id,
            stato: stato,
            priorita: priorita,
            appuntamento: appuntamento,
            indirizzo: testo(dizionario, "indirizzo")
                ?? esistente?.indirizzo
                ?? archivio.clienteRegistrato(id: clienteID)?.indirizzo
                ?? "",
            note: note,
            aggiornato: esistente?.aggiornato ?? .now
        )
        if let esistente, record == esistente {
            return mutato
        }
        var daSalvare = record
        daSalvare.aggiornato = .now
        let nuovo = archivio.upsertIntervento(daSalvare)
        if nuovo {
            esito.interventiNuovi += 1
        } else {
            esito.interventiAggiornati += 1
        }
        esito.logon.append(tecnico.logon)
        return true
    }

    private static func importaTicket(_ elenco: [Any], a archivio: ArchivioLocale, esito: inout EsitoImportazione) -> Bool {
        var mutato = false
        for (indice, elemento) in elenco.prefix(limiteRighe).enumerated() {
            guard let dizionario = elemento as? [String: Any] else {
                esito.avvisi.append("Ticket \(indice + 1): la riga non è un oggetto.")
                continue
            }
            if importaTicket(dizionario, indice: indice + 1, a: archivio, esito: &esito) {
                mutato = true
            }
        }
        if elenco.count > limiteRighe {
            esito.avvisi.append("Sono stati letti solo i primi \(limiteRighe) ticket.")
        }
        return mutato
    }

    private static func importaTicket(
        _ dizionario: [String: Any],
        indice: Int,
        a archivio: ArchivioLocale,
        esito: inout EsitoImportazione
    ) -> Bool {
        let idEsplicito = testo(dizionario, "id")
        let esistenteIniziale = idEsplicito.flatMap { archivio.ticketRegistrato(id: $0) }
        let logonEsplicito = testo(dizionario, "logonTecnico", "logon_tecnico", "tecnico")
        let logon: String?
        if let logonEsplicito {
            logon = logonEsplicito
        } else if let esistenteIniziale, let tecnico = archivio.tecnico(id: esistenteIniziale.tecnicoID) {
            logon = tecnico.logon
        } else {
            logon = nil
        }
        guard let logon, let tecnico = archivio.tecnico(logon: logon) else {
            esito.avvisi.append("Ticket \(indice): logon tecnico sconosciuto o mancante.")
            return false
        }

        var mutato = false
        var clienteID = testo(dizionario, "clienteId", "clienteID", "cliente_id", "idCliente")
        if let nidificato = valore(dizionario, chiavi: ["cliente"]) as? [String: Any],
           let importato = importaCliente(
            nidificato,
            etichetta: "Cliente del ticket \(indice)",
            logonPredefinito: logon,
            a: archivio,
            esito: &esito
           ) {
            clienteID = importato.id
            mutato = importato.mutato
        }
        guard let clienteID else {
            esito.avvisi.append("Ticket \(indice): manca il cliente.")
            return mutato
        }
        guard archivio.clienteRegistrato(id: clienteID) != nil else {
            esito.avvisi.append("Ticket \(indice): il cliente \(clienteID) non è nell'archivio.")
            return mutato
        }

        let titolo = testo(dizionario, "titolo", "oggetto") ?? esistenteIniziale?.titolo
        guard let titolo else {
            esito.avvisi.append("Ticket \(indice): manca il titolo.")
            return mutato
        }

        let id = idEsplicito ?? "tck-\(Impronta.breve([titolo, clienteID, tecnico.id].joined(separator: "|")))"
        let esistente = archivio.ticketRegistrato(id: id)

        var stato = esistente?.stato ?? .aperto
        if let testoStato = testo(dizionario, "stato") {
            if let riconosciuto = StatoTicket(testo: testoStato) {
                stato = riconosciuto
            } else {
                esito.avvisi.append("Ticket \(indice): stato \"\(testoStato)\" non riconosciuto.")
            }
        }
        var priorita = esistente?.priorita ?? .media
        if let testoPriorita = testo(dizionario, "priorita", "priorità") {
            if let riconosciuta = Priorita(testo: testoPriorita) {
                priorita = riconosciuta
            } else {
                esito.avvisi.append("Ticket \(indice): priorità \"\(testoPriorita)\" non riconosciuta.")
            }
        }

        var aperto = esistente?.aperto ?? .now
        if let testoAperto = testo(dizionario, "aperto") {
            if let data = ArchivioLocale.data(da: testoAperto) {
                aperto = data
            } else {
                esito.avvisi.append("Ticket \(indice): data di apertura non valida.")
            }
        }

        var risposte = esistente?.risposte ?? []
        if let grezze = valore(dizionario, chiavi: ["risposte", "repliche"]) as? [Any] {
            risposte = unisci(risposte, annotazioni(da: grezze, contesto: id, etichetta: "Ticket \(indice)", esito: &esito))
        }

        let record = Ticket(
            id: id,
            titolo: titolo,
            descrizione: testo(dizionario, "descrizione", "dettaglio") ?? esistente?.descrizione ?? "",
            clienteID: clienteID,
            tecnicoID: tecnico.id,
            stato: stato,
            priorita: priorita,
            risposte: risposte,
            aperto: aperto,
            aggiornato: esistente?.aggiornato ?? .now
        )
        if archivio.unisciScheda(ticketID: id, scheda: schedaMacchina(dizionario)) {
            mutato = true
        }
        if let esistente, record == esistente {
            return mutato
        }
        var daSalvare = record
        daSalvare.aggiornato = .now
        let nuovo = archivio.upsertTicket(daSalvare)
        if nuovo {
            esito.ticketNuovi += 1
        } else {
            esito.ticketAggiornati += 1
        }
        esito.logon.append(tecnico.logon)
        return true
    }

    private static func annotazioni(
        da elenco: [Any],
        contesto: String,
        etichetta: String,
        esito: inout EsitoImportazione
    ) -> [NotaImportata] {
        var risultato: [NotaImportata] = []
        for (indice, elemento) in elenco.enumerated() {
            if let stringa = elemento as? String {
                let testoNota = stringa.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !testoNota.isEmpty else { continue }
                risultato.append(
                    NotaImportata(
                        annotazione: Annotazione(
                            id: "nota-\(Impronta.breve(contesto + "|" + testoNota))",
                            testo: testoNota,
                            autore: "Importazione",
                            data: .now
                        ),
                        sovrascrive: false
                    )
                )
                continue
            }
            guard let dizionario = elemento as? [String: Any] else {
                esito.avvisi.append("\(etichetta), nota \(indice + 1): formato non riconosciuto.")
                continue
            }
            guard let testoNota = testo(dizionario, "testo", "nota", "messaggio") else {
                esito.avvisi.append("\(etichetta), nota \(indice + 1): manca il testo.")
                continue
            }
            let dataTesto = testo(dizionario, "data", "quando")
            let data: Date
            if let dataTesto {
                if let riconosciuta = ArchivioLocale.data(da: dataTesto) {
                    data = riconosciuta
                } else {
                    esito.avvisi.append("\(etichetta), nota \(indice + 1): data non valida.")
                    data = .now
                }
            } else {
                data = .now
            }
            let idEsplicito = testo(dizionario, "id")
            let id = idEsplicito ?? "nota-\(Impronta.breve(contesto + "|" + testoNota + "|" + (dataTesto ?? "")))"
            risultato.append(
                NotaImportata(
                    annotazione: Annotazione(
                        id: id,
                        testo: testoNota,
                        autore: testo(dizionario, "autore", "da") ?? "Importazione",
                        data: data
                    ),
                    sovrascrive: idEsplicito != nil || dataTesto != nil
                )
            )
        }
        return risultato
    }

    private static func unisci(_ esistenti: [Annotazione], _ nuove: [NotaImportata]) -> [Annotazione] {
        var risultato = esistenti
        for nota in nuove {
            if let index = risultato.firstIndex(where: { $0.id == nota.annotazione.id }) {
                if nota.sovrascrive {
                    risultato[index] = nota.annotazione
                }
            } else {
                risultato.append(nota.annotazione)
            }
        }
        return risultato.sorted { $0.data < $1.data }
    }

    private static func leggiElenco(_ oggetto: [String: Any], chiavi: [String], esito: inout EsitoImportazione) -> [Any] {
        var risultato: [Any] = []
        for chiave in chiavi {
            guard let valore = oggetto[chiave] else { continue }
            if valore is NSNull { continue }
            guard let lista = valore as? [Any] else {
                esito.avvisi.append("\"\(chiave)\" deve essere un elenco.")
                continue
            }
            risultato.append(contentsOf: lista)
        }
        return risultato
    }

    private static func iso(_ data: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: data)
    }
}

private func valore(_ dizionario: [String: Any], chiavi: [String]) -> Any? {
    for chiave in chiavi {
        if let trovato = dizionario[chiave], !(trovato is NSNull) {
            return trovato
        }
    }
    return nil
}

private func schedaMacchina(_ dizionario: [String: Any]) -> SchedaManutenzione {
    var scheda = SchedaManutenzione()
    scheda.origine = testo(dizionario, "origine") ?? ""
    scheda.tipologia = testo(dizionario, "tipologia") ?? ""
    scheda.macchina = testo(dizionario, "macchina") ?? ""
    scheda.tipoMacchina = testo(dizionario, "tipoMacchina", "tipo_macchina") ?? ""
    scheda.statoGestione = testo(dizionario, "statoGestione", "stato_gestione") ?? ""
    scheda.manualeTitolo = testo(dizionario, "manualeTitolo", "manuale") ?? ""
    scheda.manualeTesto = testo(dizionario, "manualeTesto") ?? ""
    scheda.segnalazioneImmediata = vero(dizionario, "segnalazioneImmediata", "segnalazione_immediata")
        || scheda.statoGestione == "ticket in gestione urgente"
    scheda.anomaliaRispettoAlPiano = vero(dizionario, "anomaliaRispettoAlPiano", "anomalia_rispetto_al_piano")
    if let passi = valore(dizionario, chiavi: ["workflow", "passi"]) as? [Any] {
        scheda.workflow = passi.compactMap { elemento in
            if let testo = elemento as? String {
                let pulito = testo.trimmingCharacters(in: .whitespacesAndNewlines)
                return pulito.isEmpty ? nil : pulito
            }
            return nil
        }
    }
    return scheda
}

private func vero(_ dizionario: [String: Any], _ chiavi: String...) -> Bool {
    guard let grezzo = valore(dizionario, chiavi: chiavi) else { return false }
    if let flag = grezzo as? Bool { return flag }
    if let numero = grezzo as? NSNumber { return numero.intValue != 0 }
    if let testo = grezzo as? String {
        return ["true", "si", "sì", "1"].contains(testo.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }
    return false
}

private func testo(_ dizionario: [String: Any], _ chiavi: String...) -> String? {
    guard let grezzo = valore(dizionario, chiavi: chiavi) else { return nil }
    if let stringa = grezzo as? String {
        let pulita = stringa.trimmingCharacters(in: .whitespacesAndNewlines)
        return pulita.isEmpty ? nil : pulita
    }
    if let numero = grezzo as? NSNumber {
        if CFGetTypeID(numero as CFTypeRef) == CFBooleanGetTypeID() { return nil }
        return numero.stringValue
    }
    return nil
}

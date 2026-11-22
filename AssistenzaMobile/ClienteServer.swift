import Foundation

/// Client verso la demo «Assistenza Tecnica Demo» in demo-assistenza, porta 3012.
@MainActor
enum ClienteServer {
    static let urlPredefinito = "http://127.0.0.1:3012"
    private static let chiaveURL = "it.sviluppo.assistenza.urlServer"

    static var urlTesto: String {
        get {
            let salvato = UserDefaults.standard.string(forKey: chiaveURL)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return salvato.isEmpty ? urlPredefinito : salvato
        }
        set {
            let pulito = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            UserDefaults.standard.set(pulito.isEmpty ? urlPredefinito : pulito, forKey: chiaveURL)
        }
    }

    static func sincronizza(archivio: ArchivioLocale, sessione: SessioneTecnico) async {
        guard !archivio.sincronizzazioneInCorso else { return }
        guard let tecnicoID = sessione.tecnicoID, let tecnico = archivio.tecnico(id: tecnicoID) else { return }
        guard let origine = origine(urlTesto) else {
            archivio.messaggioSincronizzazione = "L'indirizzo del server non è valido. I dati restano su questo iPad."
            return
        }
        archivio.sincronizzazioneInCorso = true
        defer { archivio.sincronizzazioneInCorso = false }

        var pezzi: [String] = []
        var scaricato = false
        do {
            let dati = try await scaricaAssegnazioni(logon: tecnico.logon, origine: origine)
            let statiIntervento = Dictionary(uniqueKeysWithValues: archivio.interventi.map { ($0.id, $0.stato) })
            let statiTicket = Dictionary(uniqueKeysWithValues: archivio.ticket.map { ($0.id, $0.stato) })
            switch archivio.importa(dati: dati, nomeFile: "Assistenza Tecnica Demo", registraEsito: false) {
            case .success(let esito):
                archivio.conservaStatoLocale(interventi: statiIntervento, ticket: statiTicket)
                pezzi.append(esito.riepilogo(logonCorrente: tecnico.logon))
                scaricato = true
            case .failure(let errore):
                let testo = (errore as? ErroreImportazione)?.messaggio ?? "Le assegnazioni ricevute non sono leggibili."
                pezzi.append(testo)
            }
        } catch ErroreServer.irraggiungibile {
            archivio.messaggioSincronizzazione = "Server non raggiungibile. Stato, note e risposte restano su questo iPad."
            return
        } catch let errore as ErroreServer {
            pezzi.append(errore.descrizione)
        } catch {
            pezzi.append("Non è stato possibile scaricare le assegnazioni.")
        }

        do {
            let inviati = try await inviaAggiornamenti(tecnico: tecnico, archivio: archivio, origine: origine)
            pezzi.append("Inviati al server \(inviati.interventi) interventi e \(inviati.ticket) ticket.")
        } catch ErroreServer.irraggiungibile {
            pezzi.append("Il server non è raggiungibile per l'invio. I dati restano su questo iPad.")
        } catch let errore as ErroreServer {
            pezzi.append(errore.descrizione)
        } catch {
            pezzi.append("Non è stato possibile inviare gli aggiornamenti.")
        }

        if !scaricato && pezzi.isEmpty {
            pezzi.append("Nessun aggiornamento inviato.")
        }
        archivio.messaggioSincronizzazione = pezzi.joined(separator: " ")
    }

    /// Scarica i ticket risolti o chiusi sul server, solo per il tecnico che ha fatto l'accesso.
    @discardableResult
    static func scaricaTicketEseguiti(archivio: ArchivioLocale, sessione: SessioneTecnico) async -> Bool {
        guard !archivio.scaricamentoTicketInCorso, !archivio.sincronizzazioneInCorso else { return false }
        guard let tecnicoID = sessione.tecnicoID, let tecnico = archivio.tecnico(id: tecnicoID) else {
            archivio.messaggioTicket = "Entra con il tuo logon per scaricare i ticket eseguiti."
            return false
        }
        guard let origine = origine(urlTesto) else {
            archivio.messaggioTicket = "L'indirizzo del server non è valido. I ticket restano su questo iPad."
            return false
        }
        archivio.scaricamentoTicketInCorso = true
        defer { archivio.scaricamentoTicketInCorso = false }

        do {
            let percorso = "/api/tecnici/\(tecnico.logon.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? tecnico.logon)/ticket-eseguiti"
            let dati = try await scarica(percorso, origine: origine, errore: "Scaricamento dei ticket eseguiti non riuscito.")
            let elenco = elencoTicket(in: dati)
            if elenco.isEmpty {
                archivio.messaggioTicket = "Nessun ticket eseguito sul server per \(tecnico.logon)."
                return false
            }
            switch archivio.importa(dati: dati, nomeFile: "Ticket eseguiti", registraEsito: false) {
            case .success(let esito):
                archivio.messaggioTicket = testoScarico(esito)
                return true
            case .failure(let errore):
                archivio.messaggioTicket = (errore as? ErroreImportazione)?.messaggio ?? "I ticket eseguiti non sono leggibili."
                return false
            }
        } catch ErroreServer.irraggiungibile {
            archivio.messaggioTicket = "Server non raggiungibile. I ticket già sull'iPad restano."
            return false
        } catch let errore as ErroreServer {
            archivio.messaggioTicket = errore.descrizione
            return false
        } catch {
            archivio.messaggioTicket = "Non è stato possibile scaricare i ticket eseguiti."
            return false
        }
    }

    static func origine(_ testo: String) -> URL? {
        var raw = testo.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { raw = urlPredefinito }
        if !raw.contains("://") { raw = "http://" + raw }
        guard let url = URL(string: raw),
              let schema = url.scheme?.lowercased(),
              schema == "http" || schema == "https",
              let host = url.host, !host.isEmpty else { return nil }
        var componenti = URLComponents()
        componenti.scheme = schema
        componenti.host = host
        componenti.port = url.port
        return componenti.url
    }

    private static func scaricaAssegnazioni(logon: String, origine: URL) async throws -> Data {
        let percorso = "/api/tecnici/\(logon.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? logon)/assegnazioni"
        return try await scarica(percorso, origine: origine, errore: "Scaricamento delle assegnazioni non riuscito.")
    }

    private static func scarica(_ percorso: String, origine: URL, errore: String) async throws -> Data {
        guard let url = url(origine, percorso) else { throw ErroreServer.url }
        let (dati, http) = try await chiedi(url, metodo: "GET", corpo: nil)
        guard (200...299).contains(http.statusCode) else {
            throw ErroreServer.risposta(http.statusCode, messaggio(dati) ?? errore)
        }
        guard !dati.isEmpty else { throw ErroreServer.formato }
        return dati
    }

    private static func elencoTicket(in dati: Data) -> [Any] {
        guard let oggetto = try? JSONSerialization.jsonObject(with: dati) as? [String: Any] else { return [] }
        return oggetto["ticket"] as? [Any] ?? []
    }

    private static func testoScarico(_ esito: EsitoImportazione) -> String {
        let nuovi = esito.ticketNuovi
        let aggiornati = esito.ticketAggiornati
        if nuovi == 0 && aggiornati == 0 {
            return "I ticket eseguiti del server erano già su questo iPad."
        }
        var pezzi: [String] = []
        if nuovi == 1 {
            pezzi.append("1 ticket eseguito nuovo")
        } else if nuovi > 1 {
            pezzi.append("\(nuovi) ticket eseguiti nuovi")
        }
        if aggiornati == 1 {
            pezzi.append("1 ticket eseguito aggiornato")
        } else if aggiornati > 1 {
            pezzi.append("\(aggiornati) ticket eseguiti aggiornati")
        }
        return "Salvati sull'iPad: \(pezzi.joined(separator: ", "))."
    }

    private static func inviaAggiornamenti(
        tecnico: Tecnico,
        archivio: ArchivioLocale,
        origine: URL
    ) async throws -> (interventi: Int, ticket: Int) {
        guard let url = url(origine, "/api/sincronizzazione") else { throw ErroreServer.url }
        let interventi = archivio.interventiAssegnati(a: tecnico.id)
        let ticket = archivio.ticketAssegnati(a: tecnico.id)
        let pacchetto = PacchettoUscita(
            versione: 1,
            inviato: iso.string(from: .now),
            tecnico: TecnicoUscita(id: tecnico.id, logon: tecnico.logon),
            interventi: interventi.map { intervento in
                InterventoUscita(
                    id: intervento.id,
                    stato: intervento.stato.rawValue,
                    aggiornato: iso.string(from: intervento.aggiornato),
                    note: intervento.note.map(notaUscita)
                )
            },
            ticket: ticket.map { ticket in
                TicketUscita(
                    id: ticket.id,
                    stato: ticket.stato.rawValue,
                    aggiornato: iso.string(from: ticket.aggiornato),
                    risposte: ticket.risposte.map(notaUscita)
                )
            }
        )
        let corpo = try JSONEncoder().encode(pacchetto)
        let (dati, http) = try await chiedi(url, metodo: "POST", corpo: corpo)
        guard (200...299).contains(http.statusCode) else {
            throw ErroreServer.risposta(http.statusCode, messaggio(dati) ?? "Il server non ha accettato gli aggiornamenti.")
        }
        return (interventi.count, ticket.count)
    }

    private static func url(_ origine: URL, _ percorso: String) -> URL? {
        var testo = origine.absoluteString
        if testo.hasSuffix("/") { testo.removeLast() }
        return URL(string: testo + percorso)
    }

    private static func chiedi(_ url: URL, metodo: String, corpo: Data?) async throws -> (Data, HTTPURLResponse) {
        var richiesta = URLRequest(url: url, timeoutInterval: 8)
        richiesta.httpMethod = metodo
        richiesta.setValue("application/json", forHTTPHeaderField: "Accept")
        if let corpo {
            richiesta.httpBody = corpo
            richiesta.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let dati: Data
        let risposta: URLResponse
        do {
            (dati, risposta) = try await URLSession.shared.data(for: richiesta)
        } catch {
            throw ErroreServer.irraggiungibile
        }
        guard let http = risposta as? HTTPURLResponse else { throw ErroreServer.formato }
        return (dati, http)
    }

    private static func messaggio(_ dati: Data) -> String? {
        guard let oggetto = try? JSONSerialization.jsonObject(with: dati) as? [String: Any] else { return nil }
        for chiave in ["errore", "messaggio"] {
            if let testo = oggetto[chiave] as? String {
                let pulito = testo.trimmingCharacters(in: .whitespacesAndNewlines)
                if !pulito.isEmpty { return pulito }
            }
        }
        return nil
    }

    private static func notaUscita(_ nota: Annotazione) -> NotaUscita {
        NotaUscita(id: nota.id, testo: nota.testo, autore: nota.autore, data: iso.string(from: nota.data))
    }

    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}

private enum ErroreServer: Error {
    case url
    case irraggiungibile
    case risposta(Int, String)
    case formato

    var descrizione: String {
        switch self {
        case .url:
            return "L'indirizzo del server non è valido."
        case .irraggiungibile:
            return "Server non raggiungibile."
        case .risposta(let codice, let testo):
            return "Il server ha risposto \(codice): \(testo)"
        case .formato:
            return "La risposta del server non è nel formato atteso."
        }
    }
}

private struct PacchettoUscita: Encodable {
    var versione: Int
    var inviato: String
    var tecnico: TecnicoUscita
    var interventi: [InterventoUscita]
    var ticket: [TicketUscita]
}

private struct TecnicoUscita: Encodable {
    var id: String
    var logon: String
}

private struct NotaUscita: Encodable {
    var id: String
    var testo: String
    var autore: String
    var data: String
}

private struct InterventoUscita: Encodable {
    var id: String
    var stato: String
    var aggiornato: String
    var note: [NotaUscita]
}

private struct TicketUscita: Encodable {
    var id: String
    var stato: String
    var aggiornato: String
    var risposte: [NotaUscita]
}

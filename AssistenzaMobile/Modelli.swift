import Foundation

struct Tecnico: Codable, Identifiable, Equatable {
    var id: String
    var logon: String
    var nome: String
    var passwordHash: String

    static func id(perLogon logon: String) -> String {
        let chiave = logon.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return "tec-\(chiave)"
    }
}

struct Cliente: Codable, Identifiable, Equatable {
    var id: String
    var nome: String
    var referente: String
    var telefono: String
    var email: String
    var indirizzo: String
    var note: String
    var tecnicoID: String
}

struct Annotazione: Codable, Identifiable, Equatable {
    var id: String
    var testo: String
    var autore: String
    var data: Date
}

struct Intervento: Codable, Identifiable, Equatable {
    var id: String
    var titolo: String
    var descrizione: String
    var clienteID: String
    var tecnicoID: String
    var stato: StatoIntervento
    var priorita: Priorita
    var appuntamento: Date
    var indirizzo: String
    var note: [Annotazione]
    var aggiornato: Date
}

struct Ticket: Codable, Identifiable, Equatable {
    var id: String
    var titolo: String
    var descrizione: String
    var clienteID: String
    var tecnicoID: String
    var stato: StatoTicket
    var priorita: Priorita
    var risposte: [Annotazione]
    var aperto: Date
    var aggiornato: Date
}

enum StatoIntervento: String, Codable, CaseIterable, Identifiable {
    case programmato
    case inCorso = "in_corso"
    case inAttesa = "in_attesa"
    case completato
    case annullato

    var id: String { rawValue }

    var titolo: String {
        switch self {
        case .programmato: return "Programmato"
        case .inCorso: return "In corso"
        case .inAttesa: return "In attesa"
        case .completato: return "Completato"
        case .annullato: return "Annullato"
        }
    }

    var chiuso: Bool {
        self == .completato || self == .annullato
    }

    init?(testo: String) {
        switch Self.normalizza(testo) {
        case "programmato", "da_fare", "assegnato", "nuovo":
            self = .programmato
        case "in_corso", "incorso", "lavorazione", "in_lavorazione":
            self = .inCorso
        case "in_attesa", "inattesa", "sospeso", "attesa":
            self = .inAttesa
        case "completato", "fatto", "eseguito":
            self = .completato
        case "annullato", "cancellato":
            self = .annullato
        default:
            return nil
        }
    }

    private static func normalizza(_ testo: String) -> String {
        testo.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: "-", with: "_")
    }
}

enum StatoTicket: String, Codable, CaseIterable, Identifiable {
    case aperto
    case inLavorazione = "in_lavorazione"
    case inAttesaCliente = "in_attesa_cliente"
    case risolto
    case chiuso

    var id: String { rawValue }

    var titolo: String {
        switch self {
        case .aperto: return "Aperto"
        case .inLavorazione: return "In lavorazione"
        case .inAttesaCliente: return "In attesa del cliente"
        case .risolto: return "Risolto"
        case .chiuso: return "Chiuso"
        }
    }

    var chiuso: Bool {
        self == .risolto || self == .chiuso
    }

    init?(testo: String) {
        switch testo.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: "-", with: "_") {
        case "aperto", "nuovo":
            self = .aperto
        case "in_lavorazione", "inlavorazione", "in_corso":
            self = .inLavorazione
        case "in_attesa", "in_attesa_cliente", "in_attesa_del_cliente", "attesa":
            self = .inAttesaCliente
        case "risolto":
            self = .risolto
        case "chiuso":
            self = .chiuso
        default:
            return nil
        }
    }
}

enum Priorita: String, Codable, CaseIterable, Identifiable {
    case bassa
    case media
    case alta
    case urgente

    var id: String { rawValue }

    var titolo: String {
        switch self {
        case .bassa: return "Bassa"
        case .media: return "Media"
        case .alta: return "Alta"
        case .urgente: return "Urgente"
        }
    }

    init?(testo: String) {
        switch testo.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: " ", with: "_") {
        case "bassa":
            self = .bassa
        case "media", "normale":
            self = .media
        case "alta":
            self = .alta
        case "urgente", "critica":
            self = .urgente
        default:
            return nil
        }
    }
}

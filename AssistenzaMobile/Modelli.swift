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

enum TipologiaPending: String, CaseIterable, Identifiable {
    case problemaTecnico = "Problema tecnico"
    case assenza = "Assenza dell'operatore"
    case ricambio = "Attesa ricambio"
    case impianto = "Indisponibilità dell'impianto"

    var id: String { rawValue }

    var titolo: String { rawValue }

    /// La causale che Sara legge: problema tecnico oppure motivo extra tecnico.
    var causale: String {
        switch self {
        case .problemaTecnico, .ricambio:
            return "problema tecnico"
        case .assenza, .impianto:
            return "extra tecnico"
        }
    }
}

struct SchedaManutenzione: Codable, Equatable {
    var origine: String = ""
    var tipologia: String = ""
    var macchina: String = ""
    var tipoMacchina: String = ""
    var segnalazioneImmediata: Bool = false
    var statoGestione: String = ""
    var anomaliaRispettoAlPiano: Bool = false
    var manualeTitolo: String = ""
    var manualeTesto: String = ""
    var workflow: [String] = []
    var passoWorkflow: Int = 0
    var pendingTipologia: String = ""

    var urgente: Bool {
        segnalazioneImmediata || statoGestione == "ticket in gestione urgente"
    }

    var workflowCompleto: Bool {
        workflow.isEmpty || passoWorkflow >= workflow.count
    }

    var haManuale: Bool {
        !manualeTitolo.isEmpty || !manualeTesto.isEmpty
    }

    private enum CodingKeys: String, CodingKey {
        case origine, tipologia, macchina, tipoMacchina, segnalazioneImmediata, statoGestione
        case anomaliaRispettoAlPiano, manualeTitolo, manualeTesto, workflow, passoWorkflow, pendingTipologia
    }

    init() {}

    init(from decoder: Decoder) throws {
        let contenitore = try decoder.container(keyedBy: CodingKeys.self)
        origine = try contenitore.decodeIfPresent(String.self, forKey: .origine) ?? ""
        tipologia = try contenitore.decodeIfPresent(String.self, forKey: .tipologia) ?? ""
        macchina = try contenitore.decodeIfPresent(String.self, forKey: .macchina) ?? ""
        tipoMacchina = try contenitore.decodeIfPresent(String.self, forKey: .tipoMacchina) ?? ""
        segnalazioneImmediata = try contenitore.decodeIfPresent(Bool.self, forKey: .segnalazioneImmediata) ?? false
        statoGestione = try contenitore.decodeIfPresent(String.self, forKey: .statoGestione) ?? ""
        anomaliaRispettoAlPiano = try contenitore.decodeIfPresent(Bool.self, forKey: .anomaliaRispettoAlPiano) ?? false
        manualeTitolo = try contenitore.decodeIfPresent(String.self, forKey: .manualeTitolo) ?? ""
        manualeTesto = try contenitore.decodeIfPresent(String.self, forKey: .manualeTesto) ?? ""
        workflow = try contenitore.decodeIfPresent([String].self, forKey: .workflow) ?? []
        passoWorkflow = try contenitore.decodeIfPresent(Int.self, forKey: .passoWorkflow) ?? 0
        pendingTipologia = try contenitore.decodeIfPresent(String.self, forKey: .pendingTipologia) ?? ""
    }

    func encode(to encoder: Encoder) throws {
        var contenitore = encoder.container(keyedBy: CodingKeys.self)
        try contenitore.encode(origine, forKey: .origine)
        try contenitore.encode(tipologia, forKey: .tipologia)
        try contenitore.encode(macchina, forKey: .macchina)
        try contenitore.encode(tipoMacchina, forKey: .tipoMacchina)
        try contenitore.encode(segnalazioneImmediata, forKey: .segnalazioneImmediata)
        try contenitore.encode(statoGestione, forKey: .statoGestione)
        try contenitore.encode(anomaliaRispettoAlPiano, forKey: .anomaliaRispettoAlPiano)
        try contenitore.encode(manualeTitolo, forKey: .manualeTitolo)
        try contenitore.encode(manualeTesto, forKey: .manualeTesto)
        try contenitore.encode(workflow, forKey: .workflow)
        try contenitore.encode(passoWorkflow, forKey: .passoWorkflow)
        try contenitore.encode(pendingTipologia, forKey: .pendingTipologia)
    }
}

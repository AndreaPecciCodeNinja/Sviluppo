import SwiftUI

enum Sezione: String, Hashable, Identifiable {
    case interventi
    case clienti
    case ticket
    case importazione

    var id: String { rawValue }
}

struct VistaRadice: View {
    var archivio: ArchivioLocale
    var sessione: SessioneTecnico
    @Environment(\.colorScheme) private var schema

    private var tecnico: Tecnico? {
        guard let id = sessione.tecnicoID else { return nil }
        return archivio.tecnico(id: id)
    }

    var body: some View {
        Group {
            if tecnico != nil {
                ContenutoPrincipale()
            } else {
                SchermataAccesso()
            }
        }
        .environment(archivio)
        .environment(sessione)
        .environment(\.locale, Locale(identifier: "it_IT"))
        .tint(schema == .dark ? Tinta.marchioChiaro : Tinta.marchio)
        .onOpenURL { url in
            guard url.isFileURL else { return }
            _ = archivio.importaFile(da: url)
        }
    }
}

private struct ContenutoPrincipale: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    @State private var sezione: Sezione = .interventi
    @State private var interventoID: String?
    @State private var clienteID: String?
    @State private var ticketID: String?

    var body: some View {
        NavigationSplitView {
            BarraLaterale(sezione: $sezione)
                .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 340)
        } content: {
            switch sezione {
            case .interventi:
                VistaInterventi(selezione: $interventoID)
            case .clienti:
                VistaClienti(selezione: $clienteID)
            case .ticket:
                VistaTicket(selezione: $ticketID)
            case .importazione:
                VistaImportazione()
            }
        } detail: {
            switch sezione {
            case .interventi:
                if let interventoID {
                    DettaglioIntervento(id: interventoID, onApriCliente: apriCliente)
                } else {
                    SezioneVuota(
                        titolo: "Seleziona un intervento",
                        dettaglio: "I dettagli, lo stato e le note compaiono qui.",
                        simbolo: "wrench.and.screwdriver"
                    )
                }
            case .clienti:
                if let clienteID {
                    DettaglioCliente(
                        id: clienteID,
                        onApriIntervento: apriIntervento,
                        onApriTicket: apriTicket
                    )
                } else {
                    SezioneVuota(
                        titolo: "Seleziona un cliente",
                        dettaglio: "Qui trovi il referente, i contatti e i lavori assegnati.",
                        simbolo: "person.2"
                    )
                }
            case .ticket:
                if let ticketID {
                    DettaglioTicket(id: ticketID, onApriCliente: apriCliente)
                } else {
                    SezioneVuota(
                        titolo: "Seleziona un ticket",
                        dettaglio: "La richiesta e le risposte compaiono qui.",
                        simbolo: "text.bubble"
                    )
                }
            case .importazione:
                ScrollView {
                    GuidaImportazione()
                }
                .background(Color(.systemGroupedBackground))
                .navigationTitle("Formato del file")
                .navigationBarTitleDisplayMode(.inline)
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    private func apriCliente(_ id: String) {
        clienteID = id
        sezione = .clienti
    }

    private func apriIntervento(_ id: String) {
        interventoID = id
        sezione = .interventi
    }

    private func apriTicket(_ id: String) {
        ticketID = id
        sezione = .ticket
    }
}

private struct BarraLaterale: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    @Binding var sezione: Sezione

    private var tecnico: Tecnico? {
        guard let id = sessione.tecnicoID else { return nil }
        return archivio.tecnico(id: id)
    }

    private var interventiAperti: Int {
        guard let id = sessione.tecnicoID else { return 0 }
        return archivio.interventiAssegnati(a: id).filter { !$0.stato.chiuso }.count
    }

    private var ticketAperti: Int {
        guard let id = sessione.tecnicoID else { return 0 }
        return archivio.ticketAssegnati(a: id).filter { !$0.stato.chiuso }.count
    }

    var body: some View {
        List(selection: $sezione) {
            Section("Lavoro") {
                Label("Interventi", systemImage: "wrench.and.screwdriver")
                    .badge(interventiAperti)
                    .tag(Sezione.interventi)
                Label("Clienti", systemImage: "person.2")
                    .tag(Sezione.clienti)
                Label("Ticket", systemImage: "text.bubble")
                    .badge(ticketAperti)
                    .tag(Sezione.ticket)
            }
            Section("Dati") {
                Label("Importazione", systemImage: "square.and.arrow.down")
                    .tag(Sezione.importazione)
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Assistenza")
        .safeAreaInset(edge: .bottom) {
            if let tecnico {
                VStack(alignment: .leading, spacing: 8) {
                    Text(tecnico.nome)
                        .font(.headline)
                    Text(tecnico.logon)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Label("Dati su questo iPad", systemImage: "internaldrive")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let errore = archivio.erroreSalvataggio {
                        Text(errore)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                    Button("Esci") {
                        sessione.esci()
                    }
                    .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(.bar)
            }
        }
    }
}

enum Anteprima {
    static func vista(logon: String? = nil) -> VistaRadice {
        let percorso = FileManager.default.temporaryDirectory
            .appendingPathComponent("assistenza-\(UUID().uuidString).json")
        let archivio = ArchivioLocale(percorso: percorso)
        let sessione = SessioneTecnico(archivio: archivio)
        if let logon {
            _ = sessione.accedi(logon: logon, password: DatiDimostrativi.password)
        }
        return VistaRadice(archivio: archivio, sessione: sessione)
    }
}

#Preview("Accesso") {
    Anteprima.vista()
}

#Preview("Marco Bianchi") {
    Anteprima.vista(logon: DatiDimostrativi.marco)
}

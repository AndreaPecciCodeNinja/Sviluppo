import SwiftUI

enum FiltroTicket: String, CaseIterable, Identifiable {
    case tutti
    case aperti
    case inLavorazione
    case inAttesa
    case risolti
    case chiusi
    case eseguiti

    var id: String { rawValue }

    var titolo: String {
        switch self {
        case .tutti: return "Tutti"
        case .aperti: return "Aperti"
        case .inLavorazione: return "In lavorazione"
        case .inAttesa: return "In attesa"
        case .risolti: return "Risolti"
        case .chiusi: return "Chiusi"
        case .eseguiti: return "Eseguiti"
        }
    }

    var stato: StatoTicket? {
        switch self {
        case .tutti: return nil
        case .aperti: return .aperto
        case .inLavorazione: return .inLavorazione
        case .inAttesa: return .inAttesaCliente
        case .risolti: return .risolto
        case .chiusi: return .chiuso
        case .eseguiti: return nil
        }
    }
}

struct VistaTicket: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    @Binding var selezione: String?
    @State private var query = ""
    @State private var filtro: FiltroTicket = .tutti
    @State private var nuovo = false

    private var tecnicoID: String? { sessione.tecnicoID }

    private var assegnati: [Ticket] {
        guard let tecnicoID else { return [] }
        return archivio.ticketAssegnati(a: tecnicoID)
    }

    private var filtrati: [Ticket] {
        let ago = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return assegnati
            .filter { ticket in
                let statoOk = filtro == .eseguiti ? ticket.stato.chiuso : (filtro.stato == nil || ticket.stato == filtro.stato)
                return statoOk && corrisponde(ticket, ago: ago)
            }
            .sorted { lhs, rhs in
                if lhs.stato.chiuso != rhs.stato.chiuso { return !lhs.stato.chiuso }
                if lhs.aggiornato != rhs.aggiornato { return lhs.aggiornato > rhs.aggiornato }
                return lhs.titolo.localizedStandardCompare(rhs.titolo) == .orderedAscending
            }
    }

    var body: some View {
        List(selection: $selezione) {
            Section {
                ForEach(filtrati) { ticket in
                    riga(ticket)
                        .tag(ticket.id)
                        .contextMenu {
                            ForEach(StatoTicket.allCases) { stato in
                                Button(stato.titolo) {
                                    guard let tecnicoID else { return }
                                    archivio.aggiornaStatoTicket(id: ticket.id, tecnicoID: tecnicoID, stato: stato)
                                }
                            }
                        }
                }
            } footer: {
                Text("Solo i ticket del tuo logon. Scarica eseguiti prende dal server quelli risolti o chiusi.")
            }
        }
        .listStyle(.inset)
        .navigationTitle("Ticket")
        .searchable(text: $query, prompt: "Cerca titolo o cliente")
        .overlay {
            if filtrati.isEmpty {
                SezioneVuota(
                    titolo: assegnati.isEmpty ? "Nessun ticket assegnato" : "Nessun risultato",
                    dettaglio: assegnati.isEmpty
                        ? "Apri un ticket oppure importalo con l'elenco."
                        : "Prova un altro stato o un'altra ricerca.",
                    simbolo: "text.bubble"
                )
            }
        }
        .safeAreaInset(edge: .top) {
            if let messaggio = archivio.messaggioTicket {
                Banner(testo: messaggio, simbolo: "arrow.down.circle", colore: Tinta.marchio)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }
        }
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button {
                    Task {
                        let scaricati = await ClienteServer.scaricaTicketEseguiti(archivio: archivio, sessione: sessione)
                        if scaricati { filtro = .eseguiti }
                    }
                } label: {
                    if archivio.scaricamentoTicketInCorso {
                        ProgressView()
                    } else {
                        Label("Scarica eseguiti", systemImage: "arrow.down.circle")
                    }
                }
                .disabled(archivio.scaricamentoTicketInCorso || archivio.sincronizzazioneInCorso || tecnicoID == nil)
            }
            ToolbarItem(placement: .automatic) {
                Picker("Stato", selection: $filtro) {
                    ForEach(FiltroTicket.allCases) { filtro in
                        Text(filtro.titolo).tag(filtro)
                    }
                }
                .pickerStyle(.menu)
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    nuovo = true
                } label: {
                    Label("Nuovo ticket", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $nuovo) {
            EditorTicket(esistente: nil) { id in
                filtro = .tutti
                query = ""
                selezione = id
            }
        }
        .onAppear(perform: allineaSelezione)
        .onChange(of: filtrati.map(\.id)) { _, _ in
            allineaSelezione()
        }
    }

    private func riga(_ ticket: Ticket) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(ticket.titolo)
                    .font(.headline)
                    .lineLimit(2)
                Text(etichettaCliente(ticket.clienteID))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text("\(ticket.risposte.count) risposte · \(Formato.appuntamento(ticket.aggiornato))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                Etichetta(testo: ticket.stato.titolo, colore: Tinta.stato(ticket.stato))
                Etichetta(testo: ticket.priorita.titolo, colore: Tinta.priorita(ticket.priorita))
            }
        }
        .padding(.vertical, 4)
    }

    private func etichettaCliente(_ id: String) -> String {
        guard let tecnicoID, let cliente = archivio.cliente(id: id, visibileA: tecnicoID) else {
            return "Cliente non in archivio"
        }
        if cliente.referente.isEmpty { return cliente.nome }
        return "\(cliente.nome) · \(cliente.referente)"
    }

    private func corrisponde(_ ticket: Ticket, ago: String) -> Bool {
        guard !ago.isEmpty else { return true }
        guard let tecnicoID else { return false }
        let cliente = archivio.cliente(id: ticket.clienteID, visibileA: tecnicoID)
        let campi = [
            ticket.titolo,
            ticket.descrizione,
            cliente?.nome ?? "",
            cliente?.referente ?? "",
            ticket.risposte.map(\.testo).joined(separator: " ")
        ]
        return campi.contains {
            $0.range(of: ago, options: [.caseInsensitive, .diacriticInsensitive]) != nil
        }
    }

    private func allineaSelezione() {
        if let selezione, filtrati.contains(where: { $0.id == selezione }) { return }
        selezione = filtrati.first?.id
    }
}

struct DettaglioTicket: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    var id: String
    var onApriCliente: (String) -> Void
    @State private var modifica = false
    @State private var bozza = ""

    private var tecnicoID: String? { sessione.tecnicoID }

    var body: some View {
        if let tecnicoID, let ticket = archivio.ticket(id: id, visibileA: tecnicoID) {
            contenuto(ticket, tecnicoID: tecnicoID)
        } else {
            SezioneVuota(
                titolo: "Ticket non disponibile",
                dettaglio: "Questo ticket non è assegnato al tuo logon.",
                simbolo: "text.bubble"
            )
        }
    }

    private func contenuto(_ ticket: Ticket, tecnicoID: String) -> some View {
        let cliente = archivio.cliente(id: ticket.clienteID, visibileA: tecnicoID)
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Etichetta(testo: ticket.stato.titolo, colore: Tinta.stato(ticket.stato))
                        Etichetta(testo: ticket.priorita.titolo, colore: Tinta.priorita(ticket.priorita))
                        Spacer()
                        Text(ticket.id)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    Text(ticket.titolo)
                        .font(.largeTitle.weight(.semibold))
                    if let cliente {
                        Button(cliente.referente.isEmpty ? cliente.nome : "\(cliente.nome) · \(cliente.referente)") {
                            onApriCliente(cliente.id)
                        }
                        .buttonStyle(.plain)
                        .font(.title3)
                        .foregroundStyle(Color.accentColor)
                    }
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                    SchedaInfo(titolo: "Aperto", valore: Formato.dataOra(ticket.aperto), simbolo: "calendar")
                    SchedaInfo(titolo: "Aggiornato", valore: Formato.dataOra(ticket.aggiornato), simbolo: "clock")
                    SchedaInfo(titolo: "Utente", valore: cliente?.referente ?? "", simbolo: "person")
                    SchedaInfo(titolo: "Telefono", valore: cliente?.telefono ?? "", simbolo: "phone", destinazione: Collegamenti.telefono(cliente?.telefono ?? ""))
                }

                if !ticket.descrizione.isEmpty {
                    BloccoTesto(titolo: "Richiesta", testo: ticket.descrizione)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Risposte")
                        .font(.headline)
                    if ticket.risposte.isEmpty {
                        Text("Nessuna risposta. Scrivi al cliente qui sotto.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(ticket.risposte.sorted { $0.data < $1.data }) { risposta in
                            BollaMessaggio(messaggio: risposta)
                        }
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 900, alignment: .leading)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(ticket.titolo)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            HStack(alignment: .bottom, spacing: 12) {
                TextField("Scrivi una risposta", text: $bozza, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                Button("Invia") {
                    let autore = archivio.tecnico(id: tecnicoID)?.nome ?? "Tecnico"
                    archivio.aggiungiRisposta(ticketID: ticket.id, tecnicoID: tecnicoID, testo: bozza, autore: autore)
                    bozza = ""
                }
                .buttonStyle(.borderedProminent)
                .tint(Tinta.marchio)
                .disabled(bozza.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding()
            .background(.bar)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    ForEach(StatoTicket.allCases) { stato in
                        Button {
                            archivio.aggiornaStatoTicket(id: ticket.id, tecnicoID: tecnicoID, stato: stato)
                        } label: {
                            if stato == ticket.stato {
                                Label(stato.titolo, systemImage: "checkmark")
                            } else {
                                Text(stato.titolo)
                            }
                        }
                    }
                } label: {
                    Label("Cambia stato", systemImage: "arrow.triangle.2.circlepath")
                }
            }
            ToolbarItem(placement: .automatic) {
                Button("Modifica") { modifica = true }
            }
        }
        .sheet(isPresented: $modifica) {
            EditorTicket(esistente: ticket)
        }
    }
}

struct EditorTicket: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    @Environment(\.dismiss) private var dismiss

    var esistente: Ticket?
    var clientePreselezionato: String?
    var onSalvato: (String) -> Void

    @State private var titolo: String
    @State private var descrizione: String
    @State private var clienteID: String
    @State private var priorita: Priorita
    @State private var stato: StatoTicket

    init(esistente: Ticket? = nil, clientePreselezionato: String? = nil, onSalvato: @escaping (String) -> Void = { _ in }) {
        self.esistente = esistente
        self.clientePreselezionato = clientePreselezionato
        self.onSalvato = onSalvato
        _titolo = State(initialValue: esistente?.titolo ?? "")
        _descrizione = State(initialValue: esistente?.descrizione ?? "")
        _clienteID = State(initialValue: esistente?.clienteID ?? clientePreselezionato ?? "")
        _priorita = State(initialValue: esistente?.priorita ?? .media)
        _stato = State(initialValue: esistente?.stato ?? .aperto)
    }

    private var clienti: [Cliente] {
        guard let tecnicoID = sessione.tecnicoID else { return [] }
        return archivio.clientiAssegnati(a: tecnicoID)
    }

    private var puoSalvare: Bool {
        !titolo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !clienteID.isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                if clienti.isEmpty && esistente == nil {
                    Section {
                        Text("Aggiungi prima un cliente, oppure importa un elenco di assegnazioni.")
                            .foregroundStyle(.secondary)
                    }
                }
                Section("Ticket") {
                    TextField("Titolo", text: $titolo)
                    Picker("Cliente", selection: $clienteID) {
                        Text("Seleziona un cliente").tag("")
                        ForEach(clienti) { cliente in
                            Text(cliente.referente.isEmpty ? cliente.nome : "\(cliente.nome) · \(cliente.referente)")
                                .tag(cliente.id)
                        }
                    }
                    Picker("Priorità", selection: $priorita) {
                        ForEach(Priorita.allCases) { priorita in
                            Text(priorita.titolo).tag(priorita)
                        }
                    }
                    Picker("Stato", selection: $stato) {
                        ForEach(StatoTicket.allCases) { stato in
                            Text(stato.titolo).tag(stato)
                        }
                    }
                }
                Section("Richiesta") {
                    TextField("Descrivi il problema", text: $descrizione, axis: .vertical)
                        .lineLimit(3...8)
                }
            }
            .navigationTitle(esistente == nil ? "Nuovo ticket" : "Modifica ticket")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Salva", action: salva)
                        .disabled(!puoSalvare)
                }
            }
            .onAppear {
                guard esistente == nil, clienteID.isEmpty, let primo = clienti.first else { return }
                clienteID = primo.id
            }
        }
        .frame(minWidth: 560, minHeight: 620)
    }

    private func salva() {
        guard let tecnicoID = sessione.tecnicoID else { return }
        let titoloPulito = titolo.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !titoloPulito.isEmpty, !clienteID.isEmpty else { return }
        let record = Ticket(
            id: esistente?.id ?? UUID().uuidString,
            titolo: titoloPulito,
            descrizione: descrizione.trimmingCharacters(in: .whitespacesAndNewlines),
            clienteID: clienteID,
            tecnicoID: esistente?.tecnicoID ?? tecnicoID,
            stato: stato,
            priorita: priorita,
            risposte: esistente?.risposte ?? [],
            aperto: esistente?.aperto ?? .now,
            aggiornato: .now
        )
        archivio.salvaTicket(record, tecnicoID: tecnicoID)
        onSalvato(record.id)
        dismiss()
    }
}

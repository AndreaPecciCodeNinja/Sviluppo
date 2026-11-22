import SwiftUI

enum FiltroIntervento: String, CaseIterable, Identifiable {
    case tutti
    case programmato
    case inCorso
    case inAttesa
    case completato
    case annullato

    var id: String { rawValue }

    var titolo: String {
        switch self {
        case .tutti: return "Tutti"
        case .programmato: return "Programmati"
        case .inCorso: return "In corso"
        case .inAttesa: return "In attesa"
        case .completato: return "Completati"
        case .annullato: return "Annullati"
        }
    }

    var stato: StatoIntervento? {
        switch self {
        case .tutti: return nil
        case .programmato: return .programmato
        case .inCorso: return .inCorso
        case .inAttesa: return .inAttesa
        case .completato: return .completato
        case .annullato: return .annullato
        }
    }
}

struct VistaInterventi: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    @Binding var selezione: String?
    @State private var query = ""
    @State private var filtro: FiltroIntervento = .tutti
    @State private var nuovo = false

    private var tecnicoID: String? { sessione.tecnicoID }

    private var assegnati: [Intervento] {
        guard let tecnicoID else { return [] }
        return archivio.interventiAssegnati(a: tecnicoID)
    }

    private var filtrati: [Intervento] {
        let ago = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return assegnati
            .filter { intervento in
                (filtro.stato == nil || intervento.stato == filtro.stato) && corrisponde(intervento, ago: ago)
            }
            .sorted { lhs, rhs in
                if lhs.stato.chiuso != rhs.stato.chiuso { return !lhs.stato.chiuso }
                if lhs.appuntamento != rhs.appuntamento { return lhs.appuntamento < rhs.appuntamento }
                return lhs.titolo.localizedStandardCompare(rhs.titolo) == .orderedAscending
            }
    }

    var body: some View {
        List(selection: $selezione) {
            Section {
                ForEach(filtrati) { intervento in
                    Button {
                        selezione = intervento.id
                    } label: {
                        riga(intervento)
                    }
                    .buttonStyle(.plain)
                    .tag(intervento.id)
                    .contextMenu {
                            ForEach(StatoIntervento.allCases) { stato in
                                Button(stato.titolo) {
                                    guard let tecnicoID else { return }
                                    archivio.aggiornaStatoIntervento(id: intervento.id, tecnicoID: tecnicoID, stato: stato)
                                }
                            }
                        }
                }
            } footer: {
                Text("Tocca un intervento per aprirlo, aggiornare lo stato e scrivere le note.")
            }
        }
        .listStyle(.inset)
        .navigationTitle("Interventi")
        .searchable(text: $query, prompt: "Cerca titolo, cliente o indirizzo")
        .overlay {
            if filtrati.isEmpty {
                SezioneVuota(
                    titolo: assegnati.isEmpty ? "Nessun intervento assegnato" : "Nessun risultato",
                    dettaglio: assegnati.isEmpty
                        ? "Importa un elenco oppure crea un intervento."
                        : "Prova un altro stato o un'altra ricerca.",
                    simbolo: "wrench.and.screwdriver"
                )
            }
        }
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Picker("Stato", selection: $filtro) {
                    ForEach(FiltroIntervento.allCases) { filtro in
                        Text(filtro.titolo).tag(filtro)
                    }
                }
                .pickerStyle(.menu)
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    nuovo = true
                } label: {
                    Label("Nuovo intervento", systemImage: "plus")
                }
                .keyboardShortcut("n", modifiers: .command)
            }
        }
        .sheet(isPresented: $nuovo) {
            EditorIntervento(esistente: nil) { id in
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

    private func riga(_ intervento: Intervento) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(intervento.titolo)
                    .font(.headline)
                    .lineLimit(2)
                Text(etichettaCliente(intervento.clienteID))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Label(Formato.appuntamento(intervento.appuntamento), systemImage: "calendar")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                Etichetta(testo: intervento.stato.titolo, colore: Tinta.stato(intervento.stato))
                Etichetta(testo: intervento.priorita.titolo, colore: Tinta.priorita(intervento.priorita))
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

    private func corrisponde(_ intervento: Intervento, ago: String) -> Bool {
        guard !ago.isEmpty else { return true }
        guard let tecnicoID else { return false }
        let cliente = archivio.cliente(id: intervento.clienteID, visibileA: tecnicoID)
        let campi = [
            intervento.titolo,
            intervento.descrizione,
            intervento.indirizzo,
            cliente?.nome ?? "",
            cliente?.referente ?? "",
            intervento.note.map(\.testo).joined(separator: " ")
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

struct DettaglioIntervento: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    var id: String
    var onApriCliente: (String) -> Void
    @State private var modifica = false
    @State private var bozza = ""

    private var tecnicoID: String? { sessione.tecnicoID }

    var body: some View {
        if let tecnicoID, let intervento = archivio.intervento(id: id, visibileA: tecnicoID) {
            contenuto(intervento, tecnicoID: tecnicoID)
        } else {
            SezioneVuota(
                titolo: "Intervento non disponibile",
                dettaglio: "Questo intervento non è assegnato al tuo logon.",
                simbolo: "wrench.and.screwdriver"
            )
        }
    }

    private func contenuto(_ intervento: Intervento, tecnicoID: String) -> some View {
        let cliente = archivio.cliente(id: intervento.clienteID, visibileA: tecnicoID)
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Etichetta(testo: intervento.stato.titolo, colore: Tinta.stato(intervento.stato))
                        Etichetta(testo: intervento.priorita.titolo, colore: Tinta.priorita(intervento.priorita))
                        Spacer()
                        Text(intervento.id)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    Text(intervento.titolo)
                        .font(.largeTitle.weight(.semibold))
                    if let cliente {
                        Button(etichetta(cliente)) {
                            onApriCliente(cliente.id)
                        }
                        .buttonStyle(.plain)
                        .font(.title3)
                        .foregroundStyle(Color.accentColor)
                    }
                    if intervento.stato == .programmato && intervento.appuntamento < .now {
                        Label("L'appuntamento è passato", systemImage: "clock")
                            .font(.subheadline)
                            .foregroundStyle(.orange)
                    }
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                    SchedaInfo(titolo: "Appuntamento", valore: Formato.appuntamento(intervento.appuntamento), simbolo: "calendar")
                    SchedaInfo(titolo: "Utente", valore: cliente?.referente ?? "", simbolo: "person")
                    SchedaInfo(titolo: "Indirizzo", valore: intervento.indirizzo, simbolo: "mappin.and.ellipse")
                    SchedaInfo(titolo: "Telefono", valore: cliente?.telefono ?? "", simbolo: "phone", destinazione: Collegamenti.telefono(cliente?.telefono ?? ""))
                    SchedaInfo(titolo: "Aggiornato", valore: Formato.dataOra(intervento.aggiornato), simbolo: "clock")
                }

                if !intervento.descrizione.isEmpty {
                    BloccoTesto(titolo: "Descrizione", testo: intervento.descrizione)
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("Esecuzione")
                        .font(.headline)
                    HStack(spacing: 12) {
                        Button {
                            archivio.aggiornaStatoIntervento(id: intervento.id, tecnicoID: tecnicoID, stato: .inCorso)
                        } label: {
                            Label("In corso", systemImage: intervento.stato == .inCorso ? "checkmark" : "play.fill")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.orange)
                        .disabled(intervento.stato == .inCorso)

                        Button {
                            archivio.aggiornaStatoIntervento(id: intervento.id, tecnicoID: tecnicoID, stato: .completato)
                        } label: {
                            Label("Completato", systemImage: "checkmark")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                        .disabled(intervento.stato == .completato)

                        Button {
                            Task { await ClienteServer.sincronizza(archivio: archivio, sessione: sessione) }
                        } label: {
                            if archivio.sincronizzazioneInCorso {
                                ProgressView()
                            } else {
                                Label("Invia al server", systemImage: "arrow.up.circle")
                            }
                        }
                        .buttonStyle(.bordered)
                        .disabled(archivio.sincronizzazioneInCorso)
                    }
                    Text("Lo stato e le note restano su questo iPad. L'invio usa la sincronizzazione e parte se la demo risponde.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let messaggio = archivio.messaggioSincronizzazione {
                        Banner(testo: messaggio, simbolo: "arrow.up.circle", colore: Tinta.marchio)
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Note")
                        .font(.headline)
                    if intervento.note.isEmpty {
                        Text("Nessuna nota. Aggiungi cosa hai fatto in sede.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(intervento.note.sorted { $0.data < $1.data }) { nota in
                            BollaMessaggio(messaggio: nota)
                        }
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 900, alignment: .leading)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(intervento.titolo)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            HStack(alignment: .bottom, spacing: 12) {
                TextField("Nota di quello che hai fatto", text: $bozza, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                Button("Aggiungi") {
                    let autore = archivio.tecnico(id: tecnicoID)?.nome ?? "Tecnico"
                    archivio.aggiungiNota(interventoID: intervento.id, tecnicoID: tecnicoID, testo: bozza, autore: autore)
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
                    ForEach(StatoIntervento.allCases) { stato in
                        Button {
                            archivio.aggiornaStatoIntervento(id: intervento.id, tecnicoID: tecnicoID, stato: stato)
                        } label: {
                            if stato == intervento.stato {
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
            EditorIntervento(esistente: intervento)
        }
    }

    private func etichetta(_ cliente: Cliente) -> String {
        cliente.referente.isEmpty ? cliente.nome : "\(cliente.nome) · \(cliente.referente)"
    }
}

struct EditorIntervento: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    @Environment(\.dismiss) private var dismiss

    var esistente: Intervento?
    var clientePreselezionato: String?
    var onSalvato: (String) -> Void

    @State private var titolo: String
    @State private var descrizione: String
    @State private var clienteID: String
    @State private var indirizzo: String
    @State private var appuntamento: Date
    @State private var priorita: Priorita
    @State private var stato: StatoIntervento
    @State private var ultimoClienteID: String

    init(esistente: Intervento? = nil, clientePreselezionato: String? = nil, onSalvato: @escaping (String) -> Void = { _ in }) {
        self.esistente = esistente
        self.clientePreselezionato = clientePreselezionato
        self.onSalvato = onSalvato
        let cliente = esistente?.clienteID ?? clientePreselezionato ?? ""
        _titolo = State(initialValue: esistente?.titolo ?? "")
        _descrizione = State(initialValue: esistente?.descrizione ?? "")
        _clienteID = State(initialValue: cliente)
        _indirizzo = State(initialValue: esistente?.indirizzo ?? "")
        _appuntamento = State(initialValue: esistente?.appuntamento ?? Formato.prossimaOra())
        _priorita = State(initialValue: esistente?.priorita ?? .media)
        _stato = State(initialValue: esistente?.stato ?? .programmato)
        _ultimoClienteID = State(initialValue: cliente)
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
                Section("Intervento") {
                    TextField("Titolo", text: $titolo)
                    Picker("Cliente", selection: $clienteID) {
                        Text("Seleziona un cliente").tag("")
                        ForEach(clienti) { cliente in
                            Text(etichetta(cliente)).tag(cliente.id)
                        }
                    }
                    TextField("Indirizzo", text: $indirizzo, axis: .vertical)
                        .lineLimit(1...3)
                }
                Section("Pianificazione") {
                    DatePicker("Appuntamento", selection: $appuntamento, displayedComponents: [.date, .hourAndMinute])
                    Picker("Priorità", selection: $priorita) {
                        ForEach(Priorita.allCases) { priorita in
                            Text(priorita.titolo).tag(priorita)
                        }
                    }
                    Picker("Stato", selection: $stato) {
                        ForEach(StatoIntervento.allCases) { stato in
                            Text(stato.titolo).tag(stato)
                        }
                    }
                }
                Section("Descrizione") {
                    TextField("Cosa va fatto", text: $descrizione, axis: .vertical)
                        .lineLimit(3...8)
                }
            }
            .navigationTitle(esistente == nil ? "Nuovo intervento" : "Modifica intervento")
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
            .onAppear(perform: preparaCliente)
            .onChange(of: clienteID) { _, nuovo in
                guard let tecnicoID = sessione.tecnicoID else { return }
                let precedente = archivio.cliente(id: ultimoClienteID, visibileA: tecnicoID)
                let prossimo = archivio.cliente(id: nuovo, visibileA: tecnicoID)
                if indirizzo.isEmpty || indirizzo == precedente?.indirizzo {
                    indirizzo = prossimo?.indirizzo ?? indirizzo
                }
                ultimoClienteID = nuovo
            }
        }
        .frame(minWidth: 560, minHeight: 640)
    }

    private func etichetta(_ cliente: Cliente) -> String {
        cliente.referente.isEmpty ? cliente.nome : "\(cliente.nome) · \(cliente.referente)"
    }

    private func preparaCliente() {
        guard esistente == nil, clienteID.isEmpty, let primo = clienti.first else { return }
        clienteID = primo.id
        ultimoClienteID = primo.id
        if indirizzo.isEmpty { indirizzo = primo.indirizzo }
    }

    private func salva() {
        guard let tecnicoID = sessione.tecnicoID else { return }
        let titoloPulito = titolo.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !titoloPulito.isEmpty, !clienteID.isEmpty else { return }
        let record = Intervento(
            id: esistente?.id ?? UUID().uuidString,
            titolo: titoloPulito,
            descrizione: descrizione.trimmingCharacters(in: .whitespacesAndNewlines),
            clienteID: clienteID,
            tecnicoID: esistente?.tecnicoID ?? tecnicoID,
            stato: stato,
            priorita: priorita,
            appuntamento: appuntamento,
            indirizzo: indirizzo.trimmingCharacters(in: .whitespacesAndNewlines),
            note: esistente?.note ?? [],
            aggiornato: .now
        )
        archivio.salvaIntervento(record, tecnicoID: tecnicoID)
        onSalvato(record.id)
        dismiss()
    }
}

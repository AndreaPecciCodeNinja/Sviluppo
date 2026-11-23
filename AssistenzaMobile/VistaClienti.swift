import SwiftUI

struct VistaClienti: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    @Binding var selezione: String?
    @State private var query = ""
    @State private var nuovo = false

    private var tecnicoID: String? { sessione.tecnicoID }

    private var assegnati: [Cliente] {
        guard let tecnicoID else { return [] }
        return archivio.clientiAssegnati(a: tecnicoID)
    }

    private var filtrati: [Cliente] {
        let ago = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !ago.isEmpty else { return assegnati }
        return assegnati.filter { cliente in
            [cliente.nome, cliente.referente, cliente.indirizzo, cliente.telefono, cliente.email, cliente.note]
                .contains { $0.range(of: ago, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
        }
    }

    var body: some View {
        List(selection: $selezione) {
            Section {
                ForEach(filtrati) { cliente in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(cliente.nome)
                            .font(.headline)
                        Text(cliente.referente.isEmpty ? "Nessun utente di riferimento" : cliente.referente)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if !cliente.indirizzo.isEmpty {
                            Text(cliente.indirizzo)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .padding(.vertical, 4)
                    .tag(cliente.id)
                }
            } footer: {
                Text("Solo i clienti e gli utenti assegnati al tuo logon.")
            }
        }
        .listStyle(.inset)
        .navigationTitle("Clienti")
        .searchable(text: $query, prompt: "Cerca cliente o utente")
        .overlay {
            if filtrati.isEmpty {
                SezioneVuota(
                    titolo: assegnati.isEmpty ? "Nessun cliente assegnato" : "Nessun risultato",
                    dettaglio: assegnati.isEmpty
                        ? "Importa un elenco oppure aggiungi un cliente."
                        : "Prova un altro nome.",
                    simbolo: "person.2"
                )
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    nuovo = true
                } label: {
                    Label("Nuovo cliente", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $nuovo) {
            EditorCliente(esistente: nil) { id in
                query = ""
                selezione = id
            }
        }
        .onAppear(perform: allineaSelezione)
        .onChange(of: filtrati.map(\.id)) { _, _ in
            allineaSelezione()
        }
    }

    private func allineaSelezione() {
        if let selezione, filtrati.contains(where: { $0.id == selezione }) { return }
        selezione = filtrati.first?.id
    }
}

struct DettaglioCliente: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    var id: String
    var onApriIntervento: (String) -> Void
    var onApriTicket: (String) -> Void
    @State private var modifica = false
    @State private var nuovoIntervento = false
    @State private var nuovoTicket = false

    private var tecnicoID: String? { sessione.tecnicoID }

    var body: some View {
        if let tecnicoID, let cliente = archivio.cliente(id: id, visibileA: tecnicoID) {
            contenuto(cliente, tecnicoID: tecnicoID)
        } else {
            SezioneVuota(
                titolo: "Cliente non disponibile",
                dettaglio: "Questo cliente non è assegnato al tuo logon.",
                simbolo: "person.2"
            )
        }
    }

    private func contenuto(_ cliente: Cliente, tecnicoID: String) -> some View {
        let interventi = archivio.interventiAssegnati(a: tecnicoID)
            .filter { $0.clienteID == cliente.id }
            .sorted { $0.appuntamento < $1.appuntamento }
        let ticket = archivio.ticketAssegnati(a: tecnicoID)
            .filter { $0.clienteID == cliente.id }
            .sorted { $0.aggiornato > $1.aggiornato }
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(cliente.nome)
                        .font(.largeTitle.weight(.semibold))
                    Text(cliente.referente.isEmpty ? "Nessun utente di riferimento" : cliente.referente)
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                    SchedaInfo(titolo: "Utente di riferimento", valore: cliente.referente, simbolo: "person")
                    SchedaInfo(titolo: "Telefono", valore: cliente.telefono, simbolo: "phone", destinazione: Collegamenti.telefono(cliente.telefono))
                    SchedaInfo(titolo: "Email", valore: cliente.email, simbolo: "envelope", destinazione: Collegamenti.email(cliente.email))
                    SchedaInfo(titolo: "Indirizzo", valore: cliente.indirizzo, simbolo: "mappin.and.ellipse")
                }
                if !cliente.note.isEmpty {
                    BloccoTesto(titolo: "Note", testo: cliente.note)
                }
                elencoLavori(
                    titolo: "Interventi",
                    vuoto: "Nessun intervento per questo cliente.",
                    righe: interventi.map { lavoro in
                        RigaLavoro(
                            id: lavoro.id,
                            titolo: lavoro.titolo,
                            dettaglio: Formato.appuntamento(lavoro.appuntamento),
                            etichetta: lavoro.stato.titolo,
                            colore: Tinta.stato(lavoro.stato)
                        )
                    },
                    apri: onApriIntervento
                )
                elencoLavori(
                    titolo: "Ticket",
                    vuoto: "Nessun ticket per questo cliente.",
                    righe: ticket.map { lavoro in
                        RigaLavoro(
                            id: lavoro.id,
                            titolo: lavoro.titolo,
                            dettaglio: "\(lavoro.risposte.count) risposte",
                            etichetta: lavoro.stato.titolo,
                            colore: Tinta.stato(lavoro.stato)
                        )
                    },
                    apri: onApriTicket
                )
            }
            .padding(24)
            .frame(maxWidth: 900, alignment: .leading)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(cliente.nome)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Nuovo intervento") { nuovoIntervento = true }
                    Button("Nuovo ticket") { nuovoTicket = true }
                } label: {
                    Label("Nuovo", systemImage: "plus")
                }
            }
            ToolbarItem(placement: .automatic) {
                Button("Modifica") { modifica = true }
            }
        }
        .sheet(isPresented: $modifica) {
            EditorCliente(esistente: cliente)
        }
        .sheet(isPresented: $nuovoIntervento) {
            EditorIntervento(clientePreselezionato: cliente.id) { id in
                onApriIntervento(id)
            }
        }
        .sheet(isPresented: $nuovoTicket) {
            EditorTicket(clientePreselezionato: cliente.id) { id in
                onApriTicket(id)
            }
        }
    }

    private func elencoLavori(titolo: String, vuoto: String, righe: [RigaLavoro], apri: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(titolo)
                .font(.headline)
            if righe.isEmpty {
                Text(vuoto)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(righe) { riga in
                    Button {
                        apri(riga.id)
                    } label: {
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(riga.titolo)
                                    .font(.body)
                                    .foregroundStyle(.primary)
                                Text(riga.dettaglio)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Etichetta(testo: riga.etichetta, colore: riga.colore)
                        }
                        .padding(12)
                        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct RigaLavoro: Identifiable {
    var id: String
    var titolo: String
    var dettaglio: String
    var etichetta: String
    var colore: Color
}

struct EditorCliente: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    @Environment(\.dismiss) private var dismiss

    var esistente: Cliente?
    var onSalvato: (String) -> Void

    @State private var nome: String
    @State private var referente: String
    @State private var telefono: String
    @State private var email: String
    @State private var indirizzo: String
    @State private var note: String

    init(esistente: Cliente? = nil, onSalvato: @escaping (String) -> Void = { _ in }) {
        self.esistente = esistente
        self.onSalvato = onSalvato
        _nome = State(initialValue: esistente?.nome ?? "")
        _referente = State(initialValue: esistente?.referente ?? "")
        _telefono = State(initialValue: esistente?.telefono ?? "")
        _email = State(initialValue: esistente?.email ?? "")
        _indirizzo = State(initialValue: esistente?.indirizzo ?? "")
        _note = State(initialValue: esistente?.note ?? "")
    }

    private var puoSalvare: Bool {
        !nome.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Cliente") {
                    TextField("Nome del cliente", text: $nome)
                    TextField("Utente di riferimento", text: $referente)
                }
                Section("Contatti") {
                    TextField("Telefono", text: $telefono)
                        .keyboardType(.phonePad)
                    TextField("Email", text: $email)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .autocorrectionDisabled()
                    TextField("Indirizzo", text: $indirizzo, axis: .vertical)
                        .lineLimit(1...3)
                }
                Section("Note") {
                    TextField("Indicazioni per arrivare o per il referente", text: $note, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(esistente == nil ? "Nuovo cliente" : "Modifica cliente")
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
        }
        .frame(minWidth: 560, minHeight: 620)
    }

    private func salva() {
        guard let tecnicoID = sessione.tecnicoID else { return }
        let nomePulito = nome.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !nomePulito.isEmpty else { return }
        let record = Cliente(
            id: esistente?.id ?? UUID().uuidString,
            nome: nomePulito,
            referente: referente.trimmingCharacters(in: .whitespacesAndNewlines),
            telefono: telefono.trimmingCharacters(in: .whitespacesAndNewlines),
            email: email.trimmingCharacters(in: .whitespacesAndNewlines),
            indirizzo: indirizzo.trimmingCharacters(in: .whitespacesAndNewlines),
            note: note.trimmingCharacters(in: .whitespacesAndNewlines),
            tecnicoID: esistente?.tecnicoID ?? tecnicoID
        )
        archivio.salvaCliente(record, tecnicoID: tecnicoID)
        onSalvato(record.id)
        dismiss()
    }
}

import SwiftUI

struct VistaSincronizzazione: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    @State private var url = ClienteServer.urlTesto

    private var logon: String {
        guard let id = sessione.tecnicoID, let tecnico = archivio.tecnico(id: id) else { return "" }
        return tecnico.logon
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Dopo il lavoro senza rete, invia al server lo stato degli interventi, le note e le risposte dei ticket di \(logon.isEmpty ? "questo tecnico" : logon). L'iPad continua a funzionare anche se il server non risponde.")
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Server")
                        .font(.subheadline.weight(.semibold))
                    TextField("http://127.0.0.1:3012", text: $url)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    Text("Predefinito: \(ClienteServer.urlPredefinito). È l'origine della demo Assistenza Tecnica Demo, porta 3012.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let messaggio = archivio.messaggioSincronizzazione {
                    Banner(
                        testo: messaggio,
                        simbolo: archivio.sincronizzazioneInCorso ? "arrow.triangle.2.circlepath" : "externaldrive",
                        colore: messaggio.localizedCaseInsensitiveContains("non raggiungibile")
                            || messaggio.localizedCaseInsensitiveContains("non è")
                            || messaggio.localizedCaseInsensitiveContains("ha risposto")
                            ? .orange
                            : Tinta.marchio
                    )
                }

                Button {
                    ClienteServer.urlTesto = url
                    url = ClienteServer.urlTesto
                    Task { await ClienteServer.sincronizza(archivio: archivio, sessione: sessione) }
                } label: {
                    if archivio.sincronizzazioneInCorso {
                        ProgressView()
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        Label("Sincronizza con la demo", systemImage: "arrow.triangle.2.circlepath")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Tinta.marchio)
                .disabled(archivio.sincronizzazioneInCorso || logon.isEmpty)
            }
            .padding(24)
            .frame(maxWidth: 640, alignment: .leading)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Sincronizzazione")
        .onDisappear {
            ClienteServer.urlTesto = url
        }
    }
}

struct GuidaSincronizzazione: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("La demo «Assistenza Tecnica Demo» non è in questo checkout né sugli altri branch. L'app parla con l'origine indicata, in modo predefinito \(ClienteServer.urlPredefinito).")
                .foregroundStyle(.secondary)

            voce("Scarica", "GET /api/tecnici/{logon}/assegnazioni")
            Text("La risposta è lo stesso JSON dell'importazione: tecnici, clienti o utenti, interventi e ticket del tecnico che ha fatto l'accesso. Le note già scritte sull'iPad restano. Lo stato modificato offline non viene sostituito da quello più vecchio del server.")
                .font(.callout)
                .foregroundStyle(.secondary)

            voce("Invia", "POST /api/sincronizzazione")
            Text("Il corpo contiene solo il tecnico loggato: per ogni intervento id, stato, aggiornato e note; per ogni ticket id, stato, aggiornato e risposte. Le date sono ISO 8601. Non parte la password.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Text("Manca il programma del server in questo repository. Finché quelle due rotte non rispondono, la sincronizzazione si ferma e l'archivio locale resta com'è. Con la rete assente l'iPad si usa lo stesso.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(maxWidth: 560, alignment: .leading)
    }

    private func voce(_ titolo: String, _ testo: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(titolo)
                .font(.headline)
            Text(testo)
                .font(.body.monospaced())
                .textSelection(.enabled)
        }
    }
}

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
            Text("La demo è il server in demo-assistenza, in ascolto su \(ClienteServer.urlPredefinito). Si avvia con node demo-assistenza/server.mjs.")
                .foregroundStyle(.secondary)

            voce("Scarica", "GET /api/tecnici/{logon}/assegnazioni")
            Text("La risposta è lo stesso JSON dell'importazione: tecnici, clienti o utenti, interventi e ticket del tecnico che ha fatto l'accesso. Le note già scritte sull'iPad restano. Lo stato modificato offline non viene sostituito da quello più vecchio del server.")
                .font(.callout)
                .foregroundStyle(.secondary)

            voce("Ticket eseguiti", "GET /api/tecnici/{logon}/ticket-eseguiti")
            Text("In Ticket, Scarica eseguiti salva sull'iPad i ticket risolti o chiusi del tecnico che ha fatto l'accesso. Lo stato completato sul server resta.")
                .font(.callout)
                .foregroundStyle(.secondary)

            voce("Invia", "POST /api/sincronizzazione")
            Text("Il corpo contiene solo il tecnico loggato: per ogni intervento id, stato, aggiornato e note; per ogni ticket id, stato, aggiornato e risposte. Le date sono ISO 8601. Non parte la password.")
                .font(.callout)
                .foregroundStyle(.secondary)

            Text("I dati del server restano in demo-assistenza/dati/archivio.json. Se il server è spento, l'iPad continua con l'archivio locale.")
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

import SwiftUI
import UniformTypeIdentifiers

struct VistaImportazione: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    @State private var scegliFile = false
    @State private var fileDocumenti: [URL] = []

    private var logonCorrente: String? {
        guard let id = sessione.tecnicoID else { return nil }
        return archivio.tecnico(id: id)?.logon
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Trasferisci l'elenco degli interventi assegnati. Il file viene letto e salvato su questo iPad.")
                    .foregroundStyle(.secondary)

                esito

                VStack(alignment: .leading, spacing: 12) {
                    Button {
                        scegliFile = true
                    } label: {
                        Label("Scegli un file JSON", systemImage: "folder")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Tinta.marchio)

                    Button {
                        importaRisorsa("assegnazioni-paolo-conti")
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Importa l'esempio di Paolo Conti")
                            Text("Crea il logon paolo.conti")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.bordered)

                    Button {
                        importaRisorsa("interventi-marco-bianchi")
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Importa un intervento per Marco Bianchi")
                            Text("Compare nell'elenco se sei entrato come marco.bianchi")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.bordered)
                }

                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("File in Documenti")
                            .font(.headline)
                        Spacer()
                        Button("Aggiorna elenco") { ricaricaDocumenti() }
                    }
                    Text("Con l'iPad collegato a un Mac: in Finder scegli l'iPad, poi Documenti, Assistenza, e copia il JSON. Sul simulatore puoi anche trascinare il file nella finestra e sceglierlo da File.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if fileDocumenti.isEmpty {
                        Text("Nessun JSON nella cartella Documenti dell'app.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(fileDocumenti, id: \.path) { url in
                            HStack {
                                Label(url.lastPathComponent, systemImage: "doc.text")
                                    .lineLimit(1)
                                Spacer()
                                Button("Importa") {
                                    _ = archivio.importaFile(da: url)
                                }
                            }
                        }
                    }
                }

                DisclosureGroup("Formato del file JSON") {
                    GuidaImportazione()
                }
            }
            .padding(24)
            .frame(maxWidth: 640, alignment: .leading)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Importazione")
        .onAppear(perform: ricaricaDocumenti)
        .fileImporter(isPresented: $scegliFile, allowedContentTypes: [.json], allowsMultipleSelection: false) { risultato in
            switch risultato {
            case .success(let urls):
                guard let url = urls.first else { return }
                _ = archivio.importaFile(da: url)
                ricaricaDocumenti()
            case .failure(let errore):
                if (errore as? CocoaError)?.code == .userCancelled { return }
                archivio.ultimoEsito = nil
                archivio.ultimoErroreImportazione = "Non è stato possibile aprire il file scelto."
            }
        }
    }

    @ViewBuilder
    private var esito: some View {
        if let errore = archivio.ultimoErroreImportazione {
            Banner(testo: errore, simbolo: "exclamationmark.triangle", colore: .red)
        } else if let esito = archivio.ultimoEsito {
            VStack(alignment: .leading, spacing: 8) {
                if let nome = archivio.ultimoNomeFile {
                    Text(nome)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Banner(
                    testo: esito.riepilogo(logonCorrente: logonCorrente),
                    simbolo: "checkmark.circle",
                    colore: .green
                )
                if !esito.avvisi.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(esito.avvisi.enumerated()), id: \.offset) { _, avviso in
                            Text("• \(avviso)")
                                .font(.caption)
                        }
                    }
                }
            }
        }
    }

    private func importaRisorsa(_ nome: String) {
        guard let url = Bundle.main.url(forResource: nome, withExtension: "json") else {
            archivio.ultimoEsito = nil
            archivio.ultimoErroreImportazione = "Esempio non trovato nell'app."
            return
        }
        _ = archivio.importaFile(da: url)
    }

    private func ricaricaDocumenti() {
        let documenti = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: documenti ?? URL(fileURLWithPath: "/"),
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )) ?? []
        fileDocumenti = urls
            .filter { $0.pathExtension.lowercased() == "json" }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }
}

struct GuidaImportazione: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
                Text("Formato del file")
                    .font(.title2.weight(.semibold))
                Text("Il file resta sul dispositivo. Un intervento già presente, con lo stesso id, viene aggiornato e le note scritte sull'iPad restano. La password di un tecnico si registra solo la prima volta che il logon compare nel file.")
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 8) {
                    voce("tecnici", "logon, nome, password. Serve solo per un logon nuovo.")
                    voce("clienti oppure utenti", "id, nome, referente, telefono, email, indirizzo, note, logonTecnico.")
                    voce("interventi", "id, titolo, descrizione, clienteId oppure cliente, logonTecnico, stato, priorita, appuntamento, indirizzo, note.")
                    voce("ticket", "id, titolo, descrizione, clienteId, logonTecnico, stato, priorita, risposte.")
                }
                Text("Stati intervento: programmato, in_corso, in_attesa, completato, annullato.")
                Text("Stati ticket: aperto, in_lavorazione, in_attesa_cliente, risolto, chiuso.")
                Text("Priorità: bassa, media, alta, urgente.")
                Text("L'appuntamento è una data ISO 8601, per esempio 2026-11-23T09:30:00+01:00. Puoi anche passare un elenco di soli interventi.")
                Text(EsempioFormato.testo)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
            }
            .padding(24)
            .frame(maxWidth: 720, alignment: .leading)
    }

    private func voce(_ titolo: String, _ dettaglio: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(titolo)
                .font(.subheadline.weight(.semibold))
            Text(dettaglio)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

enum EsempioFormato {
    static let testo = """
    {
      "interventi": [
        {
          "id": "int-100",
          "titolo": "Sostituzione router",
          "descrizione": "Il router si spegne da solo.",
          "logonTecnico": "marco.bianchi",
          "stato": "programmato",
          "priorita": "alta",
          "appuntamento": "2026-11-23T09:30:00+01:00",
          "indirizzo": "Via Roma 12, Roma",
          "cliente": {
            "id": "cli-100",
            "nome": "Studio Rossi",
            "referente": "Anna Rossi",
            "telefono": "+39 06 555 0199"
          },
          "note": [
            { "testo": "Portare un ricambio", "autore": "Coordinamento" }
          ]
        }
      ]
    }
    """
}

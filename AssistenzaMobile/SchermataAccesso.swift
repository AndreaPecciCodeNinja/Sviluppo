import SwiftUI

struct SchermataAccesso: View {
    @Environment(ArchivioLocale.self) private var archivio
    @Environment(SessioneTecnico.self) private var sessione
    @Environment(\.horizontalSizeClass) private var classeLarghezza
    @State private var logon = ""
    @State private var password = ""
    @State private var mostraErrore = false
    @FocusState private var campo: Campo?

    private enum Campo: Hashable {
        case logon
        case password
    }

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            if classeLarghezza == .compact {
                ScrollView {
                    VStack(spacing: 0) {
                        marchio
                        modulo
                    }
                }
            } else {
                HStack(spacing: 0) {
                    marchio
                    modulo
                }
                .frame(maxWidth: 1000, maxHeight: 660)
                .background(Color(.systemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 28))
                .shadow(color: .black.opacity(0.12), radius: 28, y: 10)
                .padding(32)
            }
        }
        .onAppear {
            campo = .logon
        }
    }

    private var marchio: some View {
        VStack(alignment: .leading, spacing: 28) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "wrench.and.screwdriver")
                    .font(.system(size: 36, weight: .semibold))
                Text("Assistenza")
                    .font(.largeTitle.weight(.bold))
                Text("Interventi sul campo e ticket, sullo stesso iPad.")
                    .font(.title3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 16) {
                rigaMarchio("wifi.slash", "Funziona offline. I dati restano su questo iPad.")
                rigaMarchio("person.crop.circle.badge.checkmark", "Ogni tecnico vede solo i clienti e gli interventi assegnati a lui.")
                rigaMarchio("square.and.arrow.down", "L'elenco degli interventi si importa da un file JSON locale.")
            }
            Spacer(minLength: 12)
            Text("Accesso locale del tecnico.")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.85))
        }
        .padding(36)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(Tinta.marchio)
        .foregroundStyle(.white)
    }

    private func rigaMarchio(_ simbolo: String, _ testo: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: simbolo)
                .frame(width: 22)
            Text(testo)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.body)
    }

    private var modulo: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Entra")
                    .font(.title.weight(.semibold))
                Text("Usa il logon assegnato a te. Non è un account online.")
                    .foregroundStyle(.secondary)
            }

            if let esito = archivio.ultimoEsito, archivio.ultimoErroreImportazione == nil {
                Banner(
                    testo: esito.riepilogo(logonCorrente: nil),
                    simbolo: "checkmark.circle",
                    colore: .green
                )
            } else if let errore = archivio.ultimoErroreImportazione {
                Banner(testo: errore, simbolo: "exclamationmark.triangle", colore: .red)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Logon")
                    .font(.subheadline.weight(.semibold))
                TextField("nome.cognome", text: $logon)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($campo, equals: .logon)
                    .submitLabel(.next)
                    .onSubmit { campo = .password }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Password")
                    .font(.subheadline.weight(.semibold))
                SecureField("Password", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .focused($campo, equals: .password)
                    .submitLabel(.go)
                    .onSubmit(accedi)
            }

            if mostraErrore {
                Text("Logon o password non corretti.")
                    .font(.subheadline)
                    .foregroundStyle(.red)
            }

            Button("Entra", action: accedi)
                .buttonStyle(.borderedProminent)
                .tint(Tinta.marchio)
                .keyboardShortcut(.defaultAction)
                .disabled(logon.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)

            Spacer(minLength: 8)

            VStack(alignment: .leading, spacing: 4) {
                Text("Accessi dimostrativi, solo su questo iPad")
                    .font(.caption.weight(.semibold))
                Text("\(DatiDimostrativi.marco)  ·  \(DatiDimostrativi.lucia)")
                Text("Password: \(DatiDimostrativi.password)")
                Text("L'esempio di Paolo Conti aggiunge il logon paolo.conti con la stessa password.")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(36)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(Color(.systemBackground))
    }

    private func accedi() {
        let utente = logon.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        logon = utente
        guard !utente.isEmpty, !password.isEmpty else { return }
        if sessione.accedi(logon: utente, password: password) {
            mostraErrore = false
        } else {
            mostraErrore = true
            password = ""
            campo = .password
        }
    }
}

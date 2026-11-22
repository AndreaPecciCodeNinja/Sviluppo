import SwiftUI

enum Tinta {
    static let marchio = Color(red: 0.055, green: 0.302, blue: 0.365)
    static let marchioChiaro = Color(red: 0.561, green: 0.816, blue: 0.863)

    static func stato(_ stato: StatoIntervento) -> Color {
        switch stato {
        case .programmato: return .blue
        case .inCorso: return .orange
        case .inAttesa: return .purple
        case .completato: return .green
        case .annullato: return .secondary
        }
    }

    static func stato(_ stato: StatoTicket) -> Color {
        switch stato {
        case .aperto: return .blue
        case .inLavorazione: return .orange
        case .inAttesaCliente: return .purple
        case .risolto: return .green
        case .chiuso: return .secondary
        }
    }

    static func priorita(_ priorita: Priorita) -> Color {
        switch priorita {
        case .bassa: return .secondary
        case .media: return .blue
        case .alta: return .orange
        case .urgente: return .red
        }
    }
}

enum Formato {
    static let locale = Locale(identifier: "it_IT")

    static func dataOra(_ data: Date) -> String {
        data.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened).locale(locale))
    }

    static func ora(_ data: Date) -> String {
        data.formatted(Date.FormatStyle(time: .shortened).locale(locale))
    }

    static func appuntamento(_ data: Date) -> String {
        let calendario = Calendar.current
        let ora = ora(data)
        if calendario.isDateInToday(data) { return "Oggi \(ora)" }
        if calendario.isDateInTomorrow(data) { return "Domani \(ora)" }
        if calendario.isDateInYesterday(data) { return "Ieri \(ora)" }
        return dataOra(data)
    }

    static func prossimaOra() -> Date {
        let calendario = Calendar.current
        let traUnOra = Date().addingTimeInterval(3600)
        let componenti = calendario.dateComponents([.year, .month, .day, .hour], from: traUnOra)
        return calendario.date(from: componenti) ?? traUnOra
    }
}

struct Etichetta: View {
    var testo: String
    var colore: Color

    var body: some View {
        Text(testo)
            .font(.caption.weight(.semibold))
            .foregroundStyle(colore)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(colore.opacity(0.14), in: Capsule())
    }
}

struct SchedaInfo: View {
    var titolo: String
    var valore: String
    var simbolo: String
    var destinazione: URL?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: simbolo)
                .frame(width: 22)
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(titolo)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let destinazione, !valore.isEmpty {
                    Link(valore, destination: destinazione)
                        .textSelection(.enabled)
                } else {
                    Text(valore.isEmpty ? "—" : valore)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

struct BloccoTesto: View {
    var titolo: String
    var testo: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(titolo)
                .font(.headline)
            Text(testo)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }
}

struct BollaMessaggio: View {
    var messaggio: Annotazione

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.circle.fill")
                .font(.title2)
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(messaggio.autore)
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(Formato.dataOra(messaggio.data))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(messaggio.testo)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }
}

struct SezioneVuota: View {
    var titolo: String
    var dettaglio: String
    var simbolo: String

    var body: some View {
        ContentUnavailableView(titolo, systemImage: simbolo, description: Text(dettaglio))
    }
}

struct Banner: View {
    var testo: String
    var simbolo: String
    var colore: Color

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: simbolo)
            Text(testo)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.subheadline)
        .foregroundStyle(colore)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colore.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }
}

enum Collegamenti {
    static func telefono(_ numero: String) -> URL? {
        let cifre = numero.filter { $0.isNumber || $0 == "+" }
        guard !cifre.isEmpty else { return nil }
        return URL(string: "tel:\(cifre)")
    }

    static func email(_ email: String) -> URL? {
        let pulita = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard pulita.contains("@") else { return nil }
        var componenti = URLComponents()
        componenti.scheme = "mailto"
        componenti.path = pulita
        return componenti.url
    }
}

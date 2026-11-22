import SwiftUI

@main
struct AssistenzaMobileApp: App {
    @State private var modello = ModelloApplicazione()

    var body: some Scene {
        WindowGroup {
            VistaRadice(archivio: modello.archivio, sessione: modello.sessione)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemBackground))
        }
    }
}

@Observable
final class ModelloApplicazione {
    let archivio: ArchivioLocale
    let sessione: SessioneTecnico

    init() {
        let archivio = ArchivioLocale()
        self.archivio = archivio
        self.sessione = SessioneTecnico(archivio: archivio)
    }
}

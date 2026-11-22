import SwiftUI

@main
struct AssistenzaMobileApp: App {
    @State private var archivio: ArchivioLocale
    @State private var sessione: SessioneTecnico

    init() {
        let archivio = ArchivioLocale()
        _archivio = State(initialValue: archivio)
        _sessione = State(initialValue: SessioneTecnico(archivio: archivio))
    }

    var body: some Scene {
        WindowGroup {
            VistaRadice(archivio: archivio, sessione: sessione)
        }
    }
}

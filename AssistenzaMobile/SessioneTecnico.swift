import Foundation
import Observation

@Observable
final class SessioneTecnico {
    private let archivio: ArchivioLocale
    private(set) var tecnicoID: String?

    init(archivio: ArchivioLocale) {
        self.archivio = archivio
        if let id = archivio.sessioneTecnicoID, archivio.tecnico(id: id) != nil {
            tecnicoID = id
        }
    }

    func accedi(logon: String, password: String) -> Bool {
        let chiave = logon.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !chiave.isEmpty, !password.isEmpty,
              let tecnico = archivio.tecnico(logon: chiave),
              Impronta.di(password) == tecnico.passwordHash else {
            return false
        }
        tecnicoID = tecnico.id
        archivio.impostaSessione(tecnico.id)
        return true
    }

    func esci() {
        tecnicoID = nil
        archivio.impostaSessione(nil)
    }
}

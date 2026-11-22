import CryptoKit
import Foundation

enum Impronta {
    static func di(_ testo: String) -> String {
        let digest = SHA256.hash(data: Data(testo.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func breve(_ testo: String) -> String {
        String(di(testo).prefix(16))
    }
}

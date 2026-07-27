import CryptoKit
import Foundation

/// Gates the debug pane behind a PIN. This is a casual-use deterrent, not
/// cryptographic security — the hash lives in source so the plaintext PIN
/// doesn't, but this is a single-user personal app, not a security boundary.
enum DebugAccessGate {
    private static let expectedHashHex = "ae08ef776d536d49e5fea11b34a4f2cf981195fee6ec8cfb058ae2686a9d0166"

    static func matches(pin: String) -> Bool {
        let digest = SHA256.hash(data: Data(pin.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return hex == expectedHashHex
    }
}

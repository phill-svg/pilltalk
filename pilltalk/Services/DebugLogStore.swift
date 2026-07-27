import Foundation

/// Always-on debug log for the debug pane, independent of SecureLogger —
/// SecureLogger is fully compiled out of Release builds by DEBUG-only gating,
/// but this needs to work in the Release build this project actually ships.
/// Deliberately NOT wrapped in any DEBUG-only conditional compilation.
@MainActor
final class DebugLogStore: ObservableObject {
    struct Entry: Identifiable {
        let id = UUID()
        let timestamp: Date
        let category: String
        let message: String
    }

    private static let capacity = 500

    @Published private(set) var entries: [Entry] = []

    /// Explicit and `nonisolated`: the synthesized memberwise init on a
    /// `@MainActor` class is itself main-actor-isolated, which CI caught as
    /// a build error at `BLEService`'s `let debugLogStore = DebugLogStore()`
    /// (a nonisolated context). The init body does no isolated work — it
    /// only relies on `entries`' own default value — so marking it
    /// `nonisolated` is safe; every subsequent read/mutation of `entries`
    /// still requires hopping to the main actor, same as before.
    nonisolated init() {}

    func log(category: String, message: String) {
        entries.append(Entry(timestamp: Date(), category: category, message: message))
        if entries.count > Self.capacity {
            entries.removeFirst(entries.count - Self.capacity)
        }
    }

    func clear() {
        entries = []
    }
}

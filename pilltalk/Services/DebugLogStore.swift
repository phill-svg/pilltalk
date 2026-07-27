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

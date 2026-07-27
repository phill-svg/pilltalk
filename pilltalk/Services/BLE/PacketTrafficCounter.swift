import Foundation

/// Time-windowed event counter for the debug pane's packet-traffic display
/// (sent/received/relayed, each gets its own instance). Total keeps
/// incrementing forever; the windowed queries only look at a pruned ring of
/// recent timestamps.
final class PacketTrafficCounter {
    enum Window {
        case lastSecond
        case lastMinute
        case last15Minutes
        case total
    }

    private let now: () -> Date
    private let lock = NSLock()
    private var timestamps: [Date] = []
    private var totalCount = 0

    init(now: @escaping () -> Date = Date.init) {
        self.now = now
    }

    func recordSent() { record() }
    func recordReceived() { record() }
    func recordRelayed() { record() }

    private func record() {
        lock.lock()
        defer { lock.unlock() }
        timestamps.append(now())
        totalCount += 1
        pruneLocked()
    }

    func counts(in window: Window) -> Int {
        lock.lock()
        defer { lock.unlock() }
        pruneLocked()
        switch window {
        case .total:
            return totalCount
        case .lastSecond:
            return countSinceLocked(1)
        case .lastMinute:
            return countSinceLocked(60)
        case .last15Minutes:
            return countSinceLocked(15 * 60)
        }
    }

    private func countSinceLocked(_ seconds: TimeInterval) -> Int {
        let cutoff = now().addingTimeInterval(-seconds)
        return timestamps.filter { $0 >= cutoff }.count
    }

    private func pruneLocked() {
        let cutoff = now().addingTimeInterval(-15 * 60)
        timestamps.removeAll { $0 < cutoff }
    }
}

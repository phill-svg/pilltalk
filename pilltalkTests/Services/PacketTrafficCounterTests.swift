import Testing
import Foundation
@testable import pilltalk

struct PacketTrafficCounterTests {
    @Test
    func counts_reflectRecordedEventsWithinWindow() {
        var now = Date(timeIntervalSince1970: 1_000_000)
        let counter = PacketTrafficCounter(now: { now })

        counter.recordSent()
        counter.recordSent()
        #expect(counter.counts(in: .total) == 2)
        #expect(counter.counts(in: .lastSecond) == 2)

        now = now.addingTimeInterval(2)
        #expect(counter.counts(in: .lastSecond) == 0)
        #expect(counter.counts(in: .lastMinute) == 2)
        #expect(counter.counts(in: .total) == 2)

        now = now.addingTimeInterval(61)
        #expect(counter.counts(in: .lastMinute) == 0)
        #expect(counter.counts(in: .last15Minutes) == 2)
        #expect(counter.counts(in: .total) == 2)
    }

    @Test
    func counts_pruneOldEntriesBeyond15Minutes() {
        var now = Date(timeIntervalSince1970: 1_000_000)
        let counter = PacketTrafficCounter(now: { now })
        counter.recordSent()

        now = now.addingTimeInterval(16 * 60)
        #expect(counter.counts(in: .last15Minutes) == 0)
        #expect(counter.counts(in: .total) == 1, "total keeps counting even after the windowed ring prunes old entries")
    }
}

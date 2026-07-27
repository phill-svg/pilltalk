import Testing
@testable import pilltalk

@MainActor
struct BLEDebugRSSIPollerTests {
    @Test
    func recordReading_storesLatestRSSIByPeripheralID() {
        let poller = BLEDebugRSSIPoller()
        poller.recordReading(peripheralID: "abc-123", rssi: -62)
        #expect(poller.rssiByPeripheralID["abc-123"] == -62)

        poller.recordReading(peripheralID: "abc-123", rssi: -70)
        #expect(poller.rssiByPeripheralID["abc-123"] == -70)
    }

    @Test
    func stop_clearsStoredReadings() {
        let poller = BLEDebugRSSIPoller()
        poller.recordReading(peripheralID: "abc-123", rssi: -62)
        poller.stop()
        #expect(poller.rssiByPeripheralID.isEmpty)
    }
}

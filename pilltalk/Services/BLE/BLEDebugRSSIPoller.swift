import Combine
import CoreBluetooth
import Foundation

/// Polls RSSI for currently-connected peripherals while the debug pane is
/// visible. Scoped to only run on-screen (start/stop from the view's
/// lifecycle) to avoid any always-on battery cost.
///
/// Important: this poller intentionally does **not** set itself as any
/// peripheral's `CBPeripheralDelegate`. `BLEService` is already the
/// delegate for every connected peripheral and relies on staying so for its
/// own operation — state restoration (`willRestoreState`), connection
/// (`beginCentralConnection`, background wake-on-proximity reconnects), and
/// the full `CBPeripheralDelegate` extension (`didDiscoverServices`,
/// `didDiscoverCharacteristicsFor`, `didUpdateValueFor` — this is how
/// mesh packets/messages are received, `didWriteValueFor`,
/// `peripheralIsReady(toSendWriteWithoutResponse:)`, `didModifyServices`,
/// `didUpdateNotificationStateFor`). Reassigning `peripheral.delegate` to
/// this poller would silently stop all of that from firing for any
/// peripheral this poller touches, breaking mesh connectivity.
///
/// Instead, this poller only *triggers* `readRSSI()`; CoreBluetooth invokes
/// the result callback (`peripheral(_:didReadRSSI:error:)`) on whatever
/// object is already `peripheral.delegate` (`BLEService`), regardless of
/// who called `readRSSI()`. Wiring this poller in (Task 9) means
/// `BLEService` adds `peripheral(_:didReadRSSI:error:)` to its existing
/// `CBPeripheralDelegate` extension and forwards the reading here via
/// `recordReading(peripheralID:rssi:)` — the poller never needs the
/// delegate slot itself.
@MainActor
final class BLEDebugRSSIPoller: ObservableObject {
    @Published private(set) var rssiByPeripheralID: [String: Int] = [:]

    private var timer: Timer?
    private var peripheralsProvider: (() -> [CBPeripheral])?

    func start(peripherals: @escaping () -> [CBPeripheral], interval: TimeInterval = 5.0) {
        peripheralsProvider = peripherals
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                for peripheral in peripherals() {
                    // Deliberately not touching peripheral.delegate here —
                    // see the type doc comment. BLEService owns that slot.
                    peripheral.readRSSI()
                }
            }
        }
        timer?.fire()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        peripheralsProvider = nil
        rssiByPeripheralID = [:]
    }

    /// Records the latest RSSI reading for a peripheral, replacing any
    /// prior value. Exposed so the accumulation logic is directly testable
    /// without a live CoreBluetooth round-trip, and so that (once Task 9
    /// wires this in) `BLEService` can forward `didReadRSSI` results here.
    func recordReading(peripheralID: String, rssi: Int) {
        rssiByPeripheralID[peripheralID] = rssi
    }
}

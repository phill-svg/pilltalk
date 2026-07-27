import Testing
@testable import pilltalk

struct DebugAccessGateTests {
    @Test
    func matches_correctPin_returnsTrue() {
        #expect(DebugAccessGate.matches(pin: "8063"))
    }

    @Test
    func matches_wrongPin_returnsFalse() {
        #expect(!DebugAccessGate.matches(pin: "0000"))
        #expect(!DebugAccessGate.matches(pin: ""))
        #expect(!DebugAccessGate.matches(pin: "80630"))
    }
}

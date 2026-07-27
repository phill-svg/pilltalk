import Testing
@testable import pilltalk

@MainActor
struct DebugLogStoreTests {
    @Test
    func log_appendsEntry() {
        let store = DebugLogStore()
        store.log(category: "peer", message: "connected: Alice")
        #expect(store.entries.count == 1)
        #expect(store.entries[0].category == "peer")
        #expect(store.entries[0].message == "connected: Alice")
    }

    @Test
    func log_capsAt500Entries_droppingOldest() {
        let store = DebugLogStore()
        for i in 0..<510 {
            store.log(category: "test", message: "entry \(i)")
        }
        #expect(store.entries.count == 500)
        #expect(store.entries.first?.message == "entry 10", "the oldest 10 entries should have been dropped")
        #expect(store.entries.last?.message == "entry 509")
    }

    @Test
    func clear_emptiesEntries() {
        let store = DebugLogStore()
        store.log(category: "test", message: "one")
        store.clear()
        #expect(store.entries.isEmpty)
    }
}

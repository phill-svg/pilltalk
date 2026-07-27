import XCTest
@testable import pilltalk

@MainActor
final class AppChromeModelTests: XCTestCase {
    private func makeChatViewModel() -> ChatViewModel {
        let keychain = MockKeychain()
        let keychainHelper = MockKeychainHelper()
        let idBridge = NostrIdentityBridge(keychain: keychainHelper)
        let identityManager = MockIdentityManager(keychain)
        let suiteName = "AppChromeModelTests.\(UUID().uuidString)"
        let storage = UserDefaults(suiteName: suiteName) ?? .standard
        storage.removePersistentDomain(forName: suiteName)
        let locationManager = LocationChannelManager(storage: storage)

        return ChatViewModel(
            keychain: keychain,
            idBridge: idBridge,
            identityManager: identityManager,
            transport: MockTransport(),
            locationManager: locationManager
        )
    }

    private func makeModel() -> AppChromeModel {
        let conversations = ConversationStore()
        let privateInboxModel = PrivateInboxModel(conversations: conversations)
        return AppChromeModel(chatViewModel: makeChatViewModel(), privateInboxModel: privateInboxModel)
    }

    func test_selectedDestination_defaultsToChats() {
        XCTAssertEqual(makeModel().selectedDestination, .chats)
    }

    func test_presentAppInfo_selectsSettingsDestination() {
        let model = makeModel()
        model.presentAppInfo()
        XCTAssertEqual(model.selectedDestination, .settings)
    }

    func test_shouldSuppressScreenshotNotification_trueWhenSettingsSelected() {
        let model = makeModel()
        XCTAssertFalse(model.shouldSuppressScreenshotNotification)
        model.presentAppInfo()
        XCTAssertTrue(model.shouldSuppressScreenshotNotification)
    }
}

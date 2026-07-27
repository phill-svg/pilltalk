import BitFoundation
import Combine
import CoreBluetooth
import Foundation

enum AppDestination: Hashable {
    case chats
    case nearby
    case groups
    case settings
}

@MainActor
final class AppChromeModel: ObservableObject {
    @Published private(set) var hasUnreadPrivateMessages = false
    @Published var nickname: String
    @Published var showingFingerprintFor: PeerID?
    @Published var isLocationChannelsSheetPresented = false
    @Published var isNoticesSheetPresented = false
    /// When the sheet is opened for "notes left here" (empty mesh timeline),
    /// it should land on the geo tab instead of the channel-derived default.
    @Published var noticesSheetPrefersGeoTab = false
    @Published var showBluetoothAlert = false
    @Published var bluetoothAlertMessage = ""
    @Published var bluetoothState: CBManagerState = .unknown
    @Published var showScreenshotPrivacyWarning = false
    @Published var selectedDestination: AppDestination = .chats

    private let chatViewModel: ChatViewModel
    private var cancellables = Set<AnyCancellable>()
    /// The composer owns capture state above ChatViewModel. ContentView
    /// installs this hook so both panic entry points synchronously stop it.
    private var prepareForPanic: (@MainActor () -> Void)?

    /// Bulletin-board coordinator, created on first use of the board sheet.
    private(set) lazy var boardManager = BoardManager(transport: chatViewModel.meshService)

    init(chatViewModel: ChatViewModel, privateInboxModel: PrivateInboxModel) {
        self.chatViewModel = chatViewModel
        self.nickname = chatViewModel.nickname

        bind(privateInboxModel: privateInboxModel)
    }

    var shouldSuppressScreenshotNotification: Bool {
        isLocationChannelsSheetPresented || selectedDestination == .settings
    }

    func setNickname(_ nickname: String) {
        self.nickname = nickname
        if chatViewModel.nickname != nickname {
            chatViewModel.nickname = nickname
        }
    }

    func validateAndSaveNickname() {
        chatViewModel.validateAndSaveNickname()
        if nickname != chatViewModel.nickname {
            nickname = chatViewModel.nickname
        }
    }

    func openMostRelevantPrivateChat() {
        chatViewModel.openMostRelevantPrivateChat()
    }

    func showFingerprint(for peerID: PeerID) {
        showingFingerprintFor = peerID
    }

    func clearFingerprint() {
        showingFingerprintFor = nil
    }

    func presentAppInfo() {
        selectedDestination = .settings
    }

    func presentNotices(geoTab: Bool = false) {
        noticesSheetPrefersGeoTab = geoTab
        isNoticesSheetPresented = true
    }

    /// Builds the mesh topology map model from the transport's gossiped
    /// graph plus the live nickname table. Unknown nodes (heard about via a
    /// neighbor claim but never announced to us) fall back to a short ID.
    func meshTopologyDisplayModel() -> MeshTopologyDisplayModel {
        let mesh = chatViewModel.meshService
        guard let snapshot = mesh.currentMeshTopology() else { return .empty }
        let nicknames = mesh.getPeerNicknames()

        let nodes = snapshot.nodes.map { peerID -> MeshTopologyDisplayModel.Node in
            let isSelf = peerID == snapshot.localPeerID
            let label: String
            if isSelf {
                label = chatViewModel.nickname
            } else {
                label = nicknames[peerID] ?? "\(peerID.id.prefix(8))…"
            }
            return MeshTopologyDisplayModel.Node(id: peerID.id, label: label, isSelf: isSelf)
        }
        let edges = snapshot.edges.map { ($0.a.id, $0.b.id) }
        return MeshTopologyDisplayModel(nodes: nodes, edges: edges)
    }

    // MARK: - Debug pane data (Task 9)
    // Mirrors `meshTopologyDisplayModel()`: AppChromeModel wraps the private
    // `chatViewModel` + its `BLEService` rather than exposing them. The debug
    // accessors live only on `BLEService` (not the `Transport` protocol —
    // avoiding protocol churn for other conformers), so this reaches them via
    // an `as? BLEService` cast confined to these debug-only accessors. Every
    // method here is `@MainActor` (the class is), matching the debug provider
    // closure types AppInfoView expects.

    private var bleService: BLEService? {
        chatViewModel.meshService as? BLEService
    }

    func debugConnectionRows() -> [BLEService.DebugPeerConnectionRow] {
        bleService?.debugConnectionRows() ?? []
    }

    func debugTrafficSnapshot() -> BLEService.DebugTrafficSnapshot? {
        bleService?.debugTrafficSnapshot()
    }

    func debugScanResultRows() -> [BLEConnectionScheduler<CBPeripheral>.DebugScanResultRow] {
        bleService?.debugScanResultRows() ?? []
    }

    func debugSyncConfig() -> GossipSyncManager.Config? {
        bleService?.debugSyncConfig()
    }

    var debugLogStore: DebugLogStore? {
        bleService?.debugLogStore
    }

    /// Staged for the debug pane's (currently deferred) live-RSSI poller; see
    /// Task 9's report for why live polling is not yet wired.
    func debugConnectedPeripherals() -> [CBPeripheral] {
        bleService?.connectedPeripherals() ?? []
    }

    func triggerScreenshotPrivacyWarning() {
        showScreenshotPrivacyWarning = true
    }

    func setPanicPreparation(_ preparation: (@MainActor () -> Void)?) {
        prepareForPanic = preparation
    }

    func panicClearAllData() {
        prepareForPanic?()
        chatViewModel.panicClearAllData()
    }

    private func bind(privateInboxModel: PrivateInboxModel) {
        privateInboxModel.$unreadPeerIDs
            .receive(on: DispatchQueue.main)
            .sink { [weak self] unreadPeerIDs in
                self?.hasUnreadPrivateMessages = !unreadPeerIDs.isEmpty
            }
            .store(in: &cancellables)

        chatViewModel.$nickname
            .receive(on: DispatchQueue.main)
            .sink { [weak self] nickname in
                guard let self, self.nickname != nickname else { return }
                self.nickname = nickname
            }
            .store(in: &cancellables)

        chatViewModel.$showBluetoothAlert
            .receive(on: DispatchQueue.main)
            .assign(to: &$showBluetoothAlert)

        chatViewModel.$bluetoothAlertMessage
            .receive(on: DispatchQueue.main)
            .assign(to: &$bluetoothAlertMessage)

        chatViewModel.$bluetoothState
            .receive(on: DispatchQueue.main)
            .assign(to: &$bluetoothState)

        hasUnreadPrivateMessages = !privateInboxModel.unreadPeerIDs.isEmpty
    }
}

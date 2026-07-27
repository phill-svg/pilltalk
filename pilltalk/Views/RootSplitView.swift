import BitFoundation
import SwiftUI

/// The app's root navigation shell: a NavigationSplitView with a persistent
/// sidebar on iPad/Mac Catalyst that collapses to a drawer on iPhone
/// (framework-provided, no custom gesture code). Four destinations: Chats
/// (today's ContentView, unchanged), Nearby, Groups, and Settings.
struct RootSplitView: View {
    @EnvironmentObject private var appChromeModel: AppChromeModel
    @EnvironmentObject private var peerListModel: PeerListModel
    @EnvironmentObject private var locationChannelsModel: LocationChannelsModel
    @ThemedPalette private var palette
    @State private var columnVisibility: NavigationSplitViewVisibility = .automatic

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            sidebar
        } detail: {
            detail
        }
    }

    private var sidebar: some View {
        List(selection: Binding(
            get: { appChromeModel.selectedDestination },
            set: { newValue in
                if let newValue { appChromeModel.selectedDestination = newValue }
            }
        )) {
            Text(verbatim: "pilltalk/")
                .pilltalkFont(size: 16, weight: .medium)
                .foregroundStyle(
                    LinearGradient(
                        colors: palette.accentGradientColors,
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )

            sidebarRow(.chats, systemImage: "bubble.left.and.bubble.right", title: "chats")
            sidebarRow(.nearby, systemImage: "antenna.radiowaves.left.and.right", title: "nearby")
            sidebarRow(.groups, systemImage: "person.3", title: "groups")
            sidebarRow(.settings, systemImage: "gearshape", title: "settings")
        }
        .navigationTitle(Text(verbatim: "pilltalk"))
    }

    private func sidebarRow(_ destination: AppDestination, systemImage: String, title: String) -> some View {
        Label {
            Text(verbatim: title)
        } icon: {
            Image(systemName: systemImage)
        }
        .tag(destination)
        .listRowBackground(
            appChromeModel.selectedDestination == destination
                ? AnyView(
                    LinearGradient(
                        colors: palette.accentGradientColors,
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .opacity(0.18)
                  )
                : AnyView(Color.clear)
        )
    }

    @ViewBuilder
    private var detail: some View {
        switch appChromeModel.selectedDestination {
        case .chats:
            ContentView()
        case .nearby:
            NearbyView()
        case .groups:
            groupsDestination
        case .settings:
            AppInfoView(
                topologyProvider: { appChromeModel.meshTopologyDisplayModel() },
                onPanicWipe: { appChromeModel.panicClearAllData() },
                debugConnectionRowsProvider: { appChromeModel.debugConnectionRows() },
                debugTrafficSnapshotProvider: { appChromeModel.debugTrafficSnapshot() },
                debugScanResultRowsProvider: { appChromeModel.debugScanResultRows() },
                debugSyncConfigProvider: { appChromeModel.debugSyncConfig() },
                debugLogStore: appChromeModel.debugLogStore,
                debugRSSIPeripheralsProvider: { appChromeModel.debugConnectedPeripherals() }
            )
            .environmentObject(locationChannelsModel)
        }
    }

    private var groupsDestination: some View {
        NavigationStack {
            ScrollView {
                GroupChatList(
                    groups: peerListModel.groupRows,
                    onTapGroup: { peerID in
                        peerListModel.startConversation(with: peerID)
                        appChromeModel.selectedDestination = .chats
                    }
                )
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .themedSurface()
            .navigationTitle(Text(verbatim: "groups"))
        }
    }
}

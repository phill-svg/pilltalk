import BitFoundation
import SwiftUI

/// The "Nearby" sidebar destination: mesh peers, bridged peers, groups (or
/// geohash people, when a location channel is active), as a persistent
/// screen instead of the old people-list sheet. Tapping a peer starts the
/// conversation and switches back to the "Chats" destination, where the
/// existing private-chat sheet (owned by ContentView) picks it up.
struct NearbyView: View {
    @EnvironmentObject private var appChromeModel: AppChromeModel
    @EnvironmentObject private var conversationUIModel: ConversationUIModel
    @EnvironmentObject private var locationChannelsModel: LocationChannelsModel
    @EnvironmentObject private var peerListModel: PeerListModel
    @EnvironmentObject private var verificationModel: VerificationModel
    @ThemedPalette private var palette

    @State private var showVerifySheet = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if case .location(let channel) = locationChannelsModel.selectedChannel {
                        Text(verbatim: "#\(channel.geohash.lowercased())")
                            .pilltalkFont(size: 12)
                            .foregroundColor(palette.locationAccent)
                            .padding(.horizontal, 16)
                            .padding(.top, 8)
                        GeohashPeopleList(
                            onTapPerson: {
                                // GeohashPeopleList already routed the tap
                                // through peerListModel.openGeohashDirectMessage
                                // (which starts the private chat the same way
                                // startConversation(with:) does below) before
                                // calling us — the only thing left to do here
                                // is switch to the destination where that
                                // conversation's sheet lives.
                                appChromeModel.selectedDestination = .chats
                            }
                        )
                    } else {
                        PeopleSectionHeader(
                            icon: "antenna.radiowaves.left.and.right",
                            iconColor: palette.accentBlue,
                            title: "#mesh"
                        )
                        MeshPeerList(
                            onTapPeer: { peerID in startConversation(with: peerID) },
                            onToggleFavorite: { peerID in
                                peerListModel.toggleFavorite(peerID: peerID)
                            },
                            onShowFingerprint: { peerID in
                                appChromeModel.showFingerprint(for: peerID)
                            },
                            onToggleBlock: { peer in
                                if peer.isBlocked {
                                    conversationUIModel.unblock(peerID: peer.peerID, displayName: peer.displayName)
                                } else {
                                    conversationUIModel.block(peerID: peer.peerID, displayName: peer.displayName)
                                }
                            }
                        )
                        BridgePeopleList()
                        GroupChatList(
                            groups: peerListModel.groupRows,
                            onTapGroup: { peerID in startConversation(with: peerID) }
                        )
                    }
                }
                .padding(.top, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .id(peerListModel.renderID)
            }
            .themedSurface()
            .navigationTitle(Text(verbatim: "nearby"))
            .toolbar {
                if case .mesh = locationChannelsModel.selectedChannel {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button(action: { showVerifySheet = true }) {
                            Image(systemName: "qrcode")
                                .font(.pilltalkSystem(size: 14))
                        }
                        .accessibilityLabel(
                            String(localized: "content.accessibility.verification", comment: "Accessibility label for the verification QR button")
                        )
                    }
                }
            }
        }
        .sheet(isPresented: $showVerifySheet) {
            VerificationSheetView(isPresented: $showVerifySheet)
                .environmentObject(verificationModel)
        }
    }

    /// Starts the conversation, then hands off to the "Chats" destination —
    /// that's where ContentView's existing private-chat sheet lives, keyed
    /// on `PrivateConversationModel.selectedPeerID`.
    private func startConversation(with peerID: PeerID) {
        peerListModel.startConversation(with: peerID)
        appChromeModel.selectedDestination = .chats
    }
}

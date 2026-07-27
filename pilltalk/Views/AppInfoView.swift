import CoreBluetooth
import SwiftUI

/// The sheet behind the "pilltalk/" logo: a segmented Settings/Info surface.
/// Settings gathers every user preference (appearance, voice, connectivity
/// toggles, panic wipe); Info keeps the about content (how-to, features,
/// privacy, symbols legend).
struct AppInfoView: View {
    @ThemedPalette private var palette
    @AppStorage(AppTheme.storageKey) private var appThemeRawValue = AppTheme.matrix.rawValue
    @EnvironmentObject private var locationChannelsModel: LocationChannelsModel
    @ObservedObject private var bridgeService = BridgeService.shared

    /// Supplies the mesh topology map data. Nil (previews, missing wiring)
    /// hides the topology row entirely.
    var topologyProvider: (@MainActor () -> MeshTopologyDisplayModel)?
    /// Wipes all local data. Nil (previews, missing wiring) hides the danger
    /// zone entirely.
    var onPanicWipe: (@MainActor () -> Void)?

    // MARK: - Debug pane wiring (Task 9)
    // Nil (previews, missing wiring) hides the whole Debug pane — the same
    // nil-hides-the-feature convention as topologyProvider/onPanicWipe. The
    // segment only appears when `debugConnectionRowsProvider` is wired. All
    // are `@MainActor` closures, mirroring topologyProvider's proven pattern;
    // the debug data types are BLE-specific (resolved via AppChromeModel's
    // `as? BLEService` accessors — the debug methods are not on `Transport`).
    var debugConnectionRowsProvider: (@MainActor () -> [BLEService.DebugPeerConnectionRow])?
    var debugTrafficSnapshotProvider: (@MainActor () -> BLEService.DebugTrafficSnapshot?)?
    var debugScanResultRowsProvider: (@MainActor () -> [BLEConnectionScheduler<CBPeripheral>.DebugScanResultRow])?
    var debugSyncConfigProvider: (@MainActor () -> GossipSyncManager.Config?)?
    var debugLogStore: DebugLogStore?
    /// Staged for a future live-RSSI poller. Live polling is deferred: under
    /// this codebase's strict concurrency, the RSSI readings arrive on
    /// `BLEService` (the `CBPeripheralDelegate`) with no sound path to forward
    /// them into a UI-layer `@StateObject` poller, and there is no
    /// peerID→peripheral mapping for display. See Task 9's report. Kept wired
    /// so the plumbing is ready when that gap is closed.
    var debugRSSIPeripheralsProvider: (@MainActor () -> [CBPeripheral])?

    @State private var showTopology = false
    @State private var liveVoiceEnabled = PTTSettings.liveVoiceEnabled
    @State private var locationNotesEnabled = LocationNotesSettings.enabled
    @ObservedObject private var locationManager = LocationChannelManager.shared
    /// Sticky across opens: first-ever open lands on Info (the gentler
    /// introduction), and afterwards the sheet reopens wherever it was left.
    @AppStorage("appInfo.selectedPane") private var selectedPane: Pane = .info
    @State private var showPanicConfirmation = false
    @AppStorage(AppLanguageSettings.overrideKey) private var languageOverride = ""
    /// The override changed this session; localization resolves at process
    /// start, so surface the restart hint.
    @State private var showLanguageRestartNote = false

    // Debug pane PIN gate (Task 9). `isDebugUnlocked` is not persisted, so the
    // gate re-locks every time the sheet is recreated.
    @State private var isDebugUnlocked = false
    @State private var debugPinEntry = ""
    @State private var showDebugPinError = false

    private enum Pane: String {
        case settings
        case info
        case debug
    }

    private var selectedTheme: AppTheme {
        AppTheme(rawValue: appThemeRawValue) ?? .matrix
    }

    private var textColor: Color { palette.primary }

    private var secondaryTextColor: Color { palette.secondary }

    // MARK: - Constants
    private enum Strings {
        static let appName: LocalizedStringKey = "app_info.app_name"
        static let tagline: LocalizedStringKey = "app_info.tagline"
        static let appearanceTitle: LocalizedStringKey = "app_info.appearance.title"

        /// New keys carry their English copy inline (defaultValue) until the
        /// i18n pass lands them in the catalog; moved keys keep their homes.
        enum Settings {
            static let tabPickerLabel = String(localized: "app_info.tab.picker_label", defaultValue: "view", comment: "Accessibility label for the segmented control switching between the settings and info panes of the app info sheet")
            static let tabSettings = String(localized: "app_info.tab.settings", defaultValue: "settings", comment: "Segmented control label for the settings pane of the app info sheet")
            static let tabInfo = String(localized: "app_info.tab.info", defaultValue: "info", comment: "Segmented control label for the info pane of the app info sheet")

            static let connectivityTitle = String(localized: "app_info.settings.connectivity.title", defaultValue: "CONNECTIVITY", comment: "Section header (uppercase) for the connectivity toggles: mesh bridge, internet gateway, tor routing")

            static let languageTitle = String(localized: "app_info.settings.language.title", defaultValue: "LANGUAGE", comment: "Section header (uppercase) for the app language picker in settings")
            static let languagePickerLabel = String(localized: "app_info.settings.language.picker_label", defaultValue: "app language", comment: "Label of the app language picker row in settings")
            static let languageSystem = String(localized: "app_info.settings.language.system", defaultValue: "system default", comment: "Menu option that clears the in-app language override so the app follows the device language")
            static let languageRestartNote = String(localized: "app_info.settings.language.restart_note", defaultValue: "restart pilltalk to apply the new language", comment: "Caption shown after the user picks a different app language; the change takes effect on next launch")

            static let bridgeTitle = String(localized: "app_info.settings.bridge.title", defaultValue: "mesh bridge", comment: "Title of the mesh bridge toggle in settings")
            static let bridgeSubtitle = String(localized: "app_info.settings.bridge.subtitle", defaultValue: "joins nearby mesh islands over the internet: what you say in the mesh channel also reaches people in your area beyond radio range, and their messages appear here marked with the network glyph. while you have internet, your device also carries bridge and location-channel traffic for phones around you that have none.", comment: "Subtitle explaining what the mesh bridge toggle does")
            static func bridgeCell(_ cell: String) -> String {
                String(
                    format: String(localized: "app_info.settings.bridge.cell", defaultValue: "rendezvous cell: %@", comment: "Caption under the mesh bridge toggle showing the geohash cell the bridge is meeting on"),
                    locale: .current,
                    cell
                )
            }
            static let bridgeNoCell = String(localized: "app_info.settings.bridge.no_cell", defaultValue: "no rendezvous cell yet — needs location access or a nearby bridge peer", comment: "Caption under the mesh bridge toggle when the bridge is on but has no geohash cell to meet on")

            // Moved from LocationChannelsSheet; keys unchanged. (The former
            // internet-gateway toggle is gone: the bridge switch drives all
            // internet sharing, including geohash-channel gatewaying.)
            static let torTitle: LocalizedStringKey = "location_channels.tor.title"
            static let torSubtitle: LocalizedStringKey = "location_channels.tor.subtitle"
            static let toggleOn: LocalizedStringKey = "common.toggle.on"
            static let toggleOff: LocalizedStringKey = "common.toggle.off"

            static let dangerTitle = String(localized: "app_info.settings.danger.title", defaultValue: "DANGER ZONE", comment: "Section header (uppercase) for destructive actions in settings")
            static let panicButton = String(localized: "app_info.settings.danger.panic_button", defaultValue: "panic wipe", comment: "Button in the settings danger zone that erases all local data after confirmation")
            static let panicNote = String(localized: "app_info.settings.danger.panic_note", defaultValue: "erases all messages, keys, and identity. triple-tapping the pilltalk/ logo does the same, instantly.", comment: "Caption under the panic wipe button explaining what it does and the triple-tap shortcut")
            static let panicConfirmTitle = String(localized: "app_info.settings.danger.panic_confirm_title", defaultValue: "wipe all data?", comment: "Title of the confirmation dialog before a panic wipe")
            static let panicConfirmAction = String(localized: "app_info.settings.danger.panic_confirm_action", defaultValue: "wipe everything", comment: "Destructive confirmation button that performs the panic wipe")
        }

        enum Features {
            static let title: LocalizedStringKey = "app_info.features.title"
            static let offlineComm = AppInfoFeatureInfo(
                icon: "wifi.slash",
                title: "app_info.features.offline.title",
                description: "app_info.features.offline.description"
            )
            static let encryption = AppInfoFeatureInfo(
                icon: "lock.shield",
                title: "app_info.features.encryption.title",
                description: "app_info.features.encryption.description"
            )
            static let extendedRange = AppInfoFeatureInfo(
                icon: "antenna.radiowaves.left.and.right",
                title: "app_info.features.extended_range.title",
                description: "app_info.features.extended_range.description"
            )
            static let mentions = AppInfoFeatureInfo(
                icon: "at",
                title: "app_info.features.mentions.title",
                description: "app_info.features.mentions.description"
            )
            static let favorites = AppInfoFeatureInfo(
                icon: "star.fill",
                title: "app_info.features.favorites.title",
                description: "app_info.features.favorites.description"
            )
            static let geohash = AppInfoFeatureInfo(
                icon: "number",
                title: "app_info.features.geohash.title",
                description: "app_info.features.geohash.description"
            )
            static let bridge = AppInfoFeatureInfo(
                icon: "network",
                resolvedTitle: String(localized: "app_info.features.bridge.title", defaultValue: "mesh bridging", comment: "Feature row title for the mesh bridge in the app info sheet"),
                resolvedDescription: String(localized: "app_info.features.bridge.description", defaultValue: "links nearby mesh islands through the internet so one crowd isn't split by radio range", comment: "Feature row description for the mesh bridge in the app info sheet")
            )
        }

        enum Legend {
            static let title: LocalizedStringKey = "app_info.legend.title"
            /// Every glyph the peer lists and headers use, in one place —
            /// nothing else in the app defines them. A nil color renders in
            /// the theme's primary text color.
            static let items: [(icon: String, color: Color?, text: String)] = [
                ("antenna.radiowaves.left.and.right", nil, String(localized: "app_info.legend.mesh_connected")),
                ("point.3.filled.connected.trianglepath.dotted", nil, String(localized: "app_info.legend.mesh_relayed")),
                ("globe", nil, String(localized: "app_info.legend.nostr")),
                ("network", Color.cyan, String(localized: "app_info.legend.bridged", defaultValue: "message arrived across a mesh bridge", comment: "Symbols legend entry for the cyan network glyph shown on messages carried across a mesh bridge")),
                ("person", nil, String(localized: "app_info.legend.offline")),
                ("mappin.and.ellipse", nil, String(localized: "app_info.legend.location_nearby")),
                ("face.dashed", nil, String(localized: "app_info.legend.teleported")),
                ("lock.fill", nil, String(localized: "app_info.legend.encrypted")),
                ("lock.slash", nil, String(localized: "app_info.legend.encryption_failed")),
                ("checkmark.seal.fill", nil, String(localized: "app_info.legend.verified")),
                ("star.fill", nil, String(localized: "app_info.legend.favorite")),
                ("envelope.fill", nil, String(localized: "app_info.legend.unread")),
                ("nosign", nil, String(localized: "app_info.legend.blocked"))
            ]
        }

        enum Voice {
            static let title: LocalizedStringKey = "app_info.voice.title"
            // The live-voice title/description keys are referenced inline at
            // the toggle (they ride the shared settingToggle now).
        }

        enum Location {
            static let notes = AppInfoFeatureInfo(
                icon: "mappin.and.ellipse",
                title: "app_info.location.notes.title",
                description: "app_info.location.notes.description"
            )
        }

        enum Network {
            static let title: LocalizedStringKey = "app_info.network.title"
            static let topology = AppInfoFeatureInfo(
                icon: "point.3.connected.trianglepath.dotted",
                title: "app_info.network.topology.title",
                description: "app_info.network.topology.description"
            )
        }

        enum Privacy {
            static let title: LocalizedStringKey = "app_info.privacy.title"
            static let noTracking = AppInfoFeatureInfo(
                icon: "eye.slash",
                title: "app_info.privacy.no_tracking.title",
                description: "app_info.privacy.no_tracking.description"
            )
            static let ephemeral = AppInfoFeatureInfo(
                icon: "shuffle",
                title: "app_info.privacy.ephemeral.title",
                description: "app_info.privacy.ephemeral.description"
            )
            static let panic = AppInfoFeatureInfo(
                icon: "hand.raised.fill",
                title: "app_info.privacy.panic.title",
                description: "app_info.privacy.panic.description"
            )
        }

        enum HowToUse {
            static let title: LocalizedStringKey = "app_info.how_to_use.title"
            /// The instruction strings flowed into one comma-separated
            /// paragraph. The translations carry their legacy bullet-list
            /// prefix ("• "), so it is stripped here.
            static var paragraph: String {
                [
                    String(localized: "app_info.how_to_use.set_nickname"),
                    String(localized: "app_info.how_to_use.change_channels"),
                    String(localized: "app_info.how_to_use.open_sidebar"),
                    String(localized: "app_info.how_to_use.start_dm"),
                    String(localized: "app_info.how_to_use.clear_chat"),
                    String(localized: "app_info.how_to_use.commands")
                ]
                .map { $0.hasPrefix("• ") ? String($0.dropFirst(2)) : $0 }
                .joined(separator: ", ")
            }
        }

    }

    var body: some View {
        #if os(macOS)
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                panePicker

                ScrollView {
                    paneContent
                }
            }
            .themedSheetBackground()
        }
        .frame(width: 600, height: 700)
        .sheet(isPresented: $showTopology) {
            if let topologyProvider {
                MeshTopologyView(provider: topologyProvider)
            }
        }
        #else
        NavigationView {
            VStack(spacing: 0) {
                panePicker

                ScrollView {
                    paneContent
                }
            }
            .themedSheetBackground()
            .navigationBarTitleDisplayMode(.inline)
        }
        .sheet(isPresented: $showTopology) {
            if let topologyProvider {
                MeshTopologyView(provider: topologyProvider)
            }
        }
        #endif
    }

    // MARK: - Pane switching

    private var panePicker: some View {
        Picker(Strings.Settings.tabPickerLabel, selection: $selectedPane) {
            Text(Strings.Settings.tabInfo).tag(Pane.info)
            Text(Strings.Settings.tabSettings).tag(Pane.settings)
            // Only when the debug providers are wired (nil-hides-the-feature),
            // matching topologyProvider/onPanicWipe.
            if debugConnectionRowsProvider != nil {
                Text(verbatim: "debug").tag(Pane.debug)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(.horizontal)
        .padding(.top, 12)
    }

    @ViewBuilder
    private var paneContent: some View {
        switch selectedPane {
        case .settings:
            settingsContent
        case .info:
            infoContent
        case .debug:
            debugContent
        }
    }

    // MARK: - Settings pane

    @ViewBuilder
    private var settingsContent: some View {
        VStack(alignment: .leading, spacing: 24) {
            // Appearance — single row: label left, theme chips right
            HStack(spacing: 12) {
                SectionHeader(Strings.appearanceTitle)
                Spacer()
                ForEach(AppTheme.allCases) { theme in
                    Button {
                        appThemeRawValue = theme.rawValue
                    } label: {
                        Text(theme.displayNameKey)
                            .pilltalkFont(size: 13, weight: selectedTheme == theme ? .semibold : .regular)
                            .foregroundColor(selectedTheme == theme ? palette.accent : secondaryTextColor)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(selectedTheme == theme ? palette.accent.opacity(0.15) : Color.clear)
                            )
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selectedTheme == theme ? .isSelected : [])
                }
            }

            // Language — an in-app override so the UI language can differ
            // from the device language (takes effect on next launch).
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(verbatim: Strings.Settings.languageTitle)

                settingsCard {
                    Menu {
                        Button {
                            selectLanguage(nil)
                        } label: {
                            menuItemLabel(Strings.Settings.languageSystem, isSelected: languageOverride.isEmpty)
                        }
                        Divider()
                        ForEach(AppLanguageSettings.availableLanguages, id: \.self) { code in
                            Button {
                                selectLanguage(code)
                            } label: {
                                menuItemLabel(AppLanguageSettings.endonym(for: code), isSelected: languageOverride == code)
                            }
                        }
                    } label: {
                        HStack {
                            Text(Strings.Settings.languagePickerLabel)
                                .pilltalkFont(size: 12, weight: .semibold)
                                .foregroundColor(textColor)
                            Spacer()
                            Text(languageOverride.isEmpty ? Strings.Settings.languageSystem : AppLanguageSettings.endonym(for: languageOverride))
                                .pilltalkFont(size: 12)
                                .foregroundColor(palette.accent)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 10))
                                .foregroundColor(secondaryTextColor)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    if showLanguageRestartNote {
                        Text(Strings.Settings.languageRestartNote)
                            .pilltalkFont(size: 11)
                            .foregroundColor(secondaryTextColor)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            // Voice — same card + IRC pill as every other toggle setting.
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(Strings.Voice.title)

                settingsCard {
                    settingToggle(
                        title: Text("app_info.voice.live.title"),
                        subtitle: Text("app_info.voice.live.description"),
                        isOn: Binding(
                            get: { liveVoiceEnabled },
                            set: { newValue in
                                liveVoiceEnabled = newValue
                                PTTSettings.liveVoiceEnabled = newValue
                            }
                        )
                    )
                }
            }

            // Connectivity: mesh bridge, internet gateway, tor routing
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(verbatim: Strings.Settings.connectivityTitle)

                settingsCard {
                    settingToggle(
                        title: Text(Strings.Settings.bridgeTitle),
                        subtitle: Text(Strings.Settings.bridgeSubtitle),
                        isOn: bridgeToggleBinding
                    )
                    // Where the bridge meets: the geohash rendezvous cell, or
                    // a hint about why there isn't one yet (no location and no
                    // bridge peer advertising a cell).
                    if bridgeService.isEnabled {
                        Text(bridgeService.activeCell.map(Strings.Settings.bridgeCell) ?? Strings.Settings.bridgeNoCell)
                            .pilltalkFont(size: 11)
                            .foregroundColor(secondaryTextColor)
                    }
                }

                settingsCard {
                    settingToggle(
                        title: Text(Strings.Settings.torTitle),
                        subtitle: Text(Strings.Settings.torSubtitle),
                        isOn: torToggleBinding
                    )
                }

                // Location notes / dead drops (merged from main's flat
                // layout into the shared card + pill style). Turning it on
                // may need the location prompt; the permission control below
                // covers the denied path.
                settingsCard {
                    settingToggle(
                        title: Strings.Location.notes.title,
                        subtitle: Strings.Location.notes.description,
                        isOn: Binding(
                            get: { locationNotesEnabled },
                            set: { newValue in
                                locationNotesEnabled = newValue
                                LocationNotesSettings.enabled = newValue
                                if newValue {
                                    locationManager.enableLocationChannels()
                                }
                            }
                        )
                    )
                }

                // Location powers the channels list and the bridge cell, so
                // its control lives with the other connectivity settings.
                // Platform reality shapes the three states: the app may only
                // prompt while never-asked; granted/denied both flip in the
                // system permission screen.
                switch locationChannelsModel.permissionState {
                case .authorized:
                    Button(action: SystemSettings.location.open) {
                        Text("location_channels.action.remove_access")
                            .pilltalkFont(size: 12)
                            .foregroundColor(palette.alertRed)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                            .background(Color.red.opacity(0.08))
                            .cornerRadius(6)
                    }
                    .buttonStyle(.plain)
                case .notDetermined:
                    Button(action: { locationChannelsModel.enableLocationChannels() }) {
                        Text("location_channels.action.request_permissions")
                            .pilltalkFont(size: 12)
                            .foregroundColor(palette.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                            .background(palette.accent.opacity(0.12))
                            .cornerRadius(6)
                    }
                    .buttonStyle(.plain)
                case .denied, .restricted:
                    settingsCard {
                        Text("location_channels.permission_denied")
                            .pilltalkFont(size: 11)
                            .foregroundColor(secondaryTextColor)
                        Button("location_channels.action.open_settings", action: SystemSettings.location.open)
                            .buttonStyle(.plain)
                            .pilltalkFont(size: 12)
                            .foregroundColor(palette.accent)
                    }
                }
            }

            // Danger zone
            if onPanicWipe != nil {
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(verbatim: Strings.Settings.dangerTitle)

                    Button(action: { showPanicConfirmation = true }) {
                        Text(Strings.Settings.panicButton)
                            .pilltalkFont(size: 12)
                            .foregroundColor(palette.alertRed)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                            .background(Color.red.opacity(0.08))
                            .cornerRadius(6)
                    }
                    .buttonStyle(.plain)
                    .confirmationDialog(
                        Strings.Settings.panicConfirmTitle,
                        isPresented: $showPanicConfirmation,
                        titleVisibility: .visible
                    ) {
                        Button(Strings.Settings.panicConfirmAction, role: .destructive) {
                            onPanicWipe?()
                        }
                        Button("common.cancel", role: .cancel) {}
                    }

                    Text(Strings.Settings.panicNote)
                        .pilltalkFont(size: 11)
                        .foregroundColor(secondaryTextColor)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding()
    }

    private func selectLanguage(_ code: String?) {
        let previous = languageOverride
        AppLanguageSettings.setOverride(code)
        languageOverride = code ?? ""
        if languageOverride != previous {
            showLanguageRestartNote = true
        }
    }

    private func menuItemLabel(_ title: String, isSelected: Bool) -> some View {
        HStack {
            Text(title)
            if isSelected {
                Image(systemName: "checkmark")
            }
        }
    }

    private var bridgeToggleBinding: Binding<Bool> {
        Binding(
            get: { bridgeService.isEnabled },
            set: { bridgeService.setEnabled($0) }
        )
    }

    private var torToggleBinding: Binding<Bool> {
        Binding(
            get: { locationChannelsModel.userTorEnabled },
            set: { locationChannelsModel.setUserTorEnabled($0) }
        )
    }

    /// The padded card every connectivity setting sits in (moved look from
    /// LocationChannelsSheet's toggle sections).
    private func settingsCard<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8, content: content)
            .padding(12)
            .background(palette.secondary.opacity(0.12))
            .cornerRadius(8)
    }

    /// A titled section: a `SectionHeader` above the padded card. Used by the
    /// debug pane (the settings pane inlines this same header-over-card shape).
    private func settingsCard<Content: View>(title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(verbatim: title)
            settingsCard(content)
        }
    }

    /// A title+subtitle row driving an IRC-style on/off pill — the one
    /// toggle style every setting uses.
    private func settingToggle(title: Text, subtitle: Text, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                title
                    .pilltalkFont(size: 12, weight: .semibold)
                    .foregroundColor(textColor)
                subtitle
                    .pilltalkFont(size: 11)
                    .foregroundColor(secondaryTextColor)
            }
        }
        .toggleStyle(IRCToggleStyle(accent: palette.accent, onLabel: Strings.Settings.toggleOn, offLabel: Strings.Settings.toggleOff))
    }

    // MARK: - Debug pane (Task 9)

    @ViewBuilder
    private var debugContent: some View {
        if isDebugUnlocked {
            VStack(alignment: .leading, spacing: 24) {
                if let topologyProvider {
                    settingsCard(title: "mesh topology") {
                        MeshTopologyView(provider: topologyProvider)
                            .frame(height: 300)
                    }
                }

                if let debugConnectionRowsProvider {
                    settingsCard(title: "connections") {
                        debugConnectionsSection(rows: debugConnectionRowsProvider())
                    }
                }

                settingsCard(title: "max connections") {
                    Text(verbatim: "central (outbound): \(TransportConfig.bleMaxCentralLinks)")
                        .pilltalkFont(size: 12)
                        .foregroundColor(textColor)
                    Text(verbatim: "peripheral (inbound): \(TransportConfig.bleMaxPeripheralLinks)")
                        .pilltalkFont(size: 12)
                        .foregroundColor(textColor)
                }

                if let config = debugSyncConfigProvider?() {
                    settingsCard(title: "sync settings") {
                        Text(verbatim: "GCS max bytes: \(config.gcsMaxBytes)")
                            .pilltalkFont(size: 12)
                            .foregroundColor(textColor)
                        Text(verbatim: "GCS target FPR: \(config.gcsTargetFpr)")
                            .pilltalkFont(size: 12)
                            .foregroundColor(textColor)
                    }
                }

                if let snapshot = debugTrafficSnapshotProvider?() {
                    settingsCard(title: "packet traffic") {
                        debugTrafficSection(snapshot: snapshot)
                    }
                }

                if let debugScanResultRowsProvider {
                    settingsCard(title: "BLE scan results") {
                        debugScanResultsSection(rows: debugScanResultRowsProvider())
                    }
                }

                if let debugLogStore {
                    settingsCard(title: "debug log") {
                        DebugLogSection(store: debugLogStore)
                    }
                }
            }
            .padding()
        } else {
            debugPinEntryView
        }
    }

    private var debugPinEntryView: some View {
        VStack(spacing: 16) {
            Text(verbatim: "enter PIN")
                .pilltalkFont(size: 16, weight: .medium)
                .foregroundColor(textColor)
            SecureField("PIN", text: $debugPinEntry)
                #if os(iOS)
                .keyboardType(.numberPad)
                #endif
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 160)
                .onSubmit(attemptUnlock)
            Button("unlock", action: attemptUnlock)
                .buttonStyle(.borderedProminent)
            if showDebugPinError {
                Text(verbatim: "incorrect PIN")
                    .foregroundColor(.red)
                    .font(.caption)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func attemptUnlock() {
        if DebugAccessGate.matches(pin: debugPinEntry) {
            isDebugUnlocked = true
            showDebugPinError = false
        } else {
            showDebugPinError = true
        }
        debugPinEntry = ""
    }

    @ViewBuilder
    private func debugConnectionsSection(rows: [BLEService.DebugPeerConnectionRow]) -> some View {
        if rows.isEmpty {
            Text(verbatim: "no peers")
                .pilltalkFont(size: 12)
                .foregroundColor(secondaryTextColor)
        } else {
            ForEach(rows) { row in
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: row.nickname.isEmpty ? String(row.peerID.id.prefix(8)) : row.nickname)
                        .pilltalkFont(size: 12, weight: .semibold)
                        .foregroundColor(textColor)
                    Text(verbatim: "connected: \(row.isConnected ? "yes" : "no")  •  peripheral: \(row.hasPeripheral ? "yes" : "no")  •  central: \(row.hasCentral ? "yes" : "no")")
                        .pilltalkFont(size: 11)
                        .foregroundColor(secondaryTextColor)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @ViewBuilder
    private func debugTrafficSection(snapshot: BLEService.DebugTrafficSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            debugTrafficRow(label: "sent", s: snapshot.sentLastSecond, m: snapshot.sentLastMinute, q: snapshot.sentLast15Minutes, t: snapshot.sentTotal)
            debugTrafficRow(label: "received", s: snapshot.receivedLastSecond, m: snapshot.receivedLastMinute, q: snapshot.receivedLast15Minutes, t: snapshot.receivedTotal)
            debugTrafficRow(label: "relayed", s: snapshot.relayedLastSecond, m: snapshot.relayedLastMinute, q: snapshot.relayedLast15Minutes, t: snapshot.relayedTotal)
            Text(verbatim: "columns: 1s / 1m / 15m / total")
                .pilltalkFont(size: 10)
                .foregroundColor(secondaryTextColor)
        }
    }

    private func debugTrafficRow(label: String, s: Int, m: Int, q: Int, t: Int) -> some View {
        HStack {
            Text(verbatim: label)
                .pilltalkFont(size: 12, weight: .semibold)
                .foregroundColor(textColor)
            Spacer()
            Text(verbatim: "\(s) / \(m) / \(q) / \(t)")
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(secondaryTextColor)
        }
    }

    @ViewBuilder
    private func debugScanResultsSection(rows: [BLEConnectionScheduler<CBPeripheral>.DebugScanResultRow]) -> some View {
        if rows.isEmpty {
            Text(verbatim: "no unconnected candidates")
                .pilltalkFont(size: 12)
                .foregroundColor(secondaryTextColor)
        } else {
            ForEach(rows) { row in
                HStack {
                    Text(verbatim: row.nickname.isEmpty ? String(row.id.prefix(8)) : row.nickname)
                        .pilltalkFont(size: 12)
                        .foregroundColor(textColor)
                    Spacer()
                    Text(verbatim: "\(row.rssi) dBm")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(secondaryTextColor)
                }
            }
        }
    }

    // MARK: - Info pane

    @ViewBuilder
    private var infoContent: some View {
        VStack(alignment: .leading, spacing: 24) {
            // Header
            VStack(alignment: .center, spacing: 8) {
                Text(Strings.appName)
                    .pilltalkFont(size: 32, weight: .bold)
                    .foregroundColor(textColor)

                Text(Strings.tagline)
                    .pilltalkFont(size: 16)
                    .foregroundColor(secondaryTextColor)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical)

            // How to Use
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(Strings.HowToUse.title)

                Text(verbatim: Strings.HowToUse.paragraph)
                    .pilltalkFont(size: 14)
                    .foregroundColor(textColor)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Network diagnostics
            if topologyProvider != nil {
                VStack(alignment: .leading, spacing: 16) {
                    SectionHeader(Strings.Network.title)

                    Button {
                        showTopology = true
                    } label: {
                        HStack(spacing: 0) {
                            FeatureRow(info: Strings.Network.topology)
                            Image(systemName: "chevron.right")
                                .font(.pilltalkSystem(size: 12))
                                .foregroundColor(secondaryTextColor)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(Text("app_info.network.topology.hint"))
                }
            }

            // Features
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(Strings.Features.title)

                FeatureRow(info: Strings.Features.offlineComm)

                FeatureRow(info: Strings.Features.encryption)

                FeatureRow(info: Strings.Features.extendedRange)

                FeatureRow(info: Strings.Features.bridge)

                FeatureRow(info: Strings.Features.favorites)

                FeatureRow(info: Strings.Features.geohash)

                FeatureRow(info: Strings.Features.mentions)
            }

            // Privacy
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(Strings.Privacy.title)

                FeatureRow(info: Strings.Privacy.noTracking)

                FeatureRow(info: Strings.Privacy.ephemeral)

                FeatureRow(info: Strings.Privacy.panic)
            }

            // Symbols legend
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(Strings.Legend.title)

                ForEach(Strings.Legend.items, id: \.icon) { item in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: item.icon)
                            .font(.pilltalkSystem(size: 14))
                            .foregroundColor(item.color ?? textColor)
                            .frame(width: 30)

                        Text(item.text)
                            .pilltalkFont(size: 13)
                            .foregroundColor(secondaryTextColor)
                            .fixedSize(horizontal: false, vertical: true)

                        Spacer()
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .padding()
    }
}

struct AppInfoFeatureInfo {
    let icon: String
    let title: Text
    let description: Text

    /// Catalog-backed strings (existing keys).
    init(icon: String, title: LocalizedStringKey, description: LocalizedStringKey) {
        self.icon = icon
        self.title = Text(title)
        self.description = Text(description)
    }

    /// Pre-resolved strings — new keys that carry their English defaultValue
    /// inline until the i18n pass adds them to the catalog.
    init(icon: String, resolvedTitle: String, resolvedDescription: String) {
        self.icon = icon
        self.title = Text(resolvedTitle)
        self.description = Text(resolvedDescription)
    }
}

struct SectionHeader: View {
    private let title: Text
    @ThemedPalette private var palette

    private var textColor: Color { palette.primary }

    init(_ title: LocalizedStringKey) {
        self.title = Text(title)
    }

    /// For pre-resolved strings (new keys with inline defaultValue).
    init(verbatim title: String) {
        self.title = Text(title)
    }

    var body: some View {
        title
            .pilltalkFont(size: 16, weight: .bold)
            .foregroundColor(textColor)
            .padding(.top, 8)
    }
}

struct FeatureRow: View {
    let info: AppInfoFeatureInfo
    @ThemedPalette private var palette

    private var textColor: Color { palette.primary }

    private var secondaryTextColor: Color { palette.secondary }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: info.icon)
                .font(.pilltalkSystem(size: 20))
                .foregroundColor(textColor)
                .frame(width: 30)

            VStack(alignment: .leading, spacing: 4) {
                info.title
                    .pilltalkFont(size: 14, weight: .semibold)
                    .foregroundColor(textColor)

                info.description
                    .pilltalkFont(size: 12)
                    .foregroundColor(secondaryTextColor)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()
        }
    }
}

/// Debug log viewer (Task 9). Held as `@ObservedObject` so appended entries
/// re-render live. Newest last, monospaced, with a Clear action.
private struct DebugLogSection: View {
    @ObservedObject var store: DebugLogStore
    @ThemedPalette private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(verbatim: "\(store.entries.count) entries")
                    .pilltalkFont(size: 11)
                    .foregroundColor(palette.secondary)
                Spacer()
                Button("clear") { store.clear() }
                    .buttonStyle(.plain)
                    .pilltalkFont(size: 12)
                    .foregroundColor(palette.accent)
            }
            if store.entries.isEmpty {
                Text(verbatim: "no log entries")
                    .pilltalkFont(size: 12)
                    .foregroundColor(palette.secondary)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(store.entries) { entry in
                            Text(verbatim: "\(entry.timestamp.formatted(date: .omitted, time: .standard)) [\(entry.category)] \(entry.message)")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(palette.primary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                    }
                }
                .frame(maxHeight: 240)
            }
        }
    }
}

#Preview("Default") {
    AppInfoView()
        .environmentObject(LocationChannelsModel())
}

#Preview("Dynamic Type XXL") {
    AppInfoView()
        .environmentObject(LocationChannelsModel())
        .environment(\.sizeCategory, .accessibilityExtraExtraExtraLarge)
}

#Preview("Dynamic Type XS") {
    AppInfoView()
        .environmentObject(LocationChannelsModel())
        .environment(\.sizeCategory, .extraSmall)
}

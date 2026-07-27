# iOS Layout & Navigation Redesign

## Problem

The iOS app has no top-level navigation. `ContentView` is a single root screen (the public chat) with every other surface — private conversations, peer/geohash/bridge lists, groups, location channels, app info/settings — reached via `.sheet(...)` modifiers stacked on that one view (see `ContentView.swift`). This works but reads as visually dated/plain and buries features a user would expect to find directly.

## Goals

- Give the app real, persistent top-level navigation instead of sheet-stacking.
- Modernize the visual language toward standard iOS (SF fonts/components, HIG-aligned spacing) while keeping a distinct identity via a green→red gradient accent.
- Support both light and dark appearance, following the system setting.
- Do this without changing any mesh/BLE/Nostr protocol or view-model logic underneath — this is a presentation-layer change.

## Non-goals

- New chat/mesh features (separate spec).
- The debug/diagnostics section (separate spec, follows this one).
- Android changes — iOS only.

## Design

### Navigation shape

Replace the sheet-based root with SwiftUI's `NavigationSplitView`:

- **iPad / Mac Catalyst**: persistent sidebar, always visible.
- **iPhone**: `NavigationSplitView` automatically collapses the sidebar into a slide-in overlay (system-provided behavior — no custom gesture/overlay code needed).

Sidebar sections (top to bottom):
1. **Chats** — today's public/private conversation experience (`MessageListView`, `ContentComposerView`, `ContentHeaderView` content), becomes the split view's detail for the "Chats" selection.
2. **Nearby** — merges the current `MeshPeerList`, `GeohashPeopleList`, and `BridgePeopleList` sheets into one screen, presented as sectioned lists (Mesh Peers / Geohash / Bridge) rather than three separate sheet presentations.
3. **Groups** — today's `GroupChatList` sheet becomes its own sidebar destination.
4. **Settings** — today's `AppInfoView` (Info/Settings segmented sheet: language, PTT voice, connectivity, panic button) becomes the last sidebar destination. This is also the future home for the Debug section (next spec).

`LocationChannelsSheet`, `FingerprintView`, `VerificationViews`, image pickers/previews, and alerts stay as sheets/covers presented from whichever destination is active — those are contextual overlays, not top-level nav.

### Affected files

- `Views/ContentView.swift` — becomes the "Chats" detail view; loses `showSidebar`/sheet-presentation plumbing for peers/groups/app-info (`ContentPeopleSheetView` sheet, `AppInfoView` sheet) since those move to sidebar destinations.
- **New**: `Views/RootSplitView.swift` (or similar) — owns the `NavigationSplitView`, sidebar list, and destination routing/selection state.
- **New**: `Views/NearbyView.swift` — hosts the merged Mesh Peers / Geohash / Bridge sections (composing existing `MeshPeerList`, `GeohashPeopleList`, `BridgePeopleList` views/subviews rather than rewriting their internals).
- `Views/AppInfoView.swift` — presented as a sidebar destination instead of (or in addition to, during transition) a sheet triggered by `appChromeModel.isAppInfoPresented`.
- `App/AppChromeModel.swift` — sidebar-presentation flags (`isAppInfoPresented`, peer-sheet `showSidebar` state) replaced with a `selectedDestination` (enum: chats/nearby/groups/settings) published property driving the split view's selection binding.

Mesh/Nostr/Noise layers, `ChatViewModel` and its extensions, and all `App/*Model.swift` business logic are untouched — this is routing/composition only.

### Theming

- Introduce a green→red gradient (`LinearGradient`, roughly `#2FBF71 → #E14B4B`) as the brand/accent treatment: app name/logo mark, active sidebar item highlight, primary buttons, avatar placeholders.
- Add both a light and a dark color set to the asset catalog (`Assets.xcassets`) for background/surface/text tokens, and make sure custom colors currently hardcoded for a dark-only look (if any, e.g. in `ThemedRootBackground`) get light-mode counterparts. Existing `@ThemedPalette`/`appTheme` plumbing (already environment-driven per `ContentView`) is the natural place to add the light variant rather than introducing a second theming system.
- Destructive/danger UI (panic button, disconnect actions) keeps using red on its own, consistent with today.

### Data flow / state

No changes to message/peer/protocol data flow. The only new state is navigation selection (which sidebar destination is active), owned by `AppChromeModel` (already the app's chrome/UI-state owner) and read by the new `RootSplitView`.

### Error handling

No new error paths — existing alerts (`Bluetooth required`, `Recording Error`) continue to present from wherever they're relevant (likely still attached to the Chats detail view, since they're chat/voice-specific).

### Testing

- Manual verification on-device (iPhone via Sideloadly) and in Simulator (iPad, to confirm split view persists there) for: sidebar navigation between all four destinations, light/dark switching, and that no existing sheet (fingerprint, image preview, location channels) regresses.
- `pilltalkTests` gets no new logic to unit test (this is a SwiftUI composition change); existing tests (`PilltalkPeerTests`, `FontPilltalkTests`) should continue passing unmodified.

# iOS Debug Section

## Problem

Android's `DebugSettingsSheet.kt` gives developers/testers live visibility into the mesh: topology, connection state, transport toggles, packet traffic, a scrolling debug log, and BLE scan results. iOS has none of this — the only diagnostic surface today is `MeshTopologyView`, reachable only indirectly via `AppChromeModel.meshTopologyDisplayModel()`.

## Goals

- Port every Android debug-sheet capability that has a real iOS equivalent, building the missing plumbing rather than skipping it.
- Gate it behind a PIN so it isn't casually stumbled into by anyone else running the app.
- Keep it read-only/observational wherever Android's is (no new mutation surface beyond what's specified below).

## Non-goals

- Wi-Fi Aware panel — no iOS equivalent technology exists; not ported.
- Making sync/GCS filter values user-adjustable — this pass surfaces them read-only, matching how little value adjustable sliders add without also plumbing persistence/validation.
- A separate Debug-configuration build pipeline — the new debug log channel is designed to work in the Release build you actually sideload.

## Design

### Placement and access gate

Add `case debug` to `AppInfoView`'s private `Pane` enum (`Views/AppInfoView.swift:33-36`), a third segment in the existing `panePicker` (`:256-260`), and a `.debug: debugContent` branch in `paneContent`'s switch (`:267-`).

The Debug segment is gated by a PIN sheet: selecting it for the first time in an app session presents a numeric PIN entry view; on match, `debugContent` renders and stays unlocked for the rest of that process's lifetime (in-memory flag only — no persistence, so restarting the app re-locks it). The PIN itself is a hardcoded constant, compared as a SHA-256 hash (not stored in source as plaintext) — this is a casual-use deterrent, not cryptographic security, consistent with a single-user personal app.

The PIN is `8063`; its SHA-256 hash (hex, lowercase) is `ae08ef776d536d49e5fea11b34a4f2cf981195fee6ec8cfb058ae2686a9d0166`. The comparison hashes the entered digits with `CryptoKit.SHA256` and compares hex strings — no plaintext PIN appears anywhere in source.

### Debug pane sections (mirrors Android's ordering)

1. **Mesh topology** — embeds `MeshTopologyView` with the same `{ appChromeModel.meshTopologyDisplayModel() }` provider `RootSplitView` already uses (`Views/RootSplitView.swift:80`). No new code beyond composition.

2. **Connection state** — a list of currently-connected peers (nickname, `isConnected`/reachable, role, RSSI), built on `BLEService.currentPeerSnapshots()` (`Services/BLE/BLEService.swift:633`) extended with:
   - A new internal (not private) accessor on `BLEService` exposing role (central/peripheral) per peer, built from the existing `BLELinkStateStore.directLinkState(for:)` (`Services/BLE/BLELinkStateStore.swift:154-160`) — promote the existing private wrappers (`snapshotDirectPeripheralState`/`snapshotSubscribedCentrals`, `BLEService.swift:4361-4371`) to internal visibility rather than duplicating their logic.
   - New RSSI-while-connected tracking: periodic `CBPeripheral.readRSSI()` calls (CoreBluetooth already provides this API; nothing today calls it post-connection) on a short interval (e.g. every 5s while the debug pane is visible), publishing the latest reading per connected peripheral. Scoped to only run while the debug pane is on-screen, to avoid any always-on battery cost.

3. **Max connections** — read-only display of `TransportConfig.bleMaxCentralLinks` (`Services/BLE/TransportConfig.swift:60`). Add a new `bleMaxPeripheralLinks` constant (mirroring Android's dual server/client cap) and enforce it in `BLELinkStateStore`'s incoming-subscription acceptance path, since today incoming peripheral connections are unbounded — surfacing "unbounded" as a debug fact without addressing it would be a half-measure.

4. **Sync/GCS settings** — read-only display of `GossipSyncManager`'s current config (`Sync/GossipSyncManager.swift:63-66`: `gcsMaxBytes`, `gcsTargetFpr`) via a new read accessor on `GossipSyncManager` (today only a private/internal `Config` struct instance, no getter exposed to callers outside the sync subsystem).

5. **Packet relay stats** — new counters: sent/received/relayed totals plus time-windowed buckets (last-second/last-minute/last-15-minutes/total, matching Android), incremented at the same points fragments already pass through today (`Services/BLE/BLEOutboundFragmentPlanner.swift`, `BLEOutboundFragmentTransferScheduler.swift`). New small `PacketTrafficCounter` type (ring-buffer of timestamped counts, queried for each window on demand) — genuinely new infrastructure, no existing counters to build on.

6. **BLE scan results** — read-only list of discovered-but-not-yet-connected peripherals (nickname if known, RSSI, discovered-at), exposing `BLEConnectionScheduler`'s private `candidates` array (today only `candidateCount` is public) via a new read accessor returning lightweight `BLEScanResultRow` structs (id/nickname/rssi/discoveredAt) rather than the full internal `BLEConnectionCandidate` type.

7. **Debug message log** — a new `DebugLogStore` (`@MainActor final class DebugLogStore: ObservableObject`), holding a capped ring buffer (~500 entries) of `(timestamp, category, message)`, independent of `SecureLogger`/`BitLogger` and NOT wrapped in `#if DEBUG` — this is the one piece designed to work in the Release build you actually run. Fed by explicit calls at a handful of key event sites: peer connect/disconnect (`BLEPeerRegistry`), scan discovery (`BLEConnectionScheduler.enqueue`), and packet relay decisions (wherever Section 5's counters increment, so both features share the same instrumentation points). A "clear" action empties the buffer. No verbose/quiet toggle — since this store is intentionally separate from `SecureLogger`'s existing level system, it always logs the fixed set of event types it's instrumented for; adding a granularity toggle is deferred unless the fixed set proves too noisy or too sparse in practice.

### Data flow

All debug data is pull-based (computed properties / `@Published` state read when the pane is visible) except the new RSSI polling and the debug log store, which are the only two "always tracking while visible" pieces — both explicitly scoped to avoid background cost.

### Testing

- New non-view logic (`PacketTrafficCounter`'s time-window bucketing, `DebugLogStore`'s ring-buffer capping/clearing, the PIN hash comparison, the new `BLEService`/`BLELinkStateStore`/`GossipSyncManager`/`BLEConnectionScheduler` read accessors) gets unit tests, following this project's existing XCTest conventions.
- The debug pane's SwiftUI composition itself has no automated coverage (consistent with the rest of this app's views) — manual verification once built.

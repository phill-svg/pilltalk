# iOS Feature Roadmap

## Purpose

Tracks the full set of features agreed on during brainstorming (2026-07-27), covering Android-parity gaps and fresh ideas for iOS. This is a roadmap/index, not a design doc — each item below gets its own brainstorm → spec → implementation cycle when its turn comes, same as the [layout/navigation redesign](2026-07-27-ios-layout-navigation-design.md).

## Sequencing

Tier 1 (highest value / do first):
1. **Onboarding & permission-rationale flow** — guided explanation before each OS permission prompt (Bluetooth, location, notifications), matching Android's `OnboardingCoordinator.kt` flow. No current iOS equivalent; permissions are requested as bare system prompts today.
2. **Quick-action sheet** — tap-target sheet for slap/hug/block/PM/copy on a user, matching Android's `ChatUserSheet.kt`. Today these (except block, which has a sheet) are typed-command-only (`/slap`, `/hug`).
3. **Identity backup/export via QR** — deliberate "show my identity as QR / scan to restore" flow, reusing the existing camera/QR verification infra (`VerificationViews.swift`, `FingerprintView.swift`). Currently the only way to lose or regenerate identity is the destructive panic wipe; there's no backup path.

Tier 2:
4. **Location Notes UI** — a view for the already-existing `LocationNotesManager`/`LocationNotesPool`/`LocationNotesSettings` backend, matching Android's `LocationNotesSheet.kt`. Service layer is done; only the SwiftUI view is missing.
5. **Link previews** — inline URL preview rendering in message bubbles, matching Android's `LinkPreviewPill.kt`.
6. **Message reactions** — quick emoji reactions on a message. Not present on either platform today.
7. **Proof-of-work status indicator** — user-facing display of the Nostr PoW mining already happening in `Nostr/NostrPoW.swift`, matching Android's `PoWStatusIndicator.kt`.

Tier 3 (bigger lift, do later):
8. **iOS widget / Live Activity** — glanceable live nearby-peer count on the Home/Lock Screen. iOS-exclusive; no Android equivalent surface.
9. **watchOS companion app** — glanceable peer count and canned quick-replies from an Apple Watch.

## Status

All nine items are agreed as in-scope. None are designed in detail yet. Next: brainstorm Tier 1 item #1 (onboarding/permission flow) in full, following the same process as the layout redesign.

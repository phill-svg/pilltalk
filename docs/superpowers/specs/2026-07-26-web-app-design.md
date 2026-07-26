# PillTalk Web App — Design Spec

Date: 2026-07-26
Status: Approved by user, pending implementation plan

## 1. Purpose

PillTalk (this project) is an independent fork of [bitchat](https://github.com/permissionlesstech/bitchat), rebranded and de-linked from the original maintainers. The Swift app covers iOS/macOS. This spec defines a **web app** companion that talks to the *same* underlying network — so a browser user and a native-app user can land in the same geohash chat room and send each other direct messages — without requiring any custom backend.

## 2. Goals / Non-Goals

**Goals**
- Full interop with the native app's geohash location channels (same Nostr event kinds, tags, and precision/presence rules).
- Direct, low-latency 1:1 chat between two browser peers when both are online, using WebRTC.
- Store-and-forward DM delivery when direct connection isn't available, via Nostr (NIP-17), matching the native app's "Bluetooth first, Nostr fallback" behavior.
- Zero custom backend: static hosting only, relying on public Nostr relays and public STUN servers.
- No accounts, no phone numbers, no persistent server-side identity — matching the project's privacy stance.

**Non-Goals (v1)**
- No Bluetooth/local mesh (not available to browsers) — WebRTC direct connections are the browser's equivalent of "local", not a literal LAN-only mechanism.
- No multi-peer WebRTC mesh/group calls — group chat happens through geohash channels over Nostr, not over WebRTC. WebRTC is 1:1 only in v1.
- No TURN relay server of our own — NAT traversal that fails over public STUN falls back to the Nostr-relayed DM path rather than adding a TURN server to run/pay for.
- No push notifications in v1 (the Swift app already has push via APNs; web push can be a later addition once the core client works).

## 3. Architecture

Fully static single-page app (vanilla TypeScript, no framework), deployed to Cloudflare Pages. All "backend" behavior is provided by external, already-public infrastructure:

```
┌─────────────────────────┐        WebSocket        ┌──────────────────┐
│  Browser (PillTalk web) │ ───────────────────────► │  Public Nostr    │
│                          │ ◄─────────────────────── │  relays (N of)   │
│  - Identity (secp256k1)  │   geohash chat/presence   └──────────────────┘
│  - Geohash channel view  │   NIP-17 gift-wrapped DMs
│  - DM inbox              │   WebRTC signaling (as DMs)
│  - WebRTC direct chat    │
└───────────┬──────────────┘
            │ RTCPeerConnection + DataChannel (direct, once signaled)
            ▼
┌──────────────────────────┐
│ Browser (peer, PillTalk  │
│ web or native app*)      │
└──────────────────────────┘

* Native app does not implement WebRTC; peer-to-peer direct chat via
  WebRTC is web-to-web only in v1. Web-to-native DMs always go through
  Nostr NIP-17 relay delivery.
```

## 4. Components

### 4.1 Identity Manager
- Generates a secp256k1 keypair client-side on first run (via a small, audited crypto library — e.g. `@noble/curves` or `@noble/secp256k1`).
- Persists the private key in `localStorage`, scoped to the app origin. This is the browser's equivalent of the native app's Keychain-stored identity.
- Exposes a "Wipe" action that clears `localStorage` and all in-memory state, mirroring the native app's triple-tap emergency wipe.
- Nickname is a local display label only (like the native app), not tied to identity.

### 4.2 Relay Connection Pool
- Maintains WebSocket connections to a small, hardcoded list of public Nostr relays (seeded from the same/similar relay list the native app ships with, e.g. `relays/online_relays_gps.csv` in this repo — pick the top N by reliability rather than connecting to all 290+).
- Handles reconnect/backoff per relay independently; a channel or DM is considered delivered once acknowledged by at least one connected relay.
- Deduplicates incoming events by event ID across relays.

### 4.3 Geohash Channel Client
- Given a geohash string (derived from the user's chosen location precision — city/neighborhood/block/etc., matching the six precision levels in the native app's `GeohashPresenceSpec`), subscribes to:
  - Kind `20000` (chat) events tagged `["g", "<geohash>"]`.
  - Kind `20001` (presence) events tagged `["g", "<geohash>"]`.
- Publishes chat messages as kind `20000` with `["g", "<geohash>"]` and `["n", "<nickname>"]` tags, signed with a geohash-derived ephemeral key (not the user's main identity key), exactly as the native app does — this is required for wire compatibility and for the same privacy properties (per-area ephemeral identity).
- Broadcasts presence heartbeats (kind `20001`) at randomized 40–80s intervals, only for precision levels ≤5 (region through city), matching the native app's privacy rule for higher-precision (block/building) channels.
- Tracks `pubkey → last_seen` per geohash; a participant is "online" if seen within 5 minutes. Displays exact counts for precision ≤5, `[? people]` for higher precision (identical UI rule to native).

### 4.4 Direct Message Manager
- Two delivery paths, chosen automatically per-peer:
  1. **WebRTC direct** (preferred, once established): messages go straight over an `RTCDataChannel`, no relay involved.
  2. **Nostr NIP-17 fallback**: gift-wrapped events sent to relays, addressed to the recipient's public key. Used when no direct channel exists yet, or WebRTC setup fails.
- On startup, attempts to open a WebRTC connection to any peer the user has an existing conversation with (see 4.5), upgrading in place from relay-delivered to direct once connected — mirroring "Bluetooth first, Nostr fallback" without the user noticing a transport switch.
- The upgrade attempt is not one-shot: each relay-fallback send re-attempts the WebRTC handshake for that peer if the last attempt was more than a cooldown period ago (30s in v1) and no direct channel is currently open. This covers both "the peer was offline/ICE failed the first time" and "a previously-open direct channel later closed" with one uniform, time-based rule, so a conversation keeps opportunistically retrying the upgrade for as long as messages keep flowing over relay.

### 4.5 WebRTC Signaling-over-Nostr
- No signaling server. To connect to peer B, peer A:
  1. Creates an `RTCPeerConnection` with public STUN servers configured (e.g. Google's `stun:stun.l.google.com:19302`).
  2. Creates an SDP offer, wraps it as a NIP-17 gift-wrapped DM to B's pubkey, with a distinguishing tag (e.g. `["t", "webrtc-offer"]`) so it's routed to the signaling handler rather than the chat UI.
  3. B, listening for such tagged DMs, creates an answer and sends it back the same way; both sides exchange ICE candidates as further tagged DMs.
  4. Once the data channel opens, both sides mark that peer as "direct" and prefer it for further messages.
- If no answer / no successful `RTCDataChannel.onopen` within a short timeout (~10s), fall back to pure relay delivery for that conversation. **v1 implementation note:** rather than the more elaborate "retry next time both peers are seen active in a shared geohash channel" (which would require `DmManager` to observe `GeohashChannel`/presence state, coupling two otherwise-independent modules), v1 uses a simple per-peer cooldown: `DmManager` tracks the timestamp of the last WebRTC attempt per peer, and re-attempts on the next relay-fallback `sendMessage` call if more than `WEBRTC_RETRY_COOLDOWN_MS` (30s) has elapsed and no direct channel is currently open for that peer. This achieves the same practical goal — the connection keeps trying to upgrade opportunistically as the conversation continues — with a single, self-contained, easily-testable rule instead of cross-module presence coupling. A future iteration could reintroduce presence-triggered retries as an additional (not replacement) trigger if the 30s cooldown proves too slow in practice.

### 4.6 UI
- Single-page layout, closely mirroring the native app's structure: a channel/conversation list (geohash rooms + DM threads) and a message thread pane.
- Location precision selector (region/province/city/neighborhood/block) drives which geohash the user is currently viewing — client computes the geohash from browser geolocation (with explicit permission prompt) or manual entry, never sent anywhere except as the geohash tag itself.
- Connection indicator per DM thread: "direct" vs "relayed", so users understand which transport is active (transparency matches the native app's ethos).

## 5. Data Flow Summary

- **Joining a geohash room**: compute/select geohash → derive ephemeral key for that geohash → subscribe on all connected relays for kind 20000/20001 with that `g` tag → render incoming events → publish own messages/presence signed with the ephemeral key.
- **Starting a DM**: look up recipient pubkey (from a channel participant or manually entered) → attempt WebRTC handshake over Nostr signaling DMs → send message via whichever path is ready; if direct isn't ready in time, send via NIP-17 relay DM immediately (don't block the user's message on signaling).
- **Wiping data**: clear `localStorage`, close all `RTCPeerConnection`s, disconnect all relay sockets, reload to a fresh-identity state.

## 6. Error Handling

- Relay unreachable: retry with exponential backoff (cap ~30s), continue operating on remaining connected relays; surface a subtle "N/M relays connected" indicator rather than blocking the UI.
- WebRTC/ICE failure: fall back silently to relay delivery; never surface a hard error to the user for this — it's an internal optimization, not a user-facing requirement.
- Geolocation permission denied: fall back to manual geohash/region entry; app remains fully usable.
- Malformed/unparseable incoming events: drop and log to console; never let one bad event break the channel subscription.

## 7. Testing

- Unit tests (Vitest or similar) for: geohash precision derivation, ephemeral key derivation per geohash, event (de)serialization for kinds 20000/20001, NIP-17 gift-wrap encode/decode.
- Integration test harness: two headless browser contexts (Playwright) both connected to a local/test Nostr relay (e.g. a throwaway `strfry` or `nostr-rs-relay` instance spun up for the test run) to verify: two clients see each other's geohash chat messages; two clients can complete WebRTC signaling-over-Nostr and exchange a message directly; wipe action clears state.
- Manual interop check against the native PillTalk (Swift) app once both exist: confirm a real geohash room is shared and messages are visible cross-platform.

## 8. Open Items for Later (explicitly out of scope now)

- Web push notifications.
- TURN relay for NAT traversal in restrictive networks.
- Multi-peer WebRTC group chat.
- Any server-side component (deliberately avoided in this design).

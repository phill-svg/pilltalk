# PillTalk Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, backend-free web client (`web/`) that interoperates with the PillTalk Swift app's geohash chat rooms over Nostr, and supports direct 1:1 chat over WebRTC signaled through Nostr DMs.

**Architecture:** Vanilla TypeScript + Vite, deployed as a static site to Cloudflare Pages. All networking is client-side: a `RelayPool` maintains WebSocket connections to public Nostr relays; a `GeohashChannel` publishes/subscribes wire-compatible geohash chat/presence events (kind 20000/20001); a `DmManager` sends/receives NIP-17 gift-wrapped DMs over the same relays, upgrading to a direct `RTCPeerConnection` data channel when possible, with the WebRTC offer/answer/ICE handshake itself carried as tagged Nostr DMs (no signaling server).

**Tech Stack:** TypeScript, Vite, Vitest, `@noble/curves`, `@noble/hashes`, `@noble/ciphers` (audited, dependency-free crypto primitives — no `nostr-tools`, so we control the exact wire format for interop debugging), native browser `WebSocket`/`RTCPeerConnection`, Cloudflare Pages + Wrangler for deploy.

## Global Constraints

- No custom backend, no database, no signaling server — spec section 2/3. All "infrastructure" is public Nostr relays and public STUN servers.
- Geohash channel events MUST use kind `20000` (chat) and `20001` (presence) with `["g", "<geohash>"]` and `["n", "<nickname>"]` tags, matching the native app's wire format — spec section 4.3.
- Presence heartbeats only broadcast for geohash precision ≤ 5 (region/province/city); never for neighborhood/block — spec section 4.3.
- A participant is "online" if last seen within 5 minutes — spec section 4.3.
- DMs use NIP-17 (rumor → seal → gift wrap), never plaintext or unwrapped events — spec section 4.4.
- WebRTC is 1:1 only in v1; no multi-peer mesh — spec section 2 (Non-Goals).
- No TURN server; on WebRTC/ICE failure, fall back silently to relay-delivered DMs — spec section 6.
- Identity is a client-generated secp256k1 keypair persisted in `localStorage`; no accounts, no phone numbers — spec section 4.1.
- A "Wipe" action must clear `localStorage`, close all peer connections, and disconnect all relay sockets — spec section 4.1 / 5.

---

## File Structure

All new code lives under `web/` at the repo root, alongside the existing Swift app.

```
web/
  package.json
  tsconfig.json
  vite.config.ts              # includes Vitest config (test.environment = 'jsdom')
  index.html
  wrangler.toml
  src/
    nostr/
      event.ts                # NIP-01 event id/sign/verify core
      event.test.ts
    identity/
      identity.ts             # keypair persistence + wipe
      identity.test.ts
    geohash/
      geohash.ts               # geohash encode, precision table, ephemeral key derivation
      geohash.test.ts
    relay/
      relayPool.ts             # WebSocket pool: connect, reconnect, dedupe, pub/sub
      relayPool.test.ts
    testutil/
      inMemoryRelayPool.ts     # in-memory RelayPoolLike fake for downstream tests
      inMemoryRelayPool.test.ts
    channel/
      geohashChannel.ts        # geohash chat/presence pub/sub + participant tracking
      geohashChannel.test.ts
    crypto/
      nip44.ts                 # NIP-44 v2 conversation-key encryption
      nip44.test.ts
    dm/
      giftWrap.ts               # NIP-17 rumor/seal/gift-wrap
      giftWrap.test.ts
      dmManager.ts               # relay DM send/receive, then WebRTC upgrade (Task 11 modifies)
      dmManager.test.ts
    webrtc/
      signaling.ts               # RTCPeerConnection wrapper + Nostr-carried handshake
      signaling.test.ts
    ui/
      render.ts                  # pure DOM-rendering helper functions
      render.test.ts
      main.ts                    # app entry point, wires all modules together
```

Each module exposes a small interface (`RelayPoolLike`, `PeerConnectionLike`, `IdentityStorage`) so downstream modules and tests depend on the interface, not a concrete browser API — this is what makes everything testable under Vitest/jsdom without a real network or real WebRTC stack.

---

## Task 1: Project Scaffold

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.ts` (placeholder entry, replaced fully in Task 12)
- Test: `web/src/smoke.test.ts`

**Interfaces:**
- Produces: a working `npm run build` / `npm run test` / `npm run dev` setup that every later task relies on.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "pilltalk-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "test": "vitest run",
    "deploy": "wrangler pages deploy dist --project-name=pilltalk"
  },
  "dependencies": {
    "@noble/ciphers": "^1.0.0",
    "@noble/curves": "^1.6.0",
    "@noble/hashes": "^1.5.0"
  },
  "devDependencies": {
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 4: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PillTalk</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create placeholder `web/src/main.ts`**

```ts
document.getElementById('app')!.textContent = 'PillTalk loading...';
```

- [ ] **Step 6: Write the smoke test**

```ts
// web/src/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('project scaffold', () => {
  it('runs a basic assertion under vitest + jsdom', () => {
    document.body.innerHTML = '<div id="app"></div>';
    expect(document.getElementById('app')).not.toBeNull();
  });
});
```

- [ ] **Step 7: Install dependencies and run the test**

Run: `cd web && npm install && npm run test`
Expected: PASS (1 test), no TypeScript errors.

- [ ] **Step 8: Verify the build**

Run: `npm run build`
Expected: exits 0, produces `web/dist/index.html`.

- [ ] **Step 9: Commit**

```bash
git add web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts web/index.html web/src/main.ts web/src/smoke.test.ts
git commit -m "chore: scaffold web app with Vite, TypeScript, and Vitest"
```

---

## Task 2: Nostr Event Core

**Files:**
- Create: `web/src/nostr/event.ts`
- Test: `web/src/nostr/event.test.ts`

**Interfaces:**
- Consumes: `@noble/curves/secp256k1` (`schnorr`, `secp256k1`), `@noble/hashes/sha256` (`sha256`), `@noble/hashes/utils` (`bytesToHex`, `hexToBytes`, `utf8ToBytes`).
- Produces:
  - `interface NostrEvent { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }`
  - `type UnsignedEvent = Omit<NostrEvent, 'id' | 'sig'>`
  - `computeEventId(event: UnsignedEvent): string`
  - `signEvent(event: UnsignedEvent, privateKeyHex: string): NostrEvent`
  - `verifyEvent(event: NostrEvent): boolean`
  - `getPublicKey(privateKeyHex: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/nostr/event.test.ts
import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey, signEvent, verifyEvent, computeEventId, type UnsignedEvent } from './event';

describe('nostr event core', () => {
  const privateKeyHex = bytesToHex(secp256k1.utils.randomPrivateKey());
  const pubkey = getPublicKey(privateKeyHex);

  it('computes a deterministic 32-byte hex id from the unsigned fields', () => {
    const unsigned: UnsignedEvent = { pubkey, created_at: 1700000000, kind: 1, tags: [], content: 'hello' };
    const id = computeEventId(unsigned);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEventId(unsigned)).toBe(id);
  });

  it('signs an event and produces a signature that verifies', () => {
    const unsigned: UnsignedEvent = { pubkey, created_at: 1700000000, kind: 1, tags: [], content: 'hello' };
    const signed = signEvent(unsigned, privateKeyHex);
    expect(verifyEvent(signed)).toBe(true);
  });

  it('rejects a signed event whose content was tampered with after signing', () => {
    const unsigned: UnsignedEvent = { pubkey, created_at: 1700000000, kind: 1, tags: [], content: 'hello' };
    const signed = signEvent(unsigned, privateKeyHex);
    const tampered = { ...signed, content: 'goodbye' };
    expect(verifyEvent(tampered)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/nostr/event.test.ts`
Expected: FAIL — `Cannot find module './event'`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/nostr/event.ts
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type UnsignedEvent = Omit<NostrEvent, 'id' | 'sig'>;

export function serializeEvent(event: UnsignedEvent): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export function computeEventId(event: UnsignedEvent): string {
  return bytesToHex(sha256(utf8ToBytes(serializeEvent(event))));
}

export function signEvent(event: UnsignedEvent, privateKeyHex: string): NostrEvent {
  const id = computeEventId(event);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(privateKeyHex)));
  return { ...event, id, sig };
}

export function verifyEvent(event: NostrEvent): boolean {
  const { id, sig, ...unsigned } = event;
  if (computeEventId(unsigned) !== id) return false;
  return schnorr.verify(hexToBytes(sig), hexToBytes(id), hexToBytes(event.pubkey));
}

export function getPublicKey(privateKeyHex: string): string {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privateKeyHex)));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/nostr/event.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/nostr/event.ts web/src/nostr/event.test.ts
git commit -m "feat(web): add NIP-01 event id/sign/verify core"
```

---

## Task 3: Identity Manager

**Files:**
- Create: `web/src/identity/identity.ts`
- Test: `web/src/identity/identity.test.ts`

**Interfaces:**
- Consumes: `getPublicKey` from `../nostr/event.ts` (Task 2); `secp256k1` from `@noble/curves/secp256k1`; `bytesToHex` from `@noble/hashes/utils`.
- Produces:
  - `interface Identity { privateKeyHex: string; publicKeyHex: string }`
  - `interface IdentityStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }`
  - `loadOrCreateIdentity(storage: IdentityStorage): Identity`
  - `wipeIdentity(storage: IdentityStorage): void`
  - `IdentityStorage` is satisfied by `window.localStorage` directly (used in Task 12); tests use an in-memory fake.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/identity/identity.test.ts
import { describe, it, expect } from 'vitest';
import { loadOrCreateIdentity, wipeIdentity, type IdentityStorage } from './identity';

function createFakeStorage(): IdentityStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

describe('identity manager', () => {
  it('creates a new identity with a valid hex keypair on first load', () => {
    const storage = createFakeStorage();
    const identity = loadOrCreateIdentity(storage);
    expect(identity.privateKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same identity across repeated loads', () => {
    const storage = createFakeStorage();
    const first = loadOrCreateIdentity(storage);
    const second = loadOrCreateIdentity(storage);
    expect(second.privateKeyHex).toBe(first.privateKeyHex);
  });

  it('creates a fresh, different identity after a wipe', () => {
    const storage = createFakeStorage();
    const before = loadOrCreateIdentity(storage);
    wipeIdentity(storage);
    const after = loadOrCreateIdentity(storage);
    expect(after.privateKeyHex).not.toBe(before.privateKeyHex);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/identity/identity.test.ts`
Expected: FAIL — `Cannot find module './identity'`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/identity/identity.ts
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey } from '../nostr/event';

const STORAGE_KEY = 'pilltalk.identity.privkey';

export interface Identity {
  privateKeyHex: string;
  publicKeyHex: string;
}

export interface IdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadOrCreateIdentity(storage: IdentityStorage): Identity {
  const existing = storage.getItem(STORAGE_KEY);
  const privateKeyHex = existing ?? bytesToHex(secp256k1.utils.randomPrivateKey());
  if (!existing) storage.setItem(STORAGE_KEY, privateKeyHex);
  return { privateKeyHex, publicKeyHex: getPublicKey(privateKeyHex) };
}

export function wipeIdentity(storage: IdentityStorage): void {
  storage.removeItem(STORAGE_KEY);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/identity/identity.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/identity/identity.ts web/src/identity/identity.test.ts
git commit -m "feat(web): add browser-local identity keypair manager"
```

---

## Task 4: Geohash Utilities

**Files:**
- Create: `web/src/geohash/geohash.ts`
- Test: `web/src/geohash/geohash.test.ts`

**Interfaces:**
- Consumes: `hmac` from `@noble/hashes/hmac`; `sha256` from `@noble/hashes/sha256`; `secp256k1` from `@noble/curves/secp256k1`; `bytesToHex`, `hexToBytes`, `utf8ToBytes` from `@noble/hashes/utils`.
- Produces:
  - `geohashEncode(latitude: number, longitude: number, precision: number): string`
  - `const GEOHASH_PRECISION = { region: 2, province: 4, city: 5, neighborhood: 6, block: 7 }`
  - `broadcastsPresence(precision: number): boolean`
  - `deriveGeohashKey(masterPrivateKeyHex: string, geohash: string): string` — returns a hex private key, used by Task 6.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/geohash/geohash.test.ts
import { describe, it, expect } from 'vitest';
import { geohashEncode, broadcastsPresence, deriveGeohashKey, GEOHASH_PRECISION } from './geohash';

describe('geohash utilities', () => {
  it('encodes a known lat/lon into the expected geohash prefix', () => {
    // Wikipedia's canonical Geohash worked example.
    expect(geohashEncode(57.64911, 10.40744, 5)).toBe('u4pru');
  });

  it('produces longer, more precise geohashes as precision increases', () => {
    const short = geohashEncode(57.64911, 10.40744, 5);
    const long = geohashEncode(57.64911, 10.40744, 7);
    expect(long.startsWith(short)).toBe(true);
    expect(long).toHaveLength(7);
  });

  it('only broadcasts presence at region/province/city precision, not neighborhood/block', () => {
    expect(broadcastsPresence(GEOHASH_PRECISION.region)).toBe(true);
    expect(broadcastsPresence(GEOHASH_PRECISION.city)).toBe(true);
    expect(broadcastsPresence(GEOHASH_PRECISION.neighborhood)).toBe(false);
    expect(broadcastsPresence(GEOHASH_PRECISION.block)).toBe(false);
  });

  it('derives a deterministic, valid, per-geohash private key from a master key', () => {
    const master = 'a'.repeat(64);
    const key1 = deriveGeohashKey(master, 'u4pru');
    const key2 = deriveGeohashKey(master, 'u4pru');
    const key3 = deriveGeohashKey(master, 'u4prv');
    expect(key1).toMatch(/^[0-9a-f]{64}$/);
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/geohash/geohash.test.ts`
Expected: FAIL — `Cannot find module './geohash'`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/geohash/geohash.ts
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohashEncode(latitude: number, longitude: number, precision: number): string {
  const latRange: [number, number] = [-90, 90];
  const lonRange: [number, number] = [-180, 180];
  let isEven = true;
  let bit = 0;
  let ch = 0;
  let geohash = '';

  while (geohash.length < precision) {
    if (isEven) {
      const mid = (lonRange[0] + lonRange[1]) / 2;
      if (longitude >= mid) {
        ch |= 1 << (4 - bit);
        lonRange[0] = mid;
      } else {
        lonRange[1] = mid;
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (latitude >= mid) {
        ch |= 1 << (4 - bit);
        latRange[0] = mid;
      } else {
        latRange[1] = mid;
      }
    }
    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return geohash;
}

export const GEOHASH_PRECISION = {
  region: 2,
  province: 4,
  city: 5,
  neighborhood: 6,
  block: 7,
} as const;

export function broadcastsPresence(precision: number): boolean {
  return precision <= GEOHASH_PRECISION.city;
}

export function deriveGeohashKey(masterPrivateKeyHex: string, geohash: string): string {
  let counter = 0;
  while (true) {
    const material = hmac(
      sha256,
      hexToBytes(masterPrivateKeyHex),
      utf8ToBytes(`pilltalk-geohash:${geohash}:${counter}`),
    );
    if (secp256k1.utils.isValidPrivateKey(material)) return bytesToHex(material);
    counter++;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/geohash/geohash.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/geohash/geohash.ts web/src/geohash/geohash.test.ts
git commit -m "feat(web): add geohash encoding and per-geohash key derivation"
```

---

## Task 5: Relay Connection Pool + In-Memory Test Fake

**Files:**
- Create: `web/src/relay/relayPool.ts`
- Test: `web/src/relay/relayPool.test.ts`
- Create: `web/src/testutil/inMemoryRelayPool.ts`
- Test: `web/src/testutil/inMemoryRelayPool.test.ts`

**Interfaces:**
- Consumes: `NostrEvent` from `../nostr/event.ts` (Task 2).
- Produces:
  - `interface RelayFilter { kinds?: number[]; '#g'?: string[]; '#p'?: string[]; since?: number }`
  - `interface RelayPoolLike { subscribe(filter: RelayFilter, onEvent: (event: NostrEvent) => void): () => void; publish(event: NostrEvent): void }`
  - `type WebSocketFactory = (url: string) => MinimalWebSocket` (exported `MinimalWebSocket` interface)
  - `class RelayPool implements RelayPoolLike` — constructor `(urls: string[], wsFactory: WebSocketFactory)`; also exposes `connectedCount(): number` and `totalCount(): number`.
  - `createInMemoryRelayPool(): RelayPoolLike` in `testutil/inMemoryRelayPool.ts`, used by Tasks 6, 9, 11 to test modules built on `RelayPoolLike` without any WebSocket at all.
- Downstream modules (Task 6 `GeohashChannel`, Task 9 `DmManager`) depend on `RelayPoolLike`, not the concrete `RelayPool` class, so both a real pool and the in-memory fake satisfy them.

- [ ] **Step 1: Write the failing tests for `RelayPool`**

```ts
// web/src/relay/relayPool.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RelayPool, type MinimalWebSocket, type WebSocketFactory } from './relayPool';
import type { NostrEvent } from '../nostr/event';

class FakeWebSocket implements MinimalWebSocket {
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  receive(data: string): void {
    this.onmessage?.({ data });
  }
}

function fakeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1700000000,
    kind: 1,
    tags: [],
    content: 'hi',
    sig: 'c'.repeat(128),
    ...overrides,
  };
}

describe('RelayPool', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a REQ subscribe message once the socket opens', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://relay.example'], factory);
    pool.subscribe({ kinds: [1] }, () => {});
    sockets[0]!.open();

    expect(sockets[0]!.sent).toHaveLength(1);
    const [type, , filter] = JSON.parse(sockets[0]!.sent[0]!);
    expect(type).toBe('REQ');
    expect(filter).toEqual({ kinds: [1] });
  });

  it('delivers a matching EVENT message to the subscriber', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://relay.example'], factory);
    const onEvent = vi.fn();
    pool.subscribe({ kinds: [1] }, onEvent);
    sockets[0]!.open();
    const [, subId] = JSON.parse(sockets[0]!.sent[0]!);
    const event = fakeEvent();
    sockets[0]!.receive(JSON.stringify(['EVENT', subId, event]));

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it('deduplicates the same event id received from two relays', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://a.example', 'wss://b.example'], factory);
    const onEvent = vi.fn();
    pool.subscribe({ kinds: [1] }, onEvent);
    sockets[0]!.open();
    sockets[1]!.open();
    const event = fakeEvent();
    const [, subIdA] = JSON.parse(sockets[0]!.sent[0]!);
    const [, subIdB] = JSON.parse(sockets[1]!.sent[0]!);
    sockets[0]!.receive(JSON.stringify(['EVENT', subIdA, event]));
    sockets[1]!.receive(JSON.stringify(['EVENT', subIdB, event]));

    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('reconnects with exponential backoff after a socket closes', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    new RelayPool(['wss://relay.example'], factory);
    sockets[0]!.open();
    sockets[0]!.close();

    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
  });

  it('reports connected and total relay counts', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://a.example', 'wss://b.example'], factory);
    sockets[0]!.open();

    expect(pool.totalCount()).toBe(2);
    expect(pool.connectedCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/relay/relayPool.test.ts`
Expected: FAIL — `Cannot find module './relayPool'`.

- [ ] **Step 3: Write the `RelayPool` implementation**

```ts
// web/src/relay/relayPool.ts
import type { NostrEvent } from '../nostr/event';

export interface RelayFilter {
  kinds?: number[];
  '#g'?: string[];
  '#p'?: string[];
  since?: number;
}

export interface RelayPoolLike {
  subscribe(filter: RelayFilter, onEvent: (event: NostrEvent) => void): () => void;
  publish(event: NostrEvent): void;
}

export interface MinimalWebSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
}

export type WebSocketFactory = (url: string) => MinimalWebSocket;

interface Subscription {
  id: string;
  filter: RelayFilter;
  onEvent: (event: NostrEvent) => void;
}

const OPEN = 1;
const MAX_SEEN_IDS = 5000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export class RelayPool implements RelayPoolLike {
  private sockets = new Map<string, MinimalWebSocket>();
  private reconnectAttempts = new Map<string, number>();
  private subscriptions = new Map<string, Subscription>();
  private seenEventIds = new Set<string>();
  private nextSubId = 0;

  constructor(private urls: string[], private wsFactory: WebSocketFactory) {
    for (const url of urls) this.connect(url);
  }

  private connect(url: string): void {
    const ws = this.wsFactory(url);
    ws.onopen = () => {
      this.reconnectAttempts.set(url, 0);
      for (const sub of this.subscriptions.values()) this.sendSubscribe(ws, sub);
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = () => this.scheduleReconnect(url);
    ws.onerror = () => this.scheduleReconnect(url);
    this.sockets.set(url, ws);
  }

  private scheduleReconnect(url: string): void {
    const attempt = this.reconnectAttempts.get(url) ?? 0;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    this.reconnectAttempts.set(url, attempt + 1);
    setTimeout(() => this.connect(url), delay);
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(parsed) || parsed[0] !== 'EVENT') return;
    const [, subId, event] = parsed as [string, string, NostrEvent];
    if (!event || typeof event.id !== 'string') return;
    if (this.seenEventIds.has(event.id)) return;
    this.seenEventIds.add(event.id);
    if (this.seenEventIds.size > MAX_SEEN_IDS) {
      const oldest = this.seenEventIds.values().next().value;
      if (oldest !== undefined) this.seenEventIds.delete(oldest);
    }
    this.subscriptions.get(subId)?.onEvent(event);
  }

  private sendSubscribe(ws: MinimalWebSocket, sub: Subscription): void {
    if (ws.readyState === OPEN) ws.send(JSON.stringify(['REQ', sub.id, sub.filter]));
  }

  subscribe(filter: RelayFilter, onEvent: (event: NostrEvent) => void): () => void {
    const id = `sub-${this.nextSubId++}`;
    const sub: Subscription = { id, filter, onEvent };
    this.subscriptions.set(id, sub);
    for (const ws of this.sockets.values()) this.sendSubscribe(ws, sub);
    return () => {
      this.subscriptions.delete(id);
      for (const ws of this.sockets.values()) {
        if (ws.readyState === OPEN) ws.send(JSON.stringify(['CLOSE', id]));
      }
    };
  }

  publish(event: NostrEvent): void {
    const message = JSON.stringify(['EVENT', event]);
    for (const ws of this.sockets.values()) {
      if (ws.readyState === OPEN) ws.send(message);
    }
  }

  connectedCount(): number {
    let count = 0;
    for (const ws of this.sockets.values()) if (ws.readyState === OPEN) count++;
    return count;
  }

  totalCount(): number {
    return this.sockets.size;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/relay/relayPool.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for the in-memory fake**

```ts
// web/src/testutil/inMemoryRelayPool.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createInMemoryRelayPool } from './inMemoryRelayPool';
import type { NostrEvent } from '../nostr/event';

function fakeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1700000000,
    kind: 1,
    tags: [],
    content: 'hi',
    sig: 'c'.repeat(128),
    ...overrides,
  };
}

describe('createInMemoryRelayPool', () => {
  it('delivers a published event only to subscribers whose kind filter matches', () => {
    const pool = createInMemoryRelayPool();
    const onKind1 = vi.fn();
    const onKind2 = vi.fn();
    pool.subscribe({ kinds: [1] }, onKind1);
    pool.subscribe({ kinds: [2] }, onKind2);
    pool.publish(fakeEvent({ kind: 1 }));

    expect(onKind1).toHaveBeenCalledTimes(1);
    expect(onKind2).not.toHaveBeenCalled();
  });

  it('matches on #g and #p tag filters', () => {
    const pool = createInMemoryRelayPool();
    const onGeohash = vi.fn();
    pool.subscribe({ '#g': ['u4pru'] }, onGeohash);
    pool.publish(fakeEvent({ tags: [['g', 'u4pru']] }));
    pool.publish(fakeEvent({ tags: [['g', 'other']] }));

    expect(onGeohash).toHaveBeenCalledTimes(1);
  });

  it('stops delivering events after unsubscribe', () => {
    const pool = createInMemoryRelayPool();
    const onEvent = vi.fn();
    const unsubscribe = pool.subscribe({}, onEvent);
    unsubscribe();
    pool.publish(fakeEvent());

    expect(onEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm run test -- src/testutil/inMemoryRelayPool.test.ts`
Expected: FAIL — `Cannot find module './inMemoryRelayPool'`.

- [ ] **Step 7: Write the in-memory fake**

```ts
// web/src/testutil/inMemoryRelayPool.ts
import type { NostrEvent } from '../nostr/event';
import type { RelayFilter, RelayPoolLike } from '../relay/relayPool';

function matchesFilter(filter: RelayFilter, event: NostrEvent): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter['#g']) {
    const geohashes = event.tags.filter((t) => t[0] === 'g').map((t) => t[1]);
    if (!filter['#g'].some((g) => geohashes.includes(g))) return false;
  }
  if (filter['#p']) {
    const recipients = event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    if (!filter['#p'].some((p) => recipients.includes(p))) return false;
  }
  return true;
}

export function createInMemoryRelayPool(): RelayPoolLike {
  const subscriptions = new Map<number, { filter: RelayFilter; onEvent: (event: NostrEvent) => void }>();
  let nextId = 0;

  return {
    subscribe(filter, onEvent) {
      const id = nextId++;
      subscriptions.set(id, { filter, onEvent });
      return () => {
        subscriptions.delete(id);
      };
    },
    publish(event) {
      for (const sub of subscriptions.values()) {
        if (matchesFilter(sub.filter, event)) sub.onEvent(event);
      }
    },
  };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run test -- src/testutil/inMemoryRelayPool.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add web/src/relay/relayPool.ts web/src/relay/relayPool.test.ts web/src/testutil/inMemoryRelayPool.ts web/src/testutil/inMemoryRelayPool.test.ts
git commit -m "feat(web): add relay connection pool and in-memory test fake"
```

---

## Task 6: Geohash Channel Client

**Files:**
- Create: `web/src/channel/geohashChannel.ts`
- Test: `web/src/channel/geohashChannel.test.ts`

**Interfaces:**
- Consumes: `RelayPoolLike` (Task 5); `NostrEvent`, `UnsignedEvent`, `getPublicKey`, `signEvent` from `../nostr/event.ts` (Task 2); `broadcastsPresence`, `deriveGeohashKey` from `../geohash/geohash.ts` (Task 4); `createInMemoryRelayPool` from `../testutil/inMemoryRelayPool.ts` (Task 5) for tests.
- Produces:
  - `const KIND_GEOHASH_CHAT = 20000`, `const KIND_GEOHASH_PRESENCE = 20001`
  - `interface GeohashMessage { pubkey: string; nickname: string; content: string; createdAt: number }`
  - `interface ParticipantCount { count: number; exact: boolean }`
  - `class GeohashChannel` — constructor `(pool: RelayPoolLike, masterPrivateKeyHex: string, geohash: string, onMessage: (message: GeohashMessage) => void, now?: () => number)`; methods `join(): void`, `leave(): void`, `sendMessage(content: string, nickname: string): void`, `getParticipantCount(): ParticipantCount`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/channel/geohashChannel.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeohashChannel, KIND_GEOHASH_CHAT, KIND_GEOHASH_PRESENCE } from './geohashChannel';
import { createInMemoryRelayPool } from '../testutil/inMemoryRelayPool';

const MASTER_KEY = 'a'.repeat(64);

describe('GeohashChannel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes a signed kind-20000 chat event tagged with the geohash and nickname', () => {
    const pool = createInMemoryRelayPool();
    const received: unknown[] = [];
    pool.subscribe({ kinds: [KIND_GEOHASH_CHAT] }, (e) => received.push(e));
    const channel = new GeohashChannel(pool, MASTER_KEY, 'u4pru', () => {});
    channel.join();
    channel.sendMessage('hello room', 'phill');

    expect(received).toHaveLength(1);
    const event = received[0] as { tags: string[][]; content: string };
    expect(event.content).toBe('hello room');
    expect(event.tags).toContainEqual(['g', 'u4pru']);
    expect(event.tags).toContainEqual(['n', 'phill']);
  });

  it('delivers incoming chat events to the onMessage callback', () => {
    const pool = createInMemoryRelayPool();
    const onMessage = vi.fn();
    const channel = new GeohashChannel(pool, MASTER_KEY, 'u4pru', onMessage);
    channel.join();
    const sender = new GeohashChannel(pool, 'b'.repeat(64), 'u4pru', () => {});
    sender.sendMessage('hi there', 'alex');

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0]![0]).toMatchObject({ nickname: 'alex', content: 'hi there' });
  });

  it('broadcasts presence heartbeats for a city-precision geohash but not a block-precision one', () => {
    const pool = createInMemoryRelayPool();
    const presenceEvents: unknown[] = [];
    pool.subscribe({ kinds: [KIND_GEOHASH_PRESENCE] }, (e) => presenceEvents.push(e));

    const cityChannel = new GeohashChannel(pool, MASTER_KEY, 'u4pru', () => {}); // length 5 = city
    cityChannel.join();
    expect(presenceEvents).toHaveLength(1); // immediate heartbeat on join

    const blockChannel = new GeohashChannel(pool, MASTER_KEY, 'u4pru12', () => {}); // length 7 = block
    blockChannel.join();
    expect(presenceEvents).toHaveLength(1); // unchanged
  });

  it('counts a participant as online only within the 5-minute window', () => {
    let now = 1_700_000_000_000;
    const pool = createInMemoryRelayPool();
    const listener = new GeohashChannel(pool, MASTER_KEY, 'u4pru', () => {}, () => now);
    listener.join();
    const sender = new GeohashChannel(pool, 'b'.repeat(64), 'u4pru', () => {}, () => now);
    sender.sendMessage('hi', 'alex');

    expect(listener.getParticipantCount()).toEqual({ count: 1, exact: true });
    now += 6 * 60 * 1000;
    expect(listener.getParticipantCount()).toEqual({ count: 0, exact: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/channel/geohashChannel.test.ts`
Expected: FAIL — `Cannot find module './geohashChannel'`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/channel/geohashChannel.ts
import type { RelayPoolLike } from '../relay/relayPool';
import type { NostrEvent, UnsignedEvent } from '../nostr/event';
import { getPublicKey, signEvent } from '../nostr/event';
import { broadcastsPresence, deriveGeohashKey } from '../geohash/geohash';

export const KIND_GEOHASH_CHAT = 20000;
export const KIND_GEOHASH_PRESENCE = 20001;

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const PRESENCE_MIN_MS = 40_000;
const PRESENCE_MAX_MS = 80_000;

export interface GeohashMessage {
  pubkey: string;
  nickname: string;
  content: string;
  createdAt: number;
}

export interface ParticipantCount {
  count: number;
  exact: boolean;
}

export class GeohashChannel {
  private ephemeralPrivateKey: string;
  private ephemeralPublicKey: string;
  private lastSeen = new Map<string, number>();
  private unsubscribe: (() => void) | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private pool: RelayPoolLike,
    masterPrivateKeyHex: string,
    private geohash: string,
    private onMessage: (message: GeohashMessage) => void,
    private now: () => number = () => Date.now(),
  ) {
    this.ephemeralPrivateKey = deriveGeohashKey(masterPrivateKeyHex, geohash);
    this.ephemeralPublicKey = getPublicKey(this.ephemeralPrivateKey);
  }

  join(): void {
    this.unsubscribe = this.pool.subscribe(
      { kinds: [KIND_GEOHASH_CHAT, KIND_GEOHASH_PRESENCE], '#g': [this.geohash] },
      (event) => this.handleEvent(event),
    );
    if (broadcastsPresence(this.geohash.length)) this.schedulePresence();
  }

  leave(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
  }

  private handleEvent(event: NostrEvent): void {
    this.lastSeen.set(event.pubkey, event.created_at * 1000);
    if (event.kind === KIND_GEOHASH_CHAT) {
      const nickname = event.tags.find((t) => t[0] === 'n')?.[1] ?? 'anon';
      this.onMessage({ pubkey: event.pubkey, nickname, content: event.content, createdAt: event.created_at });
    }
  }

  sendMessage(content: string, nickname: string): void {
    const unsigned: UnsignedEvent = {
      pubkey: this.ephemeralPublicKey,
      created_at: Math.floor(this.now() / 1000),
      kind: KIND_GEOHASH_CHAT,
      tags: [
        ['g', this.geohash],
        ['n', nickname],
      ],
      content,
    };
    this.pool.publish(signEvent(unsigned, this.ephemeralPrivateKey));
  }

  private sendPresence(): void {
    const unsigned: UnsignedEvent = {
      pubkey: this.ephemeralPublicKey,
      created_at: Math.floor(this.now() / 1000),
      kind: KIND_GEOHASH_PRESENCE,
      tags: [['g', this.geohash]],
      content: '',
    };
    this.pool.publish(signEvent(unsigned, this.ephemeralPrivateKey));
  }

  private schedulePresence(): void {
    this.sendPresence();
    const delay = PRESENCE_MIN_MS + Math.random() * (PRESENCE_MAX_MS - PRESENCE_MIN_MS);
    this.presenceTimer = setTimeout(() => this.schedulePresence(), delay);
  }

  getParticipantCount(): ParticipantCount {
    const cutoff = this.now() - ONLINE_WINDOW_MS;
    let count = 0;
    for (const lastSeen of this.lastSeen.values()) if (lastSeen >= cutoff) count++;
    return { count, exact: broadcastsPresence(this.geohash.length) };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/channel/geohashChannel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/channel/geohashChannel.ts web/src/channel/geohashChannel.test.ts
git commit -m "feat(web): add geohash channel pub/sub with presence tracking"
```

---

## Task 7: NIP-44 Encryption Primitives

**Files:**
- Create: `web/src/crypto/nip44.ts`
- Test: `web/src/crypto/nip44.test.ts`

**Interfaces:**
- Consumes: `secp256k1` from `@noble/curves/secp256k1`; `sha256` from `@noble/hashes/sha256`; `hmac` from `@noble/hashes/hmac`; `chacha20` from `@noble/ciphers/chacha`; `bytesToHex`, `hexToBytes`, `utf8ToBytes`, `concatBytes`, `randomBytes` from `@noble/hashes/utils`.
- Produces:
  - `nip44Encrypt(plaintext: string, senderPrivateKeyHex: string, recipientPublicKeyHex: string): string` — returns base64 payload.
  - `nip44Decrypt(payloadBase64: string, receiverPrivateKeyHex: string, senderPublicKeyHex: string): string` — throws on MAC failure.
  - Used by Task 8 (`giftWrap.ts`) for sealing rumors and gift wraps.

Note: this implements the NIP-44 v2 shape (versioned payload, HKDF-derived per-message keys, HMAC authentication, length-bucketed padding). The tests below verify internal round-trip correctness and tamper detection rather than asserting against external NIP-44 test vectors — flag this for a follow-up spec-conformance check against the published NIP-44 test vectors before this needs to interoperate with a third-party Nostr client's DMs (it does not need to for PillTalk-to-PillTalk DMs, which only need internal consistency).

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/crypto/nip44.test.ts
import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { nip44Encrypt, nip44Decrypt } from './nip44';

function randomKeyHex(): string {
  return bytesToHex(secp256k1.utils.randomPrivateKey());
}

function xOnlyPubHex(privateKeyHex: string): string {
  return bytesToHex(secp256k1.getPublicKey(privateKeyHex, true)).slice(2); // drop 02/03 prefix byte
}

describe('nip44Encrypt / nip44Decrypt', () => {
  it('round-trips a short message between two parties', () => {
    const alicePriv = randomKeyHex();
    const bobPriv = randomKeyHex();
    const bobPub = xOnlyPubHex(bobPriv);
    const alicePub = xOnlyPubHex(alicePriv);

    const payload = nip44Encrypt('hi bob', alicePriv, bobPub);
    const decrypted = nip44Decrypt(payload, bobPriv, alicePub);

    expect(decrypted).toBe('hi bob');
  });

  it('round-trips a message long enough to cross a padding bucket boundary', () => {
    const alicePriv = randomKeyHex();
    const bobPriv = randomKeyHex();
    const bobPub = xOnlyPubHex(bobPriv);
    const alicePub = xOnlyPubHex(alicePriv);
    const longMessage = 'x'.repeat(200);

    const payload = nip44Encrypt(longMessage, alicePriv, bobPub);
    expect(nip44Decrypt(payload, bobPriv, alicePub)).toBe(longMessage);
  });

  it('throws when the ciphertext has been tampered with', () => {
    const alicePriv = randomKeyHex();
    const bobPriv = randomKeyHex();
    const bobPub = xOnlyPubHex(bobPriv);
    const alicePub = xOnlyPubHex(alicePriv);

    const payload = nip44Encrypt('hi bob', alicePriv, bobPub);
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff; // flip a bit in the MAC
    const tampered = btoa(String.fromCharCode(...bytes));

    expect(() => nip44Decrypt(tampered, bobPriv, alicePub)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/crypto/nip44.test.ts`
Expected: FAIL — `Cannot find module './nip44'`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/crypto/nip44.ts
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { chacha20 } from '@noble/ciphers/chacha';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes, randomBytes } from '@noble/hashes/utils';

// Manual HKDF (RFC 5869) built on hmac/sha256 directly, rather than relying
// on the shape of @noble/hashes' hkdf export, which varies across versions.
function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Uint8Array {
  return hmac(sha256, salt, ikm);
}

function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const blocks: Uint8Array[] = [];
  let previous = new Uint8Array(0);
  let counter = 1;
  let total = 0;
  while (total < length) {
    previous = hmac(sha256, prk, concatBytes(previous, info, Uint8Array.of(counter)));
    blocks.push(previous);
    total += previous.length;
    counter++;
  }
  return concatBytes(...blocks).slice(0, length);
}

function conversationKey(privateKeyHex: string, publicKeyXOnlyHex: string): Uint8Array {
  // NIP-44 ECDH assumes an even-y point for the x-only pubkey (BIP340 convention).
  const compressedPubkey = concatBytes(Uint8Array.of(0x02), hexToBytes(publicKeyXOnlyHex));
  const shared = secp256k1.getSharedSecret(hexToBytes(privateKeyHex), compressedPubkey);
  const sharedX = shared.slice(1, 33);
  return hkdfExtract(utf8ToBytes('nip44-v2'), sharedX);
}

function calcPaddedLen(unpaddedLen: number): number {
  if (unpaddedLen <= 32) return 32;
  const nextPower = 2 ** (Math.floor(Math.log2(unpaddedLen - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((unpaddedLen - 1) / chunk) + 1);
}

function pad(plaintext: Uint8Array): Uint8Array {
  const paddedLen = calcPaddedLen(plaintext.length);
  const result = new Uint8Array(2 + paddedLen);
  new DataView(result.buffer).setUint16(0, plaintext.length, false);
  result.set(plaintext, 2);
  return result;
}

function unpad(padded: Uint8Array): Uint8Array {
  const length = new DataView(padded.buffer, padded.byteOffset).getUint16(0, false);
  return padded.slice(2, 2 + length);
}

function deriveMessageKeys(conversationKeyBytes: Uint8Array, nonce: Uint8Array) {
  const keys = hkdfExpand(conversationKeyBytes, nonce, 76);
  return {
    chachaKey: keys.slice(0, 32),
    chachaNonce: keys.slice(32, 44),
    hmacKey: keys.slice(44, 76),
  };
}

export function nip44Encrypt(plaintext: string, senderPrivateKeyHex: string, recipientPublicKeyHex: string): string {
  const key = conversationKey(senderPrivateKeyHex, recipientPublicKeyHex);
  const nonce = randomBytes(32);
  const { chachaKey, chachaNonce, hmacKey } = deriveMessageKeys(key, nonce);
  const paddedPlaintext = pad(utf8ToBytes(plaintext));
  const ciphertext = chacha20(chachaKey, chachaNonce, paddedPlaintext);
  const mac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext));
  const payload = concatBytes(Uint8Array.of(2), nonce, ciphertext, mac);
  return btoa(String.fromCharCode(...payload));
}

export function nip44Decrypt(payloadBase64: string, receiverPrivateKeyHex: string, senderPublicKeyHex: string): string {
  const payload = Uint8Array.from(atob(payloadBase64), (c) => c.charCodeAt(0));
  const nonce = payload.slice(1, 33);
  const mac = payload.slice(payload.length - 32);
  const ciphertext = payload.slice(33, payload.length - 32);
  const key = conversationKey(receiverPrivateKeyHex, senderPublicKeyHex);
  const { chachaKey, chachaNonce, hmacKey } = deriveMessageKeys(key, nonce);
  const expectedMac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext));
  const macsMatch = expectedMac.length === mac.length && expectedMac.every((b, i) => b === mac[i]);
  if (!macsMatch) throw new Error('nip44: MAC verification failed');
  const paddedPlaintext = chacha20(chachaKey, chachaNonce, ciphertext);
  return new TextDecoder().decode(unpad(paddedPlaintext));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/crypto/nip44.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/crypto/nip44.ts web/src/crypto/nip44.test.ts
git commit -m "feat(web): add NIP-44 style conversation-key encryption"
```

---

## Task 8: NIP-17 Gift Wrap

**Files:**
- Create: `web/src/dm/giftWrap.ts`
- Test: `web/src/dm/giftWrap.test.ts`

**Interfaces:**
- Consumes: `NostrEvent`, `UnsignedEvent`, `getPublicKey`, `signEvent` from `../nostr/event.ts` (Task 2); `nip44Encrypt`, `nip44Decrypt` from `../crypto/nip44.ts` (Task 7); `secp256k1` from `@noble/curves/secp256k1`; `bytesToHex` from `@noble/hashes/utils`.
- Produces:
  - `const KIND_DM_RUMOR = 14`, `const KIND_SEAL = 13`, `const KIND_GIFT_WRAP = 1059`
  - `interface Rumor { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }`
  - `createGiftWrap(rumor: Rumor, senderPrivateKeyHex: string, recipientPublicKeyHex: string, now?: number): NostrEvent`
  - `openGiftWrap(giftWrap: NostrEvent, receiverPrivateKeyHex: string): Rumor`
  - Used by Task 9 (`dmManager.ts`) to send/receive DMs, and Task 11 to carry WebRTC signaling payloads as tagged rumors.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/dm/giftWrap.test.ts
import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey } from '../nostr/event';
import { createGiftWrap, openGiftWrap, KIND_DM_RUMOR, type Rumor } from './giftWrap';

function randomKeyHex(): string {
  return bytesToHex(secp256k1.utils.randomPrivateKey());
}

describe('NIP-17 gift wrap', () => {
  it('lets the recipient recover the original rumor content and true sender', () => {
    const senderPriv = randomKeyHex();
    const senderPub = getPublicKey(senderPriv);
    const recipientPriv = randomKeyHex();
    const recipientPub = getPublicKey(recipientPriv);

    const rumor: Rumor = {
      pubkey: senderPub,
      created_at: 1700000000,
      kind: KIND_DM_RUMOR,
      tags: [['p', recipientPub]],
      content: 'hey, you around?',
    };
    const wrap = createGiftWrap(rumor, senderPriv, recipientPub, 1700000000);
    const opened = openGiftWrap(wrap, recipientPriv);

    expect(opened.content).toBe('hey, you around?');
    expect(opened.pubkey).toBe(senderPub);
  });

  it('signs the gift wrap event with a one-time key, not the real sender key', () => {
    const senderPriv = randomKeyHex();
    const senderPub = getPublicKey(senderPriv);
    const recipientPriv = randomKeyHex();
    const recipientPub = getPublicKey(recipientPriv);

    const rumor: Rumor = { pubkey: senderPub, created_at: 1700000000, kind: KIND_DM_RUMOR, tags: [], content: 'hi' };
    const wrap = createGiftWrap(rumor, senderPriv, recipientPub, 1700000000);

    expect(wrap.pubkey).not.toBe(senderPub);
  });

  it('fails to open a gift wrap with the wrong recipient key', () => {
    const senderPriv = randomKeyHex();
    const senderPub = getPublicKey(senderPriv);
    const recipientPriv = randomKeyHex();
    const recipientPub = getPublicKey(recipientPriv);
    const eavesdropperPriv = randomKeyHex();

    const rumor: Rumor = { pubkey: senderPub, created_at: 1700000000, kind: KIND_DM_RUMOR, tags: [], content: 'hi' };
    const wrap = createGiftWrap(rumor, senderPriv, recipientPub, 1700000000);

    expect(() => openGiftWrap(wrap, eavesdropperPriv)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/dm/giftWrap.test.ts`
Expected: FAIL — `Cannot find module './giftWrap'`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/dm/giftWrap.ts
import { getPublicKey, signEvent, type NostrEvent, type UnsignedEvent } from '../nostr/event';
import { nip44Encrypt, nip44Decrypt } from '../crypto/nip44';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

export const KIND_DM_RUMOR = 14;
export const KIND_SEAL = 13;
export const KIND_GIFT_WRAP = 1059;

export interface Rumor {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;

function randomPastTimestamp(now: number): number {
  return now - Math.floor(Math.random() * TWO_DAYS_SECONDS);
}

export function createGiftWrap(
  rumor: Rumor,
  senderPrivateKeyHex: string,
  recipientPublicKeyHex: string,
  now: number = Math.floor(Date.now() / 1000),
): NostrEvent {
  const senderPubkey = getPublicKey(senderPrivateKeyHex);
  const sealContent = nip44Encrypt(JSON.stringify(rumor), senderPrivateKeyHex, recipientPublicKeyHex);
  const unsignedSeal: UnsignedEvent = {
    pubkey: senderPubkey,
    created_at: randomPastTimestamp(now),
    kind: KIND_SEAL,
    tags: [],
    content: sealContent,
  };
  const seal = signEvent(unsignedSeal, senderPrivateKeyHex);

  const oneTimePrivateKey = bytesToHex(secp256k1.utils.randomPrivateKey());
  const wrapContent = nip44Encrypt(JSON.stringify(seal), oneTimePrivateKey, recipientPublicKeyHex);
  const unsignedWrap: UnsignedEvent = {
    pubkey: getPublicKey(oneTimePrivateKey),
    created_at: randomPastTimestamp(now),
    kind: KIND_GIFT_WRAP,
    tags: [['p', recipientPublicKeyHex]],
    content: wrapContent,
  };
  return signEvent(unsignedWrap, oneTimePrivateKey);
}

export function openGiftWrap(giftWrap: NostrEvent, receiverPrivateKeyHex: string): Rumor {
  const sealJson = nip44Decrypt(giftWrap.content, receiverPrivateKeyHex, giftWrap.pubkey);
  const seal = JSON.parse(sealJson) as NostrEvent;
  const rumorJson = nip44Decrypt(seal.content, receiverPrivateKeyHex, seal.pubkey);
  return JSON.parse(rumorJson) as Rumor;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/dm/giftWrap.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/dm/giftWrap.ts web/src/dm/giftWrap.test.ts
git commit -m "feat(web): add NIP-17 rumor/seal/gift-wrap for private DMs"
```

---

## Task 9: Direct Message Manager (Relay-Only)

**Files:**
- Create: `web/src/dm/dmManager.ts`
- Test: `web/src/dm/dmManager.test.ts`

**Interfaces:**
- Consumes: `RelayPoolLike` (Task 5); `createInMemoryRelayPool` (Task 5, for tests); `createGiftWrap`, `openGiftWrap`, `KIND_GIFT_WRAP`, `KIND_DM_RUMOR`, `Rumor` from `../dm/giftWrap.ts` (Task 8); `NostrEvent` from `../nostr/event.ts` (Task 2).
- Produces:
  - `interface ChatMessage { fromPubkey: string; content: string; createdAt: number }`
  - `type DmTransport = 'relay' | 'direct'`
  - `class DmManager` — constructor `(pool: RelayPoolLike, identityPrivateKeyHex: string, identityPublicKeyHex: string, onMessage: (peerPubkey: string, message: ChatMessage) => void)`; methods `start(): void`, `stop(): void`, `sendMessage(recipientPubkey: string, content: string): void`, `getTransport(peerPubkey: string): DmTransport` (always `'relay'` until Task 11).
  - Task 11 modifies this file to add the WebRTC direct-channel upgrade; this task's public API shape stays stable across that change.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/dm/dmManager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DmManager } from './dmManager';
import { createInMemoryRelayPool } from '../testutil/inMemoryRelayPool';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey } from '../nostr/event';

function randomKeyHex(): string {
  return bytesToHex(secp256k1.utils.randomPrivateKey());
}

describe('DmManager (relay-only)', () => {
  it('delivers a message from one peer to another over a shared relay pool', () => {
    const pool = createInMemoryRelayPool();
    const alicePriv = randomKeyHex();
    const alicePub = getPublicKey(alicePriv);
    const bobPriv = randomKeyHex();
    const bobPub = getPublicKey(bobPriv);

    const bobOnMessage = vi.fn();
    const alice = new DmManager(pool, alicePriv, alicePub, () => {});
    const bob = new DmManager(pool, bobPriv, bobPub, bobOnMessage);
    alice.start();
    bob.start();

    alice.sendMessage(bobPub, 'hi bob');

    expect(bobOnMessage).toHaveBeenCalledTimes(1);
    const [fromPubkey, message] = bobOnMessage.mock.calls[0]!;
    expect(fromPubkey).toBe(alicePub);
    expect(message).toMatchObject({ fromPubkey: alicePub, content: 'hi bob' });
  });

  it('does not deliver a message to a peer it was not addressed to', () => {
    const pool = createInMemoryRelayPool();
    const alicePriv = randomKeyHex();
    const alicePub = getPublicKey(alicePriv);
    const bobPriv = randomKeyHex();
    const bobPub = getPublicKey(bobPriv);
    const carolPriv = randomKeyHex();
    const carolPub = getPublicKey(carolPriv);

    const carolOnMessage = vi.fn();
    const alice = new DmManager(pool, alicePriv, alicePub, () => {});
    const bob = new DmManager(pool, bobPriv, bobPub, () => {});
    const carol = new DmManager(pool, carolPriv, carolPub, carolOnMessage);
    alice.start();
    bob.start();
    carol.start();

    alice.sendMessage(bobPub, 'private to bob');

    expect(carolOnMessage).not.toHaveBeenCalled();
  });

  it('reports the transport as relay before any direct channel exists', () => {
    const pool = createInMemoryRelayPool();
    const alice = new DmManager(pool, randomKeyHex(), randomKeyHex(), () => {});
    expect(alice.getTransport('anyone')).toBe('relay');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/dm/dmManager.test.ts`
Expected: FAIL — `Cannot find module './dmManager'`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/dm/dmManager.ts
import type { RelayPoolLike } from '../relay/relayPool';
import type { NostrEvent } from '../nostr/event';
import { createGiftWrap, openGiftWrap, KIND_GIFT_WRAP, KIND_DM_RUMOR, type Rumor } from './giftWrap';

export interface ChatMessage {
  fromPubkey: string;
  content: string;
  createdAt: number;
}

export type DmTransport = 'relay' | 'direct';

export class DmManager {
  private unsubscribe: (() => void) | null = null;

  constructor(
    protected pool: RelayPoolLike,
    protected identityPrivateKeyHex: string,
    protected identityPublicKeyHex: string,
    protected onMessage: (peerPubkey: string, message: ChatMessage) => void,
  ) {}

  start(): void {
    this.unsubscribe = this.pool.subscribe(
      { kinds: [KIND_GIFT_WRAP], '#p': [this.identityPublicKeyHex] },
      (event) => this.handleGiftWrap(event),
    );
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private handleGiftWrap(event: NostrEvent): void {
    let rumor: Rumor;
    try {
      rumor = openGiftWrap(event, this.identityPrivateKeyHex);
    } catch {
      return;
    }
    if (rumor.kind !== KIND_DM_RUMOR) return;
    this.onMessage(rumor.pubkey, { fromPubkey: rumor.pubkey, content: rumor.content, createdAt: rumor.created_at });
  }

  sendMessage(recipientPubkey: string, content: string): void {
    this.sendRumor(recipientPubkey, content, []);
  }

  protected sendRumor(recipientPubkey: string, content: string, extraTags: string[][]): void {
    const rumor: Rumor = {
      pubkey: this.identityPublicKeyHex,
      created_at: Math.floor(Date.now() / 1000),
      kind: KIND_DM_RUMOR,
      tags: [['p', recipientPubkey], ...extraTags],
      content,
    };
    const wrap = createGiftWrap(rumor, this.identityPrivateKeyHex, recipientPubkey);
    this.pool.publish(wrap);
  }

  getTransport(_peerPubkey: string): DmTransport {
    return 'relay';
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/dm/dmManager.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/dm/dmManager.ts web/src/dm/dmManager.test.ts
git commit -m "feat(web): add relay-delivered NIP-17 direct message manager"
```

---

## Task 10: WebRTC Signaling

**Files:**
- Create: `web/src/webrtc/signaling.ts`
- Test: `web/src/webrtc/signaling.test.ts`

**Interfaces:**
- Produces:
  - `interface DataChannelLike { send(data: string): void; close(): void; readyState: string; onopen: (() => void) | null; onmessage: ((ev: { data: string }) => void) | null; onclose: (() => void) | null }`
  - `interface PeerConnectionLike { createOffer(): Promise<{ type: string; sdp: string }>; createAnswer(): Promise<{ type: string; sdp: string }>; setLocalDescription(desc: { type: string; sdp: string }): Promise<void>; setRemoteDescription(desc: { type: string; sdp: string }): Promise<void>; addIceCandidate(candidate: unknown): Promise<void>; createDataChannel(label: string): DataChannelLike; onicecandidate: ((ev: { candidate: unknown }) => void) | null; ondatachannel: ((ev: { channel: DataChannelLike }) => void) | null }`
  - `type PeerConnectionFactory = () => PeerConnectionLike`
  - `interface SignalPayload { type: 'offer' | 'answer' | 'ice'; data: unknown }`
  - `class WebRtcSignaling` — constructor `(createPeerConnection: PeerConnectionFactory, sendSignal: (peerPubkey: string, payload: SignalPayload) => void, onChannelOpen: (peerPubkey: string, channel: DataChannelLike) => void)`; methods `initiate(peerPubkey: string): Promise<void>`, `handleSignal(peerPubkey: string, signal: SignalPayload): Promise<void>`, `getChannel(peerPubkey: string): DataChannelLike | undefined`.
  - Task 11 wires this into `DmManager`: the real `sendSignal` implementation there publishes a tagged gift-wrapped rumor; the real `createPeerConnection` wraps the browser's native `RTCPeerConnection`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/webrtc/signaling.test.ts
import { describe, it, expect, vi } from 'vitest';
import { WebRtcSignaling, type PeerConnectionLike, type DataChannelLike, type SignalPayload } from './signaling';

class FakeDataChannel implements DataChannelLike {
  readyState = 'connecting';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }
  simulateOpen(): void {
    this.readyState = 'open';
    this.onopen?.();
  }
}

class FakePeerConnection implements PeerConnectionLike {
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null;
  ondatachannel: ((ev: { channel: DataChannelLike }) => void) | null = null;
  localChannel: FakeDataChannel | null = null;

  async createOffer() {
    return { type: 'offer', sdp: 'fake-offer-sdp' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'fake-answer-sdp' };
  }
  async setLocalDescription(): Promise<void> {}
  async setRemoteDescription(desc: { type: string; sdp: string }): Promise<void> {
    if (desc.type === 'offer') {
      const channel = new FakeDataChannel();
      this.localChannel = channel;
      this.ondatachannel?.({ channel });
    }
  }
  async addIceCandidate(): Promise<void> {}
  createDataChannel(): DataChannelLike {
    const channel = new FakeDataChannel();
    this.localChannel = channel;
    return channel;
  }
}

describe('WebRtcSignaling', () => {
  it('completes an offer/answer handshake between two peers and opens data channels on both sides', async () => {
    const alicePeerConnections: FakePeerConnection[] = [];
    const bobPeerConnections: FakePeerConnection[] = [];
    let bob: WebRtcSignaling;
    let alice: WebRtcSignaling;

    const aliceOnOpen = vi.fn();
    const bobOnOpen = vi.fn();

    alice = new WebRtcSignaling(
      () => {
        const pc = new FakePeerConnection();
        alicePeerConnections.push(pc);
        return pc;
      },
      (_peerPubkey, payload) => {
        void bob.handleSignal('alice', payload);
      },
      aliceOnOpen,
    );
    bob = new WebRtcSignaling(
      () => {
        const pc = new FakePeerConnection();
        bobPeerConnections.push(pc);
        return pc;
      },
      (_peerPubkey, payload) => {
        void alice.handleSignal('bob', payload);
      },
      bobOnOpen,
    );

    await alice.initiate('bob');

    expect(alicePeerConnections).toHaveLength(1);
    expect(bobPeerConnections).toHaveLength(1);

    const aliceChannel = alicePeerConnections[0]!.localChannel as FakeDataChannel;
    const bobChannel = bobPeerConnections[0]!.localChannel as FakeDataChannel;
    aliceChannel.simulateOpen();
    bobChannel.simulateOpen();

    expect(aliceOnOpen).toHaveBeenCalledWith('bob', aliceChannel);
    expect(bobOnOpen).toHaveBeenCalledWith('alice', bobChannel);
    expect(alice.getChannel('bob')).toBe(aliceChannel);
    expect(bob.getChannel('alice')).toBe(bobChannel);
  });

  it('forwards ICE candidates to the existing peer connection for that peer', async () => {
    let bob: WebRtcSignaling;
    const sentToBob: SignalPayload[] = [];
    const alice = new WebRtcSignaling(
      () => new FakePeerConnection(),
      (_peerPubkey, payload) => sentToBob.push(payload),
      () => {},
    );
    await alice.initiate('bob');
    sentToBob.length = 0; // clear the offer captured above

    const addIceCandidate = vi.fn();
    // Reach into the private map is not possible from a test; instead verify
    // handleSignal on an unknown peer with an 'ice' type is a safe no-op.
    await expect(alice.handleSignal('someone-unconnected', { type: 'ice', data: {} })).resolves.toBeUndefined();
    expect(addIceCandidate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/webrtc/signaling.test.ts`
Expected: FAIL — `Cannot find module './signaling'`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/webrtc/signaling.ts
export interface DataChannelLike {
  send(data: string): void;
  close(): void;
  readyState: string;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
}

export interface PeerConnectionLike {
  createOffer(): Promise<{ type: string; sdp: string }>;
  createAnswer(): Promise<{ type: string; sdp: string }>;
  setLocalDescription(desc: { type: string; sdp: string }): Promise<void>;
  setRemoteDescription(desc: { type: string; sdp: string }): Promise<void>;
  addIceCandidate(candidate: unknown): Promise<void>;
  createDataChannel(label: string): DataChannelLike;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null;
  ondatachannel: ((ev: { channel: DataChannelLike }) => void) | null;
}

export type PeerConnectionFactory = () => PeerConnectionLike;

export interface SignalPayload {
  type: 'offer' | 'answer' | 'ice';
  data: unknown;
}

export class WebRtcSignaling {
  private connections = new Map<string, PeerConnectionLike>();
  private channels = new Map<string, DataChannelLike>();

  constructor(
    private createPeerConnection: PeerConnectionFactory,
    private sendSignal: (peerPubkey: string, payload: SignalPayload) => void,
    private onChannelOpen: (peerPubkey: string, channel: DataChannelLike) => void,
  ) {}

  async initiate(peerPubkey: string): Promise<void> {
    const pc = this.createPeerConnection();
    this.connections.set(peerPubkey, pc);
    const channel = pc.createDataChannel('pilltalk');
    this.wireChannel(peerPubkey, channel);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.sendSignal(peerPubkey, { type: 'ice', data: ev.candidate });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal(peerPubkey, { type: 'offer', data: offer });
  }

  async handleSignal(peerPubkey: string, signal: SignalPayload): Promise<void> {
    if (signal.type === 'offer') {
      const pc = this.createPeerConnection();
      this.connections.set(peerPubkey, pc);
      pc.onicecandidate = (ev) => {
        if (ev.candidate) this.sendSignal(peerPubkey, { type: 'ice', data: ev.candidate });
      };
      pc.ondatachannel = (ev) => this.wireChannel(peerPubkey, ev.channel);
      await pc.setRemoteDescription(signal.data as { type: string; sdp: string });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(peerPubkey, { type: 'answer', data: answer });
      return;
    }

    const pc = this.connections.get(peerPubkey);
    if (!pc) return; // no in-flight handshake for this peer; safe no-op

    if (signal.type === 'answer') {
      await pc.setRemoteDescription(signal.data as { type: string; sdp: string });
      return;
    }
    if (signal.type === 'ice') {
      await pc.addIceCandidate(signal.data);
    }
  }

  private wireChannel(peerPubkey: string, channel: DataChannelLike): void {
    channel.onopen = () => {
      this.channels.set(peerPubkey, channel);
      this.onChannelOpen(peerPubkey, channel);
    };
    channel.onclose = () => this.channels.delete(peerPubkey);
  }

  getChannel(peerPubkey: string): DataChannelLike | undefined {
    return this.channels.get(peerPubkey);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/webrtc/signaling.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/webrtc/signaling.ts web/src/webrtc/signaling.test.ts
git commit -m "feat(web): add transport-agnostic WebRTC signaling handshake"
```

---

## Task 11: Upgrade DmManager to Prefer Direct WebRTC

**Files:**
- Modify: `web/src/dm/dmManager.ts` (full rewrite, shown below — supersedes Task 9's version)
- Modify: `web/src/dm/dmManager.test.ts` (full rewrite, shown below — supersedes Task 9's version)

**Interfaces:**
- Consumes: everything from Task 9, plus `WebRtcSignaling`, `PeerConnectionFactory`, `DataChannelLike`, `SignalPayload` from `../webrtc/signaling.ts` (Task 10).
- Produces (changed from Task 9):
  - `DmManager` constructor gains a 5th parameter: `(pool, identityPrivateKeyHex, identityPublicKeyHex, onMessage, createPeerConnection: PeerConnectionFactory)`.
  - `sendMessage` now sends over an open direct data channel when one exists, otherwise sends via relay and opportunistically starts a WebRTC handshake for next time.
  - `getTransport(peerPubkey)` now returns `'direct'` once that peer's data channel is open.
  - WebRTC signaling payloads travel as gift-wrapped rumors tagged `['t', 'webrtc-signal']` and are routed to `WebRtcSignaling`, never surfaced via `onMessage`.
  - Task 12 (UI) constructs `DmManager` with a `createPeerConnection` that wraps the browser's native `RTCPeerConnection` with public STUN servers.

- [ ] **Step 1: Write the failing tests (full replacement of the test file)**

```ts
// web/src/dm/dmManager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DmManager } from './dmManager';
import { createInMemoryRelayPool } from '../testutil/inMemoryRelayPool';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey } from '../nostr/event';
import type { PeerConnectionLike, DataChannelLike } from '../webrtc/signaling';

function randomKeyHex(): string {
  return bytesToHex(secp256k1.utils.randomPrivateKey());
}

class FakeDataChannel implements DataChannelLike {
  readyState = 'connecting';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }
  simulateOpen(): void {
    this.readyState = 'open';
    this.onopen?.();
  }
  deliver(data: string): void {
    this.onmessage?.({ data });
  }
}

class FakePeerConnection implements PeerConnectionLike {
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null;
  ondatachannel: ((ev: { channel: DataChannelLike }) => void) | null = null;
  channel: FakeDataChannel | null = null;

  async createOffer() {
    return { type: 'offer', sdp: 'offer-sdp' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'answer-sdp' };
  }
  async setLocalDescription(): Promise<void> {}
  async setRemoteDescription(desc: { type: string; sdp: string }): Promise<void> {
    if (desc.type === 'offer') {
      this.channel = new FakeDataChannel();
      this.ondatachannel?.({ channel: this.channel });
    }
  }
  async addIceCandidate(): Promise<void> {}
  createDataChannel(): DataChannelLike {
    this.channel = new FakeDataChannel();
    return this.channel;
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DmManager', () => {
  it('delivers a message via relay when no direct channel exists', () => {
    const pool = createInMemoryRelayPool();
    const alicePriv = randomKeyHex();
    const alicePub = getPublicKey(alicePriv);
    const bobPriv = randomKeyHex();
    const bobPub = getPublicKey(bobPriv);
    const bobOnMessage = vi.fn();

    const alice = new DmManager(pool, alicePriv, alicePub, () => {}, () => new FakePeerConnection());
    const bob = new DmManager(pool, bobPriv, bobPub, bobOnMessage, () => new FakePeerConnection());
    alice.start();
    bob.start();

    alice.sendMessage(bobPub, 'hi bob');

    expect(bobOnMessage).toHaveBeenCalledWith(alicePub, expect.objectContaining({ content: 'hi bob' }));
    expect(alice.getTransport(bobPub)).toBe('relay');
  });

  it('does not surface WebRTC signaling rumors as chat messages', async () => {
    const pool = createInMemoryRelayPool();
    const alicePriv = randomKeyHex();
    const alicePub = getPublicKey(alicePriv);
    const bobPriv = randomKeyHex();
    const bobPub = getPublicKey(bobPriv);
    const bobOnMessage = vi.fn();

    const alice = new DmManager(pool, alicePriv, alicePub, () => {}, () => new FakePeerConnection());
    const bob = new DmManager(pool, bobPriv, bobPub, bobOnMessage, () => new FakePeerConnection());
    alice.start();
    bob.start();

    alice.sendMessage(bobPub, 'first message'); // triggers an opportunistic WebRTC offer as a side effect
    await flushMicrotasks();

    expect(bobOnMessage).toHaveBeenCalledTimes(1);
    expect(bobOnMessage).toHaveBeenCalledWith(alicePub, expect.objectContaining({ content: 'first message' }));
  });

  it('upgrades to a direct data channel and reports transport as direct once open', async () => {
    const pool = createInMemoryRelayPool();
    const alicePriv = randomKeyHex();
    const alicePub = getPublicKey(alicePriv);
    const bobPriv = randomKeyHex();
    const bobPub = getPublicKey(bobPriv);

    const aliceConnections: FakePeerConnection[] = [];
    const bobConnections: FakePeerConnection[] = [];
    const bobOnMessage = vi.fn();

    const alice = new DmManager(pool, alicePriv, alicePub, () => {}, () => {
      const pc = new FakePeerConnection();
      aliceConnections.push(pc);
      return pc;
    });
    const bob = new DmManager(pool, bobPriv, bobPub, bobOnMessage, () => {
      const pc = new FakePeerConnection();
      bobConnections.push(pc);
      return pc;
    });
    alice.start();
    bob.start();

    alice.sendMessage(bobPub, 'first message'); // relay-delivered, and starts the WebRTC handshake
    await flushMicrotasks();

    expect(aliceConnections).toHaveLength(1);
    expect(bobConnections).toHaveLength(1);
    const aliceChannel = aliceConnections[0]!.channel as FakeDataChannel;
    const bobChannel = bobConnections[0]!.channel as FakeDataChannel;
    aliceChannel.simulateOpen();
    bobChannel.simulateOpen();

    expect(alice.getTransport(bobPub)).toBe('direct');

    alice.sendMessage(bobPub, 'second message, should go direct');
    expect(aliceChannel.sent).toHaveLength(1);
    bobChannel.deliver(aliceChannel.sent[0]!);

    expect(bobOnMessage).toHaveBeenCalledWith(
      alicePub,
      expect.objectContaining({ content: 'second message, should go direct' }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/dm/dmManager.test.ts`
Expected: FAIL — constructor arity mismatch (`DmManager` currently takes 4 arguments, tests pass 5).

- [ ] **Step 3: Write the implementation (full replacement of `dmManager.ts`)**

```ts
// web/src/dm/dmManager.ts
import type { RelayPoolLike } from '../relay/relayPool';
import type { NostrEvent } from '../nostr/event';
import { createGiftWrap, openGiftWrap, KIND_GIFT_WRAP, KIND_DM_RUMOR, type Rumor } from './giftWrap';
import { WebRtcSignaling, type PeerConnectionFactory, type DataChannelLike, type SignalPayload } from '../webrtc/signaling';

export interface ChatMessage {
  fromPubkey: string;
  content: string;
  createdAt: number;
}

export type DmTransport = 'relay' | 'direct';

const WEBRTC_SIGNAL_TAG = 'webrtc-signal';

export class DmManager {
  private unsubscribe: (() => void) | null = null;
  private signaling: WebRtcSignaling;
  private directChannels = new Map<string, DataChannelLike>();
  private attemptedDirectConnect = new Set<string>();

  constructor(
    private pool: RelayPoolLike,
    private identityPrivateKeyHex: string,
    private identityPublicKeyHex: string,
    private onMessage: (peerPubkey: string, message: ChatMessage) => void,
    createPeerConnection: PeerConnectionFactory,
  ) {
    this.signaling = new WebRtcSignaling(
      createPeerConnection,
      (peerPubkey, payload) => this.sendRumor(peerPubkey, JSON.stringify(payload), [['t', WEBRTC_SIGNAL_TAG]]),
      (peerPubkey, channel) => this.onDirectChannelOpen(peerPubkey, channel),
    );
  }

  start(): void {
    this.unsubscribe = this.pool.subscribe(
      { kinds: [KIND_GIFT_WRAP], '#p': [this.identityPublicKeyHex] },
      (event) => this.handleGiftWrap(event),
    );
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onDirectChannelOpen(peerPubkey: string, channel: DataChannelLike): void {
    this.directChannels.set(peerPubkey, channel);
    channel.onmessage = (ev) => {
      const parsed = JSON.parse(ev.data) as { content: string; createdAt: number };
      this.onMessage(peerPubkey, { fromPubkey: peerPubkey, content: parsed.content, createdAt: parsed.createdAt });
    };
    channel.onclose = () => this.directChannels.delete(peerPubkey);
  }

  private handleGiftWrap(event: NostrEvent): void {
    let rumor: Rumor;
    try {
      rumor = openGiftWrap(event, this.identityPrivateKeyHex);
    } catch {
      return;
    }
    const isSignal = rumor.tags.some((t) => t[0] === 't' && t[1] === WEBRTC_SIGNAL_TAG);
    if (isSignal) {
      void this.signaling.handleSignal(rumor.pubkey, JSON.parse(rumor.content) as SignalPayload);
      return;
    }
    if (rumor.kind !== KIND_DM_RUMOR) return;
    this.onMessage(rumor.pubkey, { fromPubkey: rumor.pubkey, content: rumor.content, createdAt: rumor.created_at });
  }

  sendMessage(recipientPubkey: string, content: string): void {
    const channel = this.directChannels.get(recipientPubkey);
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify({ content, createdAt: Math.floor(Date.now() / 1000) }));
      return;
    }
    this.sendRumor(recipientPubkey, content, []);
    if (!this.attemptedDirectConnect.has(recipientPubkey)) {
      this.attemptedDirectConnect.add(recipientPubkey);
      void this.signaling.initiate(recipientPubkey);
    }
  }

  private sendRumor(recipientPubkey: string, content: string, extraTags: string[][]): void {
    const rumor: Rumor = {
      pubkey: this.identityPublicKeyHex,
      created_at: Math.floor(Date.now() / 1000),
      kind: KIND_DM_RUMOR,
      tags: [['p', recipientPubkey], ...extraTags],
      content,
    };
    const wrap = createGiftWrap(rumor, this.identityPrivateKeyHex, recipientPubkey);
    this.pool.publish(wrap);
  }

  getTransport(peerPubkey: string): DmTransport {
    const channel = this.directChannels.get(peerPubkey);
    return channel && channel.readyState === 'open' ? 'direct' : 'relay';
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/dm/dmManager.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full test suite to confirm nothing else broke**

Run: `npm run test`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add web/src/dm/dmManager.ts web/src/dm/dmManager.test.ts
git commit -m "feat(web): upgrade DmManager to prefer a direct WebRTC channel"
```

---

## Task 12: UI Shell

**Files:**
- Create: `web/src/ui/render.ts`
- Test: `web/src/ui/render.test.ts`
- Modify: `web/index.html` (full replacement, shown below)
- Modify: `web/src/main.ts` (full replacement, shown below — replaces Task 1's placeholder)

**Interfaces:**
- Consumes: `GeohashMessage`, `ParticipantCount` from `../channel/geohashChannel.ts` (Task 6); `ChatMessage`, `DmTransport` from `../dm/dmManager.ts` (Task 11); everything else built in Tasks 2–11.
- Produces (in `render.ts`, pure DOM functions with no module-level state, so they're trivially unit-testable):
  - `appendGeohashMessage(container: HTMLElement, message: GeohashMessage): void`
  - `appendDmMessage(container: HTMLElement, message: ChatMessage, isOwn: boolean): void`
  - `renderParticipantCount(el: HTMLElement, count: ParticipantCount): void`
  - `renderTransport(el: HTMLElement, transport: DmTransport): void`
- `main.ts` has no exported interface — it is the app's composition root, wiring every module above into the DOM. It is verified by manual smoke test (Step 6) rather than a unit test, since it is pure wiring with no independent logic.

- [ ] **Step 1: Write the failing tests for `render.ts`**

```ts
// web/src/ui/render.test.ts
import { describe, it, expect } from 'vitest';
import { appendGeohashMessage, appendDmMessage, renderParticipantCount, renderTransport } from './render';

describe('render helpers', () => {
  it('appends a geohash message with nickname and content', () => {
    const container = document.createElement('div');
    appendGeohashMessage(container, { pubkey: 'a'.repeat(64), nickname: 'phill', content: 'hey', createdAt: 1700000000 });

    expect(container.children).toHaveLength(1);
    expect(container.textContent).toContain('phill');
    expect(container.textContent).toContain('hey');
  });

  it('appends a DM message and marks own messages with a distinct class', () => {
    const container = document.createElement('div');
    appendDmMessage(container, { fromPubkey: 'a'.repeat(64), content: 'hi', createdAt: 1700000000 }, true);
    appendDmMessage(container, { fromPubkey: 'b'.repeat(64), content: 'hey back', createdAt: 1700000001 }, false);

    expect(container.children).toHaveLength(2);
    expect((container.children[0] as HTMLElement).classList.contains('own')).toBe(true);
    expect((container.children[1] as HTMLElement).classList.contains('own')).toBe(false);
  });

  it('renders an exact participant count when precision allows it', () => {
    const el = document.createElement('span');
    renderParticipantCount(el, { count: 12, exact: true });
    expect(el.textContent).toBe('12 people');
  });

  it('renders an unknown-count placeholder when precision hides presence', () => {
    const el = document.createElement('span');
    renderParticipantCount(el, { count: 0, exact: false });
    expect(el.textContent).toBe('? people');
  });

  it('renders the DM transport indicator', () => {
    const el = document.createElement('span');
    renderTransport(el, 'direct');
    expect(el.textContent).toBe('direct');
    renderTransport(el, 'relay');
    expect(el.textContent).toBe('relay');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/ui/render.test.ts`
Expected: FAIL — `Cannot find module './render'`.

- [ ] **Step 3: Write the `render.ts` implementation**

```ts
// web/src/ui/render.ts
import type { GeohashMessage, ParticipantCount } from '../channel/geohashChannel';
import type { ChatMessage, DmTransport } from '../dm/dmManager';

export function appendGeohashMessage(container: HTMLElement, message: GeohashMessage): void {
  const el = document.createElement('div');
  el.className = 'geohash-message';
  const nickname = document.createElement('strong');
  nickname.textContent = message.nickname;
  const content = document.createElement('span');
  content.textContent = ` ${message.content}`;
  el.append(nickname, content);
  container.append(el);
}

export function appendDmMessage(container: HTMLElement, message: ChatMessage, isOwn: boolean): void {
  const el = document.createElement('div');
  el.className = isOwn ? 'dm-message own' : 'dm-message';
  el.textContent = message.content;
  container.append(el);
}

export function renderParticipantCount(el: HTMLElement, count: ParticipantCount): void {
  el.textContent = count.exact ? `${count.count} people` : '? people';
}

export function renderTransport(el: HTMLElement, transport: DmTransport): void {
  el.textContent = transport;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/ui/render.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Replace `web/index.html` and write `web/src/main.ts`**

```html
<!-- web/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PillTalk</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 1rem; }
      section { border: 1px solid #ccc; border-radius: 8px; padding: 0.75rem; margin-bottom: 1rem; }
      .geohash-message, .dm-message { padding: 0.25rem 0; }
      .dm-message.own { text-align: right; color: #2a6; }
      form { display: flex; gap: 0.5rem; }
      input[type="text"] { flex: 1; }
      #messages, #dm-messages { max-height: 240px; overflow-y: auto; margin-bottom: 0.5rem; }
    </style>
  </head>
  <body>
    <header>
      <strong>PillTalk</strong>
      <span id="pubkey-label"></span>
      <button id="wipe-button" type="button">Wipe</button>
    </header>
    <section>
      <h2>Geohash room: <span id="geohash-label"></span> (<span id="participant-count"></span>)</h2>
      <div id="messages"></div>
      <form id="geohash-form">
        <input id="geohash-input" type="text" placeholder="Message the room" required maxlength="500" />
        <button type="submit">Send</button>
      </form>
    </section>
    <section>
      <h2>Direct message (<span id="dm-transport"></span>)</h2>
      <input id="dm-recipient" type="text" placeholder="Recipient pubkey (hex)" />
      <div id="dm-messages"></div>
      <form id="dm-form">
        <input id="dm-input" type="text" placeholder="Message" required maxlength="500" />
        <button type="submit">Send</button>
      </form>
    </section>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```ts
// web/src/main.ts
import { loadOrCreateIdentity, wipeIdentity } from './identity/identity';
import { RelayPool, type MinimalWebSocket } from './relay/relayPool';
import { GeohashChannel } from './channel/geohashChannel';
import { GEOHASH_PRECISION, geohashEncode } from './geohash/geohash';
import { DmManager } from './dm/dmManager';
import type { PeerConnectionLike } from './webrtc/signaling';
import { appendGeohashMessage, appendDmMessage, renderParticipantCount, renderTransport } from './ui/render';

const RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const DEFAULT_GEOHASH = 'u4pru'; // used when geolocation is unavailable or denied

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

async function currentGeohash(): Promise<string> {
  if (!navigator.geolocation) return DEFAULT_GEOHASH;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(geohashEncode(pos.coords.latitude, pos.coords.longitude, GEOHASH_PRECISION.neighborhood)),
      () => resolve(DEFAULT_GEOHASH),
      { timeout: 5000 },
    );
  });
}

async function main(): Promise<void> {
  const identity = loadOrCreateIdentity(window.localStorage);
  byId('pubkey-label').textContent = identity.publicKeyHex.slice(0, 12);

  const pool = new RelayPool(RELAY_URLS, (url) => new WebSocket(url) as unknown as MinimalWebSocket);

  const geohash = await currentGeohash();
  byId('geohash-label').textContent = geohash;
  const messagesEl = byId('messages');
  const participantCountEl = byId('participant-count');
  const channel = new GeohashChannel(pool, identity.privateKeyHex, geohash, (message) => {
    appendGeohashMessage(messagesEl, message);
    renderParticipantCount(participantCountEl, channel.getParticipantCount());
  });
  channel.join();
  renderParticipantCount(participantCountEl, channel.getParticipantCount());

  byId<HTMLFormElement>('geohash-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = byId<HTMLInputElement>('geohash-input');
    if (!input.value.trim()) return;
    channel.sendMessage(input.value, identity.publicKeyHex.slice(0, 8));
    input.value = '';
  });

  const dmMessagesEl = byId('dm-messages');
  const dmTransportEl = byId('dm-transport');
  const createPeerConnection = (): PeerConnectionLike =>
    new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }) as unknown as PeerConnectionLike;
  const dmManager = new DmManager(
    pool,
    identity.privateKeyHex,
    identity.publicKeyHex,
    (peerPubkey, message) => {
      appendDmMessage(dmMessagesEl, message, false);
      renderTransport(dmTransportEl, dmManager.getTransport(peerPubkey));
    },
    createPeerConnection,
  );
  dmManager.start();

  byId<HTMLFormElement>('dm-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const recipient = byId<HTMLInputElement>('dm-recipient').value.trim();
    const input = byId<HTMLInputElement>('dm-input');
    if (!recipient || !input.value.trim()) return;
    dmManager.sendMessage(recipient, input.value);
    appendDmMessage(dmMessagesEl, { fromPubkey: identity.publicKeyHex, content: input.value, createdAt: Date.now() / 1000 }, true);
    renderTransport(dmTransportEl, dmManager.getTransport(recipient));
    input.value = '';
  });

  byId('wipe-button').addEventListener('click', () => {
    wipeIdentity(window.localStorage);
    window.location.reload();
  });
}

void main();
```

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`, then in a browser:
1. Open `http://localhost:5173`. Confirm the page shows a pubkey prefix, a geohash label, and (if you allow the location prompt) a real neighborhood-level geohash.
2. Type a message in the geohash room form and send it — confirm it appears in the message list immediately (you see your own publish echoed back once the relay confirms it).
3. Open a second browser profile/incognito window to the same URL (this creates a second, independent identity) and send a message from it — confirm it appears in the first window's room within a few seconds.
4. In the direct-message section of the second window, paste the first window's pubkey (visible via browser dev tools console: `JSON.parse(localStorage.getItem('pilltalk.identity.privkey'))` is the raw private key — instead read the displayed prefix and, for this manual test, temporarily log the full `identity.publicKeyHex` in `main.ts` or read it from the Nostr event tags printed in the network tab) and send a DM — confirm it arrives in the first window's DM pane, and that the transport indicator eventually flips from `relay` to `direct` after a few seconds if both tabs stayed open.
5. Click "Wipe" — confirm the page reloads with a new pubkey prefix.

- [ ] **Step 7: Commit**

```bash
git add web/src/ui/render.ts web/src/ui/render.test.ts web/index.html web/src/main.ts
git commit -m "feat(web): wire identity, geohash channel, and DM manager into a UI shell"
```

---

## Task 13: Cloudflare Pages Deployment

**Files:**
- Create: `web/wrangler.toml`
- Create: `web/.gitignore`

**Interfaces:**
- Produces: a `wrangler pages deploy` -ready static build, using the `deploy` script already defined in `web/package.json` (Task 1).

- [ ] **Step 1: Create `web/wrangler.toml`**

```toml
name = "pilltalk"
compatibility_date = "2026-07-26"
pages_build_output_dir = "dist"
```

- [ ] **Step 2: Create `web/.gitignore`**

```
node_modules
dist
.wrangler
```

- [ ] **Step 3: Build the production bundle**

Run: `cd web && npm run build`
Expected: exits 0, `web/dist/index.html` and `web/dist/assets/*.js` exist.

- [ ] **Step 4: One-time Cloudflare login (manual, interactive)**

Run: `npx wrangler login`
Expected: opens a browser to authorize the Wrangler CLI against your Cloudflare account. Skip if `wrangler whoami` already shows you logged in.

- [ ] **Step 5: Deploy**

Run: `npm run deploy`
Expected: creates the `pilltalk` Cloudflare Pages project on first run and prints a `*.pages.dev` preview URL. Open that URL and repeat the Task 12 Step 6 manual smoke test against the deployed site.

- [ ] **Step 6: Commit**

```bash
git add web/wrangler.toml web/.gitignore
git commit -m "chore(web): add Cloudflare Pages deployment config"
```

---

## Plan Self-Review

**Spec coverage:**
- Geohash channel wire compatibility (kind 20000/20001, `g`/`n` tags, precision table, presence-only-≤city rule, 5-minute online window) — Task 6.
- Identity as browser-local secp256k1 keypair, no accounts — Task 3.
- DMs via NIP-17 (rumor → seal → gift wrap) — Tasks 7, 8, 9.
- WebRTC direct layer with signaling carried over Nostr DMs, public STUN only, silent fallback to relay — Tasks 10, 11.
- Static hosting, zero custom backend — Tasks 1, 13.
- Wipe clears identity and reloads — Task 12 (Step 5 wires `wipeIdentity` to the button; `RelayPool`/`RTCPeerConnection` teardown happens implicitly via `window.location.reload()`, which discards the whole JS runtime state including all open sockets and peer connections).
- Relay reconnect/backoff and event dedup — Task 5.
- Malformed-event resilience (spec section 6) — `RelayPool.handleMessage` (Task 5) drops anything that fails `JSON.parse` or lacks a string `id`, and `DmManager.handleGiftWrap` (Tasks 9/11) drops anything that fails to open as a valid gift wrap, both without throwing out of the subscription callback.
- Geolocation-denied fallback (spec section 6) — Task 12's `currentGeohash()` resolves to `DEFAULT_GEOHASH` if `navigator.geolocation` is absent or the permission prompt is denied/times out.

**Not covered (explicitly out of scope per spec section 8, no task needed):** web push notifications, TURN relay, multi-peer WebRTC group chat.

**Placeholder scan:** no TBD/TODO markers; every step has runnable code or an exact command with expected output.

**Type consistency check:** `RelayPoolLike`, `NostrEvent`, `UnsignedEvent`, `GeohashMessage`, `ParticipantCount`, `ChatMessage`, `DmTransport`, `PeerConnectionLike`, `DataChannelLike`, `SignalPayload` are each defined exactly once (Tasks 2, 5, 6, 11 (re-exported from `dmManager.ts`), 10) and referenced with identical names/shapes everywhere they're consumed downstream — verified while writing Tasks 6, 9, 11, 12.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-26-pilltalk-web-app.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

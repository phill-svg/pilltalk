// web/src/dm/dmManager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DmManager, WEBRTC_RETRY_COOLDOWN_MS } from './dmManager';
import { createInMemoryRelayPool } from '../testutil/inMemoryRelayPool';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey } from '../nostr/event';
import type { PeerConnectionLike, DataChannelLike } from '../webrtc/signaling';
import { createGiftWrap, KIND_GIFT_WRAP, KIND_DM_RUMOR } from './giftWrap';

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
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Simulates a handshake that stalls forever - e.g. the peer never answers, a
// signaling message gets dropped, or ICE negotiation hangs. createOffer()
// never resolves, so signaling.initiate()'s returned promise never settles.
class StallingPeerConnection extends FakePeerConnection {
  async createOffer(): Promise<{ type: string; sdp: string }> {
    return new Promise(() => {});
  }
}

// Simulates a handshake that fails fast (e.g. ICE gathering fails
// immediately) - initiate()'s returned promise rejects.
class FailingPeerConnection extends FakePeerConnection {
  async createOffer(): Promise<{ type: string; sdp: string }> {
    throw new Error('ICE failed');
  }
}

describe('DmManager', () => {
  it('delivers a message via relay when no direct channel exists', async () => {
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

    // Incoming DM content is decoded asynchronously (it's checked against
    // the iOS/Android "pilltalk1:" packet format before falling back to
    // plain text), so the receiving side's callback fires on a microtask.
    await vi.waitFor(() => {
      expect(bobOnMessage).toHaveBeenCalledWith(alicePub, expect.objectContaining({ content: 'hi bob' }));
    });
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

  it('silently drops a gift-wrap event with a forged/invalid signature instead of delivering or throwing', () => {
    const pool = createInMemoryRelayPool();
    const bobPriv = randomKeyHex();
    const bobPub = getPublicKey(bobPriv);

    const bobOnMessage = vi.fn();
    const bob = new DmManager(pool, bobPriv, bobPub, bobOnMessage, () => new FakePeerConnection());
    bob.start();

    // Build a legitimate-looking gift wrap addressed to bob, then corrupt its
    // signature so it fails verifyEvent's signature check inside openGiftWrap.
    const attackerPriv = randomKeyHex();
    const forgedWrap = createGiftWrap(
      { pubkey: getPublicKey(attackerPriv), created_at: Math.floor(Date.now() / 1000), kind: KIND_DM_RUMOR, tags: [['p', bobPub]], content: 'forged' },
      attackerPriv,
      bobPub,
    );
    expect(forgedWrap.kind).toBe(KIND_GIFT_WRAP);
    const flippedChar = forgedWrap.sig[0] === '0' ? '1' : '0';
    const tamperedWrap = { ...forgedWrap, sig: flippedChar + forgedWrap.sig.slice(1) };

    expect(() => pool.publish(tamperedWrap)).not.toThrow();
    expect(bobOnMessage).not.toHaveBeenCalled();
  });

  it('retries the WebRTC direct-channel upgrade after the cooldown when the first attempt never opened', async () => {
    const pool = createInMemoryRelayPool();
    const alicePriv = randomKeyHex();
    const alicePub = getPublicKey(alicePriv);
    const bobPriv = randomKeyHex();
    const bobPub = getPublicKey(bobPriv);

    const aliceConnections: FakePeerConnection[] = [];
    let now = 1_700_000_000_000;

    const alice = new DmManager(
      pool,
      alicePriv,
      alicePub,
      () => {},
      () => {
        const pc = new FakePeerConnection();
        aliceConnections.push(pc);
        return pc;
      },
      () => now,
    );
    // No bob DmManager is started, so alice's offer is never answered and her
    // FakePeerConnection's data channel never opens - simulating a peer that
    // is offline or an ICE handshake that never completes.
    alice.start();

    alice.sendMessage(bobPub, 'first message');
    await flushMicrotasks();
    expect(aliceConnections).toHaveLength(1);

    // Still within the cooldown window: no second attempt.
    now += 29_000;
    alice.sendMessage(bobPub, 'second message, still within cooldown');
    await flushMicrotasks();
    expect(aliceConnections).toHaveLength(1);

    // Past the cooldown window: alice gets another shot at upgrading.
    now += 2_000; // total elapsed: 31s
    alice.sendMessage(bobPub, 'third message, past cooldown');
    await flushMicrotasks();
    expect(aliceConnections).toHaveLength(2);
  });

  it('does not start a second concurrent WebRTC initiate() attempt for the same peer while the first is still pending, even past the cooldown', async () => {
    const pool = createInMemoryRelayPool();
    const alicePriv = randomKeyHex();
    const alicePub = getPublicKey(alicePriv);
    const bobPriv = randomKeyHex();
    const bobPub = getPublicKey(bobPriv);

    const aliceConnections: StallingPeerConnection[] = [];
    let now = 1_700_000_000_000;

    const alice = new DmManager(
      pool,
      alicePriv,
      alicePub,
      () => {},
      () => {
        const pc = new StallingPeerConnection();
        aliceConnections.push(pc);
        return pc;
      },
      () => now,
    );
    // No bob DmManager is started, and the fake connection's createOffer()
    // never resolves - simulating a handshake that stalls forever (peer
    // never answers, a signaling message gets dropped, ICE hangs). The
    // signaling.initiate() promise for the first attempt never settles.
    alice.start();

    alice.sendMessage(bobPub, 'first message');
    await flushMicrotasks();
    expect(aliceConnections).toHaveLength(1);

    // Past the cooldown window, but the first attempt is still outstanding.
    // Without in-flight tracking, sendMessage would start a second,
    // concurrent signaling.initiate() call for the same peer here.
    now += WEBRTC_RETRY_COOLDOWN_MS + 1_000;
    alice.sendMessage(bobPub, 'second message, past cooldown but first attempt still pending');
    await flushMicrotasks();
    expect(aliceConnections).toHaveLength(1);
  });

  it('allows a new WebRTC upgrade attempt past the cooldown once the previous attempt has settled by rejecting', async () => {
    const pool = createInMemoryRelayPool();
    const alicePriv = randomKeyHex();
    const alicePub = getPublicKey(alicePriv);
    const bobPriv = randomKeyHex();
    const bobPub = getPublicKey(bobPriv);

    const aliceConnections: FakePeerConnection[] = [];
    let now = 1_700_000_000_000;
    let useFailingConnection = true;

    const alice = new DmManager(
      pool,
      alicePriv,
      alicePub,
      () => {},
      () => {
        const pc = useFailingConnection ? new FailingPeerConnection() : new FakePeerConnection();
        aliceConnections.push(pc);
        return pc;
      },
      () => now,
    );
    alice.start();

    alice.sendMessage(bobPub, 'first message');
    await flushMicrotasks();
    expect(aliceConnections).toHaveLength(1);

    // The first attempt rejected (settled), so once the cooldown has also
    // elapsed, a fresh attempt must be allowed to start.
    useFailingConnection = false;
    now += WEBRTC_RETRY_COOLDOWN_MS + 1_000;
    alice.sendMessage(bobPub, 'second message, past cooldown and prior attempt settled');
    await flushMicrotasks();
    expect(aliceConnections).toHaveLength(2);
  });

  it('never re-attempts a WebRTC upgrade once a direct channel is open for that peer', async () => {
    const pool = createInMemoryRelayPool();
    const alicePriv = randomKeyHex();
    const alicePub = getPublicKey(alicePriv);
    const bobPriv = randomKeyHex();
    const bobPub = getPublicKey(bobPriv);

    const aliceConnections: FakePeerConnection[] = [];
    const bobConnections: FakePeerConnection[] = [];
    let now = 1_700_000_000_000;

    const alice = new DmManager(
      pool,
      alicePriv,
      alicePub,
      () => {},
      () => {
        const pc = new FakePeerConnection();
        aliceConnections.push(pc);
        return pc;
      },
      () => now,
    );
    const bob = new DmManager(pool, bobPriv, bobPub, () => {}, () => {
      const pc = new FakePeerConnection();
      bobConnections.push(pc);
      return pc;
    });
    alice.start();
    bob.start();

    alice.sendMessage(bobPub, 'first message');
    await flushMicrotasks();
    expect(aliceConnections).toHaveLength(1);

    const aliceChannel = aliceConnections[0]!.channel as FakeDataChannel;
    const bobChannel = bobConnections[0]!.channel as FakeDataChannel;
    aliceChannel.simulateOpen();
    bobChannel.simulateOpen();
    expect(alice.getTransport(bobPub)).toBe('direct');

    // Advance well past the cooldown and send many more messages - since the
    // direct channel is open, sendMessage returns early via the channel.send
    // path and never reaches the WebRTC-retry branch at all.
    now += 10 * WEBRTC_RETRY_COOLDOWN_MS;
    alice.sendMessage(bobPub, 'second message, should go direct');
    alice.sendMessage(bobPub, 'third message, should go direct');
    await flushMicrotasks();

    expect(aliceConnections).toHaveLength(1);
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
    const alice = new DmManager(pool, alicePriv, alicePub, () => {}, () => new FakePeerConnection());
    const bob = new DmManager(pool, bobPriv, bobPub, () => {}, () => new FakePeerConnection());
    const carol = new DmManager(pool, carolPriv, carolPub, carolOnMessage, () => new FakePeerConnection());
    alice.start();
    bob.start();
    carol.start();

    alice.sendMessage(bobPub, 'private to bob');

    expect(carolOnMessage).not.toHaveBeenCalled();
  });
});

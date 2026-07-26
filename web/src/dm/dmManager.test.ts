// web/src/dm/dmManager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DmManager } from './dmManager';
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

// web/src/dm/dmManager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DmManager } from './dmManager';
import { createInMemoryRelayPool } from '../testutil/inMemoryRelayPool';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey } from '../nostr/event';
import { createGiftWrap, KIND_GIFT_WRAP, KIND_DM_RUMOR } from './giftWrap';

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

  it('silently drops a gift-wrap event with a forged/invalid signature instead of delivering or throwing', () => {
    const pool = createInMemoryRelayPool();
    const bobPriv = randomKeyHex();
    const bobPub = getPublicKey(bobPriv);

    const bobOnMessage = vi.fn();
    const bob = new DmManager(pool, bobPriv, bobPub, bobOnMessage);
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
});

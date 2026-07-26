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

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

  it('does not trust a forged rumor.pubkey impersonating a third party', () => {
    const senderPriv = randomKeyHex();
    const senderPub = getPublicKey(senderPriv);
    const recipientPriv = randomKeyHex();
    const recipientPub = getPublicKey(recipientPriv);
    const victimPriv = randomKeyHex();
    const victimPub = getPublicKey(victimPriv);

    // Attacker (sender) forges a rumor claiming to be from `victimPub`,
    // but seals/wraps it with their own key.
    const forgedRumor: Rumor = {
      pubkey: victimPub,
      created_at: 1700000000,
      kind: KIND_DM_RUMOR,
      tags: [['p', recipientPub]],
      content: 'wire the funds now',
    };
    const wrap = createGiftWrap(forgedRumor, senderPriv, recipientPub, 1700000000);
    const opened = openGiftWrap(wrap, recipientPriv);

    // The authenticated sender is whoever's key actually produced the seal
    // (the attacker), never the rumor's self-reported pubkey (the victim).
    expect(opened.pubkey).toBe(senderPub);
    expect(opened.pubkey).not.toBe(victimPub);
  });

  it('throws when the gift wrap event signature has been tampered with', () => {
    const senderPriv = randomKeyHex();
    const senderPub = getPublicKey(senderPriv);
    const recipientPriv = randomKeyHex();
    const recipientPub = getPublicKey(recipientPriv);

    const rumor: Rumor = { pubkey: senderPub, created_at: 1700000000, kind: KIND_DM_RUMOR, tags: [], content: 'hi' };
    const wrap = createGiftWrap(rumor, senderPriv, recipientPub, 1700000000);

    const flippedChar = wrap.sig[0] === '0' ? '1' : '0';
    const tamperedWrap = { ...wrap, sig: flippedChar + wrap.sig.slice(1) };

    expect(() => openGiftWrap(tamperedWrap, recipientPriv)).toThrow();
  });
});

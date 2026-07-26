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

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
    const lastIndex = bytes.length - 1;
    bytes[lastIndex] = bytes[lastIndex]! ^ 0xff; // flip a bit in the MAC
    const tampered = btoa(String.fromCharCode(...bytes));

    expect(() => nip44Decrypt(tampered, bobPriv, alicePub)).toThrow();
  });
});

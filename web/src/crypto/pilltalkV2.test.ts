// web/src/crypto/pilltalkV2.test.ts
import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { pilltalkV2Encrypt, pilltalkV2Decrypt } from './pilltalkV2';

function randomKeypair(): { privHex: string; pubXOnlyHex: string } {
  const privBytes = secp256k1.utils.randomPrivateKey();
  const privHex = bytesToHex(privBytes);
  const fullPub = secp256k1.getPublicKey(privBytes, true); // 33-byte compressed
  const pubXOnlyHex = bytesToHex(fullPub.slice(1)); // drop the 0x02/0x03 prefix
  return { privHex, pubXOnlyHex };
}

describe('pilltalkV2Encrypt / pilltalkV2Decrypt', () => {
  it('round-trips a message between two parties', () => {
    const alice = randomKeypair();
    const bob = randomKeypair();

    const ciphertext = pilltalkV2Encrypt('hello bob', alice.privHex, bob.pubXOnlyHex);
    expect(ciphertext.startsWith('v2:')).toBe(true);

    const decrypted = pilltalkV2Decrypt(ciphertext, bob.privHex, alice.pubXOnlyHex);
    expect(decrypted).toBe('hello bob');
  });

  it('produces different ciphertext for the same plaintext each time (random nonce)', () => {
    const alice = randomKeypair();
    const bob = randomKeypair();
    const a = pilltalkV2Encrypt('same message', alice.privHex, bob.pubXOnlyHex);
    const b = pilltalkV2Encrypt('same message', alice.privHex, bob.pubXOnlyHex);
    expect(a).not.toBe(b);
  });

  it('fails to decrypt with the wrong recipient key', () => {
    const alice = randomKeypair();
    const bob = randomKeypair();
    const mallory = randomKeypair();

    const ciphertext = pilltalkV2Encrypt('for bob only', alice.privHex, bob.pubXOnlyHex);
    expect(() => pilltalkV2Decrypt(ciphertext, mallory.privHex, alice.pubXOnlyHex)).toThrow();
  });

  it('fails to decrypt with the wrong sender pubkey', () => {
    const alice = randomKeypair();
    const bob = randomKeypair();
    const mallory = randomKeypair();

    const ciphertext = pilltalkV2Encrypt('for bob only', alice.privHex, bob.pubXOnlyHex);
    expect(() => pilltalkV2Decrypt(ciphertext, bob.privHex, mallory.pubXOnlyHex)).toThrow();
  });

  it('rejects tampered ciphertext (Poly1305 authentication)', () => {
    const alice = randomKeypair();
    const bob = randomKeypair();
    const ciphertext = pilltalkV2Encrypt('integrity check', alice.privHex, bob.pubXOnlyHex);

    const b64 = ciphertext.slice('v2:'.length);
    const tamperedB64 = b64.slice(0, -4) + (b64.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    expect(() => pilltalkV2Decrypt('v2:' + tamperedB64, bob.privHex, alice.pubXOnlyHex)).toThrow();
  });

  it('rejects ciphertext missing the v2: prefix', () => {
    expect(() => pilltalkV2Decrypt('not-v2-prefixed', randomKeypair().privHex, randomKeypair().pubXOnlyHex)).toThrow();
  });
});

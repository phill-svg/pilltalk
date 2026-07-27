// web/src/crypto/pilltalkV2.ts
//
// The iOS and Android apps' gift-wrap/seal encryption is labeled "NIP-44 v2"
// internally, but is NOT the real NIP-44 spec (see crypto/nip44.ts, which
// *is* spec-compliant and vector-tested -- that module is unrelated to this
// one and still correct on its own terms). The native apps' actual scheme,
// reverse-engineered from pilltalk/Nostr/{NostrProtocol,XChaCha20Poly1305Compat}.swift:
//
//   1. ECDH shared secret = the raw 33-byte SEC1-*compressed* serialization
//      of (privkey * pubkey) on secp256k1 -- not hashed, not x-only. Per
//      21-DOT-DEV/swift-secp256k1's ECDH.swift, `format: .compressed`
//      overrides the library's default SHA-256-of-point hash so the caller
//      gets the raw point. The encrypting side always assumes the peer's
//      x-only pubkey has even Y (prefix 0x02); the decrypting side tries
//      even then odd, since it can't know which the sender assumed.
//   2. encryption key = HKDF-SHA256(salt=empty, ikm=shared secret,
//      info="nip44-v2", length=32) -- note this is standard HKDF-extract-
//      and-expand over the *raw point*, unrelated to real NIP-44's
//      hkdf_extract(salt="nip44-v2", ikm=x-only-ecdh).
//   3. AEAD = XChaCha20-Poly1305 (standard construction: HChaCha20 subkey
//      from nonce[0:16], then ChaCha20-Poly1305 with a 12-byte nonce of
//      4 zero bytes + nonce[16:24]), 24-byte random nonce, no AAD.
//   4. wire format: "v2:" + base64url(nonce24 || ciphertext || tag).
//
// Without matching this exact (non-standard) construction, gift-wrap
// content is undecryptable in both directions between this web app and the
// native apps -- this is the actual reason DMs never worked, independent of
// (and more fundamental than) the pilltalk1 packet-format fix in
// dm/pilltalkPacket.ts, which addresses the *inner* rumor content only.

import { secp256k1 } from '@noble/curves/secp256k1';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hexToBytes } from '@noble/hashes/utils';

const HKDF_INFO = new TextEncoder().encode('nip44-v2');
const NONCE_SIZE = 24;
const TAG_SIZE = 16;

function deriveKey(sharedSecret33: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret33, new Uint8Array(0), HKDF_INFO, 32);
}

function fullPubkey(xOnlyHex: string, evenY: boolean): Uint8Array {
  return hexToBytes((evenY ? '02' : '03') + xOnlyHex);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encrypts `plaintext` the way the iOS/Android apps expect: assumes the
 * recipient's x-only pubkey has even Y (matching their encrypt-side
 * convention), so a native client decrypting this can find the matching
 * shared secret on its first parity attempt.
 */
export function pilltalkV2Encrypt(plaintext: string, senderPrivateKeyHex: string, recipientXOnlyPubkeyHex: string): string {
  const sharedSecret = secp256k1.getSharedSecret(senderPrivateKeyHex, fullPubkey(recipientXOnlyPubkeyHex, true), true);
  const key = deriveKey(sharedSecret);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_SIZE));
  const sealed = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(plaintext));

  const combined = new Uint8Array(NONCE_SIZE + sealed.length);
  combined.set(nonce, 0);
  combined.set(sealed, NONCE_SIZE);
  return 'v2:' + base64UrlEncode(combined);
}

/**
 * Decrypts a "v2:"-prefixed payload from the iOS/Android apps. Tries even-Y
 * then odd-Y for the sender's x-only pubkey, matching their own decrypt-side
 * fallback (the decryptor can't know which parity the sender assumed).
 */
export function pilltalkV2Decrypt(ciphertext: string, recipientPrivateKeyHex: string, senderXOnlyPubkeyHex: string): string {
  if (!ciphertext.startsWith('v2:')) throw new Error('pilltalkV2: missing v2: prefix');
  const combined = base64UrlDecode(ciphertext.slice('v2:'.length));
  if (combined.length <= NONCE_SIZE + TAG_SIZE) throw new Error('pilltalkV2: payload too short');

  const nonce = combined.slice(0, NONCE_SIZE);
  const sealed = combined.slice(NONCE_SIZE);

  for (const evenY of [true, false]) {
    try {
      const sharedSecret = secp256k1.getSharedSecret(recipientPrivateKeyHex, fullPubkey(senderXOnlyPubkeyHex, evenY), true);
      const key = deriveKey(sharedSecret);
      const plaintext = xchacha20poly1305(key, nonce).decrypt(sealed);
      return new TextDecoder().decode(plaintext);
    } catch {
      continue;
    }
  }
  throw new Error('pilltalkV2: decryption failed with both key parities');
}

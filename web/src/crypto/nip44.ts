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
  let previous: Uint8Array = new Uint8Array(0);
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

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
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
  const macsMatch = constantTimeEqual(expectedMac, mac);
  if (!macsMatch) throw new Error('nip44: MAC verification failed');
  const paddedPlaintext = chacha20(chachaKey, chachaNonce, ciphertext);
  return new TextDecoder().decode(unpad(paddedPlaintext));
}

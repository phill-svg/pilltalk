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

export function conversationKey(privateKeyHex: string, publicKeyXOnlyHex: string): Uint8Array {
  // NIP-44 ECDH assumes an even-y point for the x-only pubkey (BIP340 convention).
  const compressedPubkey = concatBytes(Uint8Array.of(0x02), hexToBytes(publicKeyXOnlyHex));
  const shared = secp256k1.getSharedSecret(hexToBytes(privateKeyHex), compressedPubkey);
  const sharedX = shared.slice(1, 33);
  return hkdfExtract(utf8ToBytes('nip44-v2'), sharedX);
}

// NIP-44 v2 wire-format limits (see https://github.com/nostr-protocol/nips/blob/master/44.md).
const NIP44_VERSION = 2;
const MIN_PLAINTEXT_LEN = 1;
const MAX_PLAINTEXT_LEN = 65535;
// payload = version(1) + nonce(32) + ciphertext + mac(32), where ciphertext
// is the ChaCha20 encryption of `pad()`'s output: a 2-byte length prefix
// followed by calcPaddedLen(unpaddedLen) bytes (32..65536), so ciphertext
// itself ranges 34..65538.
const MIN_PAYLOAD_LEN = 1 + 32 + 34 + 32; // 99
const MAX_PAYLOAD_LEN = 1 + 32 + 65538 + 32; // 65603
// Base64-STRING length bounds corresponding to the byte bounds above, so an
// oversized/malformed payloadBase64 can be rejected before atob() decodes
// the entire (attacker-controlled) string into memory. Base64 encodes 3
// bytes as 4 characters, rounded up to the next multiple of 4 (padding
// included): length = ceil(byteLen / 3) * 4.
const MIN_PAYLOAD_BASE64_LEN = Math.ceil(MIN_PAYLOAD_LEN / 3) * 4; // 132
const MAX_PAYLOAD_BASE64_LEN = Math.ceil(MAX_PAYLOAD_LEN / 3) * 4; // 87472

export function calcPaddedLen(unpaddedLen: number): number {
  if (unpaddedLen <= 32) return 32;
  const nextPower = 2 ** (Math.floor(Math.log2(unpaddedLen - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((unpaddedLen - 1) / chunk) + 1);
}

export function pad(plaintext: Uint8Array): Uint8Array {
  const paddedLen = calcPaddedLen(plaintext.length);
  const result = new Uint8Array(2 + paddedLen);
  new DataView(result.buffer).setUint16(0, plaintext.length, false);
  result.set(plaintext, 2);
  return result;
}

// Reverses `pad`, but also enforces that the padding is exactly what the
// spec dictates for the declared length. Without this check, a payload
// with tampered/wrong padding bytes will silently decrypt to a plausible
// but wrong plaintext instead of being rejected (NIP-44 "invalid padding").
function unpad(padded: Uint8Array): Uint8Array {
  const length = new DataView(padded.buffer, padded.byteOffset).getUint16(0, false);
  const unpadded = padded.slice(2, 2 + length);
  if (
    length < MIN_PLAINTEXT_LEN ||
    length > MAX_PLAINTEXT_LEN ||
    unpadded.length !== length ||
    padded.length !== 2 + calcPaddedLen(length)
  ) {
    throw new Error('nip44: invalid padding');
  }
  return unpadded;
}

export function deriveMessageKeys(conversationKeyBytes: Uint8Array, nonce: Uint8Array) {
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
  const plaintextBytes = utf8ToBytes(plaintext);
  if (plaintextBytes.length < MIN_PLAINTEXT_LEN || plaintextBytes.length > MAX_PLAINTEXT_LEN) {
    throw new Error('nip44: invalid plaintext length');
  }
  const key = conversationKey(senderPrivateKeyHex, recipientPublicKeyHex);
  const nonce = randomBytes(32);
  const { chachaKey, chachaNonce, hmacKey } = deriveMessageKeys(key, nonce);
  const paddedPlaintext = pad(plaintextBytes);
  const ciphertext = chacha20(chachaKey, chachaNonce, paddedPlaintext);
  const mac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext));
  const payload = concatBytes(Uint8Array.of(NIP44_VERSION), nonce, ciphertext, mac);
  return btoa(String.fromCharCode(...payload));
}

// Decrypts a payload against an already-derived conversation key. Split out
// from nip44Decrypt so the wire-format validation (version byte, payload
// size bounds, MAC, padding) can be exercised directly against test vectors
// that supply a conversation_key but no underlying keypair (deriving a
// private/public keypair that produces a given conversation key is
// infeasible, since conversationKey() is one-way ECDH+HKDF).
export function decryptWithConversationKey(payloadBase64: string, conversationKeyBytes: Uint8Array): string {
  // Check the base64 STRING length before decoding. payloadBase64 is
  // attacker-controlled (e.g. arbitrary gift-wrap content from any relay or
  // peer), so an unbounded-size malicious string must be rejected cheaply
  // here rather than fully decoded via atob() first. (The reference
  // implementation additionally special-cases a leading '#' character as a
  // documented future-version sentinel; that's skipped here because atob()
  // already throws on '#' as an invalid base64 character, so it's covered
  // by this same length/atob combination without duplicating the check.)
  if (payloadBase64.length < MIN_PAYLOAD_BASE64_LEN || payloadBase64.length > MAX_PAYLOAD_BASE64_LEN) {
    throw new Error('nip44: invalid payload length');
  }
  const payload = Uint8Array.from(atob(payloadBase64), (c) => c.charCodeAt(0));
  if (payload.length < MIN_PAYLOAD_LEN || payload.length > MAX_PAYLOAD_LEN) {
    throw new Error('nip44: invalid payload length');
  }
  if (payload[0] !== NIP44_VERSION) {
    throw new Error('nip44: unknown encryption version');
  }
  const nonce = payload.slice(1, 33);
  const mac = payload.slice(payload.length - 32);
  const ciphertext = payload.slice(33, payload.length - 32);
  const { chachaKey, chachaNonce, hmacKey } = deriveMessageKeys(conversationKeyBytes, nonce);
  const expectedMac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext));
  const macsMatch = constantTimeEqual(expectedMac, mac);
  if (!macsMatch) throw new Error('nip44: MAC verification failed');
  const paddedPlaintext = chacha20(chachaKey, chachaNonce, ciphertext);
  return new TextDecoder().decode(unpad(paddedPlaintext));
}

export function nip44Decrypt(payloadBase64: string, receiverPrivateKeyHex: string, senderPublicKeyHex: string): string {
  const key = conversationKey(receiverPrivateKeyHex, senderPublicKeyHex);
  return decryptWithConversationKey(payloadBase64, key);
}

// web/src/crypto/nip44.vectors.test.ts
//
// Conformance check against the official published NIP-44 v2 test vectors
// (https://github.com/paulmillr/nip44), vendored at ./nip44.vectors.json.
//
// Testing strategy (see report at .superpowers/sdd/nip44-vectors-report.md
// for full reasoning):
//  - conversationKey, calcPaddedLen, deriveMessageKeys, pad and
//    decryptWithConversationKey are internal to nip44.ts and were exported
//    (no behavior change) specifically so these vectors can assert against
//    exact intermediate values, not just end-to-end round trips.
//  - encrypt_decrypt vectors carry a fixed nonce that nip44Encrypt (which
//    generates its own random nonce) cannot reproduce, so those vectors are
//    exercised through nip44Decrypt against the vector's real payload.
//  - invalid.decrypt vectors supply a conversation_key directly, with no
//    underlying keypair (deriving a keypair that produces a given
//    conversation key is infeasible - conversationKey() is one-way). They
//    are exercised through decryptWithConversationKey directly.
//  - encrypt_decrypt_long_msg vectors supply a conversation_key + fixed
//    nonce and only the sha256 of the plaintext/payload (the payloads
//    themselves are megabytes). They are exercised by reassembling the
//    exact NIP-44 wire format using pad() and deriveMessageKeys() (the real
//    production functions) plus the same @noble/ciphers and @noble/hashes
//    primitives production uses, then hashing the result.
import { describe, it, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { chacha20 } from '@noble/ciphers/chacha';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils';
import {
  conversationKey,
  calcPaddedLen,
  deriveMessageKeys,
  pad,
  decryptWithConversationKey,
  nip44Encrypt,
  nip44Decrypt,
} from './nip44';
import { getPublicKey } from '../nostr/event';
import vectors from './nip44.vectors.json';

const v2 = vectors.v2;

describe('NIP-44 v2 official vectors: calc_padded_len', () => {
  it.each(v2.valid.calc_padded_len)('calcPaddedLen(%i) === %i', (unpaddedLen, expectedPaddedLen) => {
    expect(calcPaddedLen(unpaddedLen)).toBe(expectedPaddedLen);
  });
});

describe('NIP-44 v2 official vectors: get_conversation_key (valid)', () => {
  it.each(v2.valid.get_conversation_key)(
    'derives the expected conversation key for sec1=$sec1',
    ({ sec1, pub2, conversation_key }) => {
      expect(bytesToHex(conversationKey(sec1, pub2))).toBe(conversation_key);
    }
  );
});

describe('NIP-44 v2 official vectors: get_conversation_key (invalid)', () => {
  it.each(v2.invalid.get_conversation_key)('rejects: $note', ({ sec1, pub2 }) => {
    expect(() => conversationKey(sec1, pub2)).toThrow();
  });
});

describe('NIP-44 v2 official vectors: get_message_keys', () => {
  const conversationKeyBytes = hexToBytes(v2.valid.get_message_keys.conversation_key);

  it.each(v2.valid.get_message_keys.keys)(
    'derives chacha_key/chacha_nonce/hmac_key for nonce=$nonce',
    ({ nonce, chacha_key, chacha_nonce, hmac_key }) => {
      const { chachaKey, chachaNonce, hmacKey } = deriveMessageKeys(conversationKeyBytes, hexToBytes(nonce));
      expect(bytesToHex(chachaKey)).toBe(chacha_key);
      expect(bytesToHex(chachaNonce)).toBe(chacha_nonce);
      expect(bytesToHex(hmacKey)).toBe(hmac_key);
    }
  );
});

describe('NIP-44 v2 official vectors: encrypt_decrypt (valid)', () => {
  // nip44Encrypt always generates a fresh random nonce, so it cannot
  // reproduce these vectors' exact `payload` byte-for-byte. Instead this
  // exercises the full decrypt path (conversation key derivation, message
  // key derivation, ChaCha20, MAC verification, unpadding) against a real
  // external payload and checks the recovered plaintext matches exactly.
  it.each(v2.valid.encrypt_decrypt)(
    'decrypts a real external payload back to plaintext=%j',
    ({ sec1, sec2, conversation_key, payload, plaintext }) => {
      const pub1 = getPublicKey(sec1);
      const pub2 = getPublicKey(sec2);

      // Bonus cross-check: conversation key derivation agrees with the
      // vector's stated conversation_key from both directions.
      expect(bytesToHex(conversationKey(sec1, pub2))).toBe(conversation_key);
      expect(bytesToHex(conversationKey(sec2, pub1))).toBe(conversation_key);

      expect(nip44Decrypt(payload, sec2, pub1)).toBe(plaintext);
    }
  );
});

describe('NIP-44 v2 official vectors: encrypt_decrypt_long_msg (valid)', () => {
  // These vectors are too large to inline a `payload` field; instead they
  // give a conversation_key + fixed nonce and the sha256 of the plaintext
  // and of the expected payload. Reassemble the exact NIP-44 wire format
  // (version || nonce || ciphertext || mac) using the real, exported
  // pad()/deriveMessageKeys() production functions plus the same
  // @noble/ciphers and @noble/hashes primitives nip44.ts itself uses, then
  // compare hashes. This proves the encryption math is byte-exact for
  // messages up to the maximum 65535-byte plaintext / padding bucket.
  it.each(v2.valid.encrypt_decrypt_long_msg)(
    'produces the expected plaintext/payload sha256 for pattern=%j',
    ({ conversation_key, nonce, pattern, repeat, plaintext_sha256, payload_sha256 }) => {
      const plaintext = pattern.repeat(repeat);
      const plaintextBytes = utf8ToBytes(plaintext);
      expect(bytesToHex(sha256(plaintextBytes))).toBe(plaintext_sha256);

      const key = hexToBytes(conversation_key);
      const nonceBytes = hexToBytes(nonce);
      const { chachaKey, chachaNonce, hmacKey } = deriveMessageKeys(key, nonceBytes);
      const paddedPlaintext = pad(plaintextBytes);
      const ciphertext = chacha20(chachaKey, chachaNonce, paddedPlaintext);
      const mac = hmac(sha256, hmacKey, concatBytes(nonceBytes, ciphertext));
      const payload = concatBytes(Uint8Array.of(2), nonceBytes, ciphertext, mac);
      // payload_sha256 in the vectors is the hash of the base64-encoded
      // payload *string* (as it would appear in a Nostr event's content
      // field), not the raw decoded bytes - confirmed by cross-checking
      // both interpretations against the vector.
      const payloadBase64 = btoa(String.fromCharCode(...payload));
      expect(bytesToHex(sha256(utf8ToBytes(payloadBase64)))).toBe(payload_sha256);

      // And confirm the real decrypt path recovers the exact plaintext.
      expect(decryptWithConversationKey(payloadBase64, key)).toBe(plaintext);
    }
  );
});

describe('NIP-44 v2 official vectors: decrypt (invalid)', () => {
  // These vectors supply a conversation_key directly rather than a
  // sec/pub keypair (deriving a keypair that produces a given
  // conversation key is infeasible - conversationKey() is a one-way
  // ECDH+HKDF). decryptWithConversationKey lets us exercise the real
  // wire-format validation (version byte, payload size, MAC, padding)
  // directly against these vectors without fabricating a keypair.
  it.each(v2.invalid.decrypt)('rejects: $note', ({ conversation_key, payload }) => {
    const key = hexToBytes(conversation_key);
    expect(() => decryptWithConversationKey(payload, key)).toThrow();
  });
});

describe('NIP-44 v2 official vectors: encrypt_msg_lengths (invalid)', () => {
  // Byte lengths that MUST be rejected by encryption: 0 (empty) and
  // anything over the 65535-byte max plaintext size.
  it.each(v2.invalid.encrypt_msg_lengths)('nip44Encrypt rejects a %i-byte plaintext', (byteLength) => {
    const plaintext = 'a'.repeat(byteLength);
    const senderPrivateKeyHex = '0000000000000000000000000000000000000000000000000000000000000001';
    const recipientPublicKeyHex = getPublicKey(
      '0000000000000000000000000000000000000000000000000000000000000002'
    );
    expect(() => nip44Encrypt(plaintext, senderPrivateKeyHex, recipientPublicKeyHex)).toThrow();
  });
});

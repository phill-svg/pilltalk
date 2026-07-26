// web/src/dm/giftWrap.ts
import { getPublicKey, signEvent, verifyEvent, type NostrEvent, type UnsignedEvent } from '../nostr/event';
import { nip44Encrypt, nip44Decrypt } from '../crypto/nip44';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

export const KIND_DM_RUMOR = 14;
export const KIND_SEAL = 13;
export const KIND_GIFT_WRAP = 1059;

export interface Rumor {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;

function randomPastTimestamp(now: number): number {
  return now - Math.floor(Math.random() * TWO_DAYS_SECONDS);
}

export function createGiftWrap(
  rumor: Rumor,
  senderPrivateKeyHex: string,
  recipientPublicKeyHex: string,
  now: number = Math.floor(Date.now() / 1000),
): NostrEvent {
  const senderPubkey = getPublicKey(senderPrivateKeyHex);
  const sealContent = nip44Encrypt(JSON.stringify(rumor), senderPrivateKeyHex, recipientPublicKeyHex);
  const unsignedSeal: UnsignedEvent = {
    pubkey: senderPubkey,
    created_at: randomPastTimestamp(now),
    kind: KIND_SEAL,
    tags: [],
    content: sealContent,
  };
  const seal = signEvent(unsignedSeal, senderPrivateKeyHex);

  const oneTimePrivateKey = bytesToHex(secp256k1.utils.randomPrivateKey());
  const wrapContent = nip44Encrypt(JSON.stringify(seal), oneTimePrivateKey, recipientPublicKeyHex);
  const unsignedWrap: UnsignedEvent = {
    pubkey: getPublicKey(oneTimePrivateKey),
    created_at: randomPastTimestamp(now),
    kind: KIND_GIFT_WRAP,
    tags: [['p', recipientPublicKeyHex]],
    content: wrapContent,
  };
  return signEvent(unsignedWrap, oneTimePrivateKey);
}

export function openGiftWrap(giftWrap: NostrEvent, receiverPrivateKeyHex: string): Rumor {
  if (!verifyEvent(giftWrap)) {
    throw new Error('Invalid gift wrap signature');
  }

  const sealJson = nip44Decrypt(giftWrap.content, receiverPrivateKeyHex, giftWrap.pubkey);
  const seal = JSON.parse(sealJson) as NostrEvent;

  if (!verifyEvent(seal)) {
    throw new Error('Invalid seal signature');
  }
  if (seal.kind !== KIND_SEAL) {
    throw new Error('Unexpected seal kind');
  }

  const rumorJson = nip44Decrypt(seal.content, receiverPrivateKeyHex, seal.pubkey);
  const rumor = JSON.parse(rumorJson) as Rumor;

  // The seal's pubkey is the cryptographically authenticated sender identity
  // (proven by verifyEvent(seal) succeeding). The rumor's own self-reported
  // pubkey field must never be trusted, as it can be forged to impersonate
  // a third party.
  return { ...rumor, pubkey: seal.pubkey };
}

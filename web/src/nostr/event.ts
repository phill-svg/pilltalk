import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type UnsignedEvent = Omit<NostrEvent, 'id' | 'sig'>;

export function serializeEvent(event: UnsignedEvent): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export function computeEventId(event: UnsignedEvent): string {
  return bytesToHex(sha256(utf8ToBytes(serializeEvent(event))));
}

export function signEvent(event: UnsignedEvent, privateKeyHex: string): NostrEvent {
  const id = computeEventId(event);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(privateKeyHex)));
  return { ...event, id, sig };
}

export function verifyEvent(event: NostrEvent): boolean {
  const { id, sig, ...unsigned } = event;
  if (computeEventId(unsigned) !== id) return false;
  return schnorr.verify(hexToBytes(sig), hexToBytes(id), hexToBytes(event.pubkey));
}

export function getPublicKey(privateKeyHex: string): string {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privateKeyHex)));
}

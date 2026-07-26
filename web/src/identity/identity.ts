import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey } from '../nostr/event';

const STORAGE_KEY = 'pilltalk.identity.privkey';

export interface Identity {
  privateKeyHex: string;
  publicKeyHex: string;
}

export interface IdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadOrCreateIdentity(storage: IdentityStorage): Identity {
  const existing = storage.getItem(STORAGE_KEY);
  const privateKeyHex = existing ?? bytesToHex(secp256k1.utils.randomPrivateKey());
  if (!existing) storage.setItem(STORAGE_KEY, privateKeyHex);
  return { privateKeyHex, publicKeyHex: getPublicKey(privateKeyHex) };
}

export function wipeIdentity(storage: IdentityStorage): void {
  storage.removeItem(STORAGE_KEY);
}

import { describe, it, expect } from 'vitest';
import { loadOrCreateIdentity, wipeIdentity, type IdentityStorage } from './identity';

function createFakeStorage(): IdentityStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

describe('identity manager', () => {
  it('creates a new identity with a valid hex keypair on first load', () => {
    const storage = createFakeStorage();
    const identity = loadOrCreateIdentity(storage);
    expect(identity.privateKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same identity across repeated loads', () => {
    const storage = createFakeStorage();
    const first = loadOrCreateIdentity(storage);
    const second = loadOrCreateIdentity(storage);
    expect(second.privateKeyHex).toBe(first.privateKeyHex);
  });

  it('creates a fresh, different identity after a wipe', () => {
    const storage = createFakeStorage();
    const before = loadOrCreateIdentity(storage);
    wipeIdentity(storage);
    const after = loadOrCreateIdentity(storage);
    expect(after.privateKeyHex).not.toBe(before.privateKeyHex);
  });
});

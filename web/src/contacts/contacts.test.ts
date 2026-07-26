// web/src/contacts/contacts.test.ts
import { describe, it, expect } from 'vitest';
import { loadContacts, upsertContact, removeContact, findContact } from './contacts';
import type { IdentityStorage } from '../identity/identity';

function createFakeStorage(): IdentityStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe('contacts', () => {
  it('starts empty with no stored contacts', () => {
    const storage = createFakeStorage();
    expect(loadContacts(storage)).toEqual([]);
  });

  it('adds a new contact and persists it across loads', () => {
    const storage = createFakeStorage();
    upsertContact(storage, 'a'.repeat(64), 'Alex');

    expect(loadContacts(storage)).toEqual([{ pubkey: 'a'.repeat(64), label: 'Alex' }]);
  });

  it('updates the label of an existing contact rather than duplicating it', () => {
    const storage = createFakeStorage();
    upsertContact(storage, 'a'.repeat(64), 'Alex');
    upsertContact(storage, 'a'.repeat(64), 'Alexandra');

    const contacts = loadContacts(storage);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toEqual({ pubkey: 'a'.repeat(64), label: 'Alexandra' });
  });

  it('falls back to a pubkey-derived label when given a blank name', () => {
    const storage = createFakeStorage();
    upsertContact(storage, 'a'.repeat(64), '   ');

    expect(loadContacts(storage)[0]?.label).toBe('a'.repeat(8));
  });

  it('removes a contact by pubkey', () => {
    const storage = createFakeStorage();
    upsertContact(storage, 'a'.repeat(64), 'Alex');
    upsertContact(storage, 'b'.repeat(64), 'Bao');
    removeContact(storage, 'a'.repeat(64));

    expect(loadContacts(storage)).toEqual([{ pubkey: 'b'.repeat(64), label: 'Bao' }]);
  });

  it('finds a contact by pubkey within a list', () => {
    const contacts = [
      { pubkey: 'a'.repeat(64), label: 'Alex' },
      { pubkey: 'b'.repeat(64), label: 'Bao' },
    ];

    expect(findContact(contacts, 'b'.repeat(64))?.label).toBe('Bao');
    expect(findContact(contacts, 'c'.repeat(64))).toBeUndefined();
  });

  it('ignores malformed stored JSON rather than throwing', () => {
    const storage = createFakeStorage();
    storage.setItem('pilltalk.contacts.v1', '{not valid json');

    expect(loadContacts(storage)).toEqual([]);
  });
});

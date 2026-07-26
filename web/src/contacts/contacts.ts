// web/src/contacts/contacts.ts
import type { IdentityStorage } from '../identity/identity';

const STORAGE_KEY = 'pilltalk.contacts.v1';

export interface Contact {
  pubkey: string;
  label: string;
}

function readAll(storage: IdentityStorage): Contact[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is Contact => typeof c === 'object' && c !== null && typeof (c as Contact).pubkey === 'string' && typeof (c as Contact).label === 'string',
    );
  } catch {
    return [];
  }
}

function writeAll(storage: IdentityStorage, contacts: Contact[]): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

export function loadContacts(storage: IdentityStorage): Contact[] {
  return readAll(storage);
}

export function upsertContact(storage: IdentityStorage, pubkey: string, label: string): Contact[] {
  const contacts = readAll(storage);
  const existing = contacts.findIndex((c) => c.pubkey === pubkey);
  const trimmedLabel = label.trim() || pubkey.slice(0, 8);
  if (existing >= 0) {
    contacts[existing] = { pubkey, label: trimmedLabel };
  } else {
    contacts.push({ pubkey, label: trimmedLabel });
  }
  writeAll(storage, contacts);
  return contacts;
}

export function removeContact(storage: IdentityStorage, pubkey: string): Contact[] {
  const contacts = readAll(storage).filter((c) => c.pubkey !== pubkey);
  writeAll(storage, contacts);
  return contacts;
}

export function findContact(contacts: Contact[], pubkey: string): Contact | undefined {
  return contacts.find((c) => c.pubkey === pubkey);
}

// web/src/identity/nickname.ts
//
// Persistent display nickname, matching the iOS/Android apps' settings
// (they let you set a name shown as "<name>" on your messages instead of
// an anonymous pubkey-derived tag). Local-only, like the rest of identity
// storage here -- never transmitted except as the "n" tag on outgoing
// geohash messages, exactly like the native apps.

const STORAGE_KEY = 'pilltalk.nickname.v1';
const MAX_LENGTH = 24;

export interface NicknameStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadNickname(storage: NicknameStorage): string | null {
  const value = storage.getItem(STORAGE_KEY);
  return value && value.trim() ? value.trim() : null;
}

export function saveNickname(storage: NicknameStorage, nickname: string): string | null {
  const trimmed = nickname.trim().slice(0, MAX_LENGTH);
  storage.setItem(STORAGE_KEY, trimmed);
  return trimmed || null;
}

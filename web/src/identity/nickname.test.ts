// web/src/identity/nickname.test.ts
import { describe, it, expect } from 'vitest';
import { loadNickname, saveNickname } from './nickname';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe('nickname storage', () => {
  it('returns null when nothing has been saved', () => {
    expect(loadNickname(createMemoryStorage())).toBeNull();
  });

  it('round-trips a saved nickname', () => {
    const storage = createMemoryStorage();
    saveNickname(storage, 'phill');
    expect(loadNickname(storage)).toBe('phill');
  });

  it('trims whitespace and truncates to the max length', () => {
    const storage = createMemoryStorage();
    saveNickname(storage, '  ' + 'a'.repeat(40) + '  ');
    expect(loadNickname(storage)).toBe('a'.repeat(24));
  });

  it('treats an empty/whitespace-only nickname as cleared', () => {
    const storage = createMemoryStorage();
    saveNickname(storage, 'phill');
    saveNickname(storage, '   ');
    expect(loadNickname(storage)).toBeNull();
  });
});

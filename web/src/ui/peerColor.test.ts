// web/src/ui/peerColor.test.ts
import { describe, it, expect } from 'vitest';
import { colorForSender } from './peerColor';

describe('colorForSender', () => {
  it('always returns the fixed self color regardless of seed', () => {
    expect(colorForSender('anything', true)).toBe('#ff9500');
    expect(colorForSender('someone-else', true)).toBe('#ff9500');
  });

  it('is deterministic for the same seed', () => {
    const a = colorForSender('a1b2c3d4', false);
    const b = colorForSender('a1b2c3d4', false);
    expect(a).toBe(b);
  });

  it('produces different colors for different seeds (usually)', () => {
    const a = colorForSender('alice-pubkey', false);
    const b = colorForSender('bob-pubkey', false);
    expect(a).not.toBe(b);
  });

  it('never returns the self color for a non-self sender', () => {
    for (const seed of ['a', 'b', 'c', 'foo', 'bar', 'baz', 'anon12345678']) {
      expect(colorForSender(seed, false)).not.toBe('#ff9500');
    }
  });
});

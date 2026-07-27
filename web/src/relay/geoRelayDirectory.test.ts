// web/src/relay/geoRelayDirectory.test.ts
import { describe, it, expect } from 'vitest';
import { closestRelays } from './geoRelayDirectory';

describe('closestRelays', () => {
  it('returns wss:// URLs', () => {
    const relays = closestRelays(51.5074, -0.1278, 5);
    expect(relays.length).toBeGreaterThan(0);
    for (const url of relays) expect(url.startsWith('wss://')).toBe(true);
  });

  it('respects the requested count', () => {
    expect(closestRelays(0, 0, 3)).toHaveLength(3);
    expect(closestRelays(0, 0, 1)).toHaveLength(1);
  });

  it('is deterministic for the same coordinates', () => {
    const a = closestRelays(-35.28, 149.13, 5);
    const b = closestRelays(-35.28, 149.13, 5);
    expect(a).toEqual(b);
  });

  it('returns different relay sets for geographically distant coordinates', () => {
    const sydney = closestRelays(-33.8688, 151.2093, 5);
    const london = closestRelays(51.5074, -0.1278, 5);
    expect(sydney).not.toEqual(london);
  });

  it('returns an empty array when count is zero or negative', () => {
    expect(closestRelays(0, 0, 0)).toEqual([]);
    expect(closestRelays(0, 0, -1)).toEqual([]);
  });
});

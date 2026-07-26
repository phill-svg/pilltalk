import { describe, it, expect } from 'vitest';
import { geohashEncode, broadcastsPresence, deriveGeohashKey, GEOHASH_PRECISION } from './geohash';

describe('geohash utilities', () => {
  it('encodes a known lat/lon into the expected geohash prefix', () => {
    // Wikipedia's canonical Geohash worked example.
    expect(geohashEncode(57.64911, 10.40744, 5)).toBe('u4pru');
  });

  it('produces longer, more precise geohashes as precision increases', () => {
    const short = geohashEncode(57.64911, 10.40744, 5);
    const long = geohashEncode(57.64911, 10.40744, 7);
    expect(long.startsWith(short)).toBe(true);
    expect(long).toHaveLength(7);
  });

  it('only broadcasts presence at region/province/city precision, not neighborhood/block', () => {
    expect(broadcastsPresence(GEOHASH_PRECISION.region)).toBe(true);
    expect(broadcastsPresence(GEOHASH_PRECISION.city)).toBe(true);
    expect(broadcastsPresence(GEOHASH_PRECISION.neighborhood)).toBe(false);
    expect(broadcastsPresence(GEOHASH_PRECISION.block)).toBe(false);
  });

  it('derives a deterministic, valid, per-geohash private key from a master key', () => {
    const master = 'a'.repeat(64);
    const key1 = deriveGeohashKey(master, 'u4pru');
    const key2 = deriveGeohashKey(master, 'u4pru');
    const key3 = deriveGeohashKey(master, 'u4prv');
    expect(key1).toMatch(/^[0-9a-f]{64}$/);
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });
});

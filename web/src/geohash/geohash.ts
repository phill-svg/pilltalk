import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohashEncode(latitude: number, longitude: number, precision: number): string {
  const latRange: [number, number] = [-90, 90];
  const lonRange: [number, number] = [-180, 180];
  let isEven = true;
  let bit = 0;
  let ch = 0;
  let geohash = '';

  while (geohash.length < precision) {
    if (isEven) {
      const mid = (lonRange[0] + lonRange[1]) / 2;
      if (longitude >= mid) {
        ch |= 1 << (4 - bit);
        lonRange[0] = mid;
      } else {
        lonRange[1] = mid;
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (latitude >= mid) {
        ch |= 1 << (4 - bit);
        latRange[0] = mid;
      } else {
        latRange[1] = mid;
      }
    }
    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return geohash;
}

export function geohashDecodeCenter(geohash: string): { lat: number; lon: number } {
  const latRange: [number, number] = [-90, 90];
  const lonRange: [number, number] = [-180, 180];
  let isEven = true;

  for (const char of geohash.toLowerCase()) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) continue;
    for (let bit = 4; bit >= 0; bit--) {
      const bitValue = (idx >> bit) & 1;
      if (isEven) {
        const mid = (lonRange[0] + lonRange[1]) / 2;
        if (bitValue === 1) lonRange[0] = mid;
        else lonRange[1] = mid;
      } else {
        const mid = (latRange[0] + latRange[1]) / 2;
        if (bitValue === 1) latRange[0] = mid;
        else latRange[1] = mid;
      }
      isEven = !isEven;
    }
  }

  return { lat: (latRange[0] + latRange[1]) / 2, lon: (lonRange[0] + lonRange[1]) / 2 };
}

export const GEOHASH_PRECISION = {
  region: 2,
  province: 4,
  city: 5,
  neighborhood: 6,
  block: 7,
} as const;

export function broadcastsPresence(precision: number): boolean {
  return precision <= GEOHASH_PRECISION.city;
}

export function deriveGeohashKey(masterPrivateKeyHex: string, geohash: string): string {
  let counter = 0;
  while (true) {
    const material = hmac(
      sha256,
      hexToBytes(masterPrivateKeyHex),
      utf8ToBytes(`pilltalk-geohash:${geohash}:${counter}`),
    );
    if (secp256k1.utils.isValidPrivateKey(material)) return bytesToHex(material);
    counter++;
  }
}

// web/src/relay/geoRelayDirectory.ts
//
// Ports the iOS/Android apps' geo-relay selection (pilltalk/Nostr/GeoRelayDirectory.swift)
// so the web app subscribes to and publishes geohash chat/presence on the
// SAME relays the native apps pick for a given location, instead of a fixed
// global relay list. Without this, a web user outside North America/Europe
// and a native-app user in the same geohash room can both be "connected"
// and still never see each other's messages, because the native apps choose
// relays by geographic proximity (closest 5, from a large public relay
// directory) while the web app always used a small fixed set -- for most of
// the world those two sets simply don't overlap.
//
// geoRelayDirectory.json is a bundled snapshot of
// pilltalk/relays/online_relays_gps.csv (host, lat, lon), the same directory
// the native apps ship and periodically auto-refresh via a scheduled
// GitHub Action.

import directory from './geoRelayDirectory.json';

interface RelayDirectoryEntry {
  host: string;
  lat: number;
  lon: number;
}

const ENTRIES = directory as RelayDirectoryEntry[];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns up to `count` relay URLs (wss://) closest to the given coordinate.
 * Ties break by host so every client with the same directory snapshot picks
 * the same relay set -- publishers and subscribers must agree on relays.
 */
export function closestRelays(lat: number, lon: number, count = 5): string[] {
  if (ENTRIES.length === 0 || count <= 0) return [];

  return ENTRIES.map((entry) => ({ entry, distance: haversineKm(lat, lon, entry.lat, entry.lon) }))
    .sort((a, b) => a.distance - b.distance || a.entry.host.localeCompare(b.entry.host))
    .slice(0, count)
    .map(({ entry }) => `wss://${entry.host}`);
}

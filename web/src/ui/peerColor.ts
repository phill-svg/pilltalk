// web/src/ui/peerColor.ts
//
// Per-sender color coding matching the iOS/Android apps' IRC-style naming
// (pilltalk/Utils/Color+Peer.swift): a djb2 hash of the sender's
// pubkey/nickname picks a hue, avoiding the hue reserved for "you" (orange),
// with pseudo-random saturation/lightness derived from other hash bits so
// different senders land on visually distinct, readable colors.

const SELF_COLOR = '#ff9500'; // matches iOS's Color.orange for the local user's own messages
const ORANGE_HUE = 30 / 360;
const HUE_AVOIDANCE_DELTA = 0.05;
const HUE_AVOIDANCE_OFFSET = 0.12;

function djb2(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function colorForSender(seed: string, isSelf: boolean): string {
  if (isSelf) return SELF_COLOR;

  const h = djb2(seed.toLowerCase());
  let hue = (h % 1000) / 1000;
  if (Math.abs(hue - ORANGE_HUE) < HUE_AVOIDANCE_DELTA) {
    hue = (hue + HUE_AVOIDANCE_OFFSET) % 1;
  }
  const sRand = ((h >>> 17) & 0x3ff) / 1023;
  const lRand = ((h >>> 27) & 0x1f) / 31;
  const saturation = Math.min(1, Math.max(0.5, 0.7 + (sRand - 0.5) * 0.2));
  const lightness = Math.min(0.62, Math.max(0.34, 0.42 + (lRand - 0.5) * 0.14));

  return `hsl(${Math.round(hue * 360)}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%)`;
}

import type { RelayPoolLike } from '../relay/relayPool';
import type { NostrEvent, UnsignedEvent } from '../nostr/event';
import { getPublicKey, signEvent } from '../nostr/event';
import { broadcastsPresence, deriveGeohashKey } from '../geohash/geohash';

export const KIND_GEOHASH_CHAT = 20000;
export const KIND_GEOHASH_PRESENCE = 20001;

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const PRESENCE_MIN_MS = 40_000;
const PRESENCE_MAX_MS = 80_000;

export interface GeohashMessage {
  pubkey: string;
  nickname: string;
  content: string;
  createdAt: number;
}

export interface ParticipantCount {
  count: number;
  exact: boolean;
}

export class GeohashChannel {
  private ephemeralPrivateKey: string;
  private ephemeralPublicKey: string;
  private lastSeen = new Map<string, number>();
  private unsubscribe: (() => void) | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private pool: RelayPoolLike,
    masterPrivateKeyHex: string,
    private geohash: string,
    private onMessage: (message: GeohashMessage) => void,
    private now: () => number = () => Date.now(),
  ) {
    this.ephemeralPrivateKey = deriveGeohashKey(masterPrivateKeyHex, geohash);
    this.ephemeralPublicKey = getPublicKey(this.ephemeralPrivateKey);
  }

  join(): void {
    this.unsubscribe = this.pool.subscribe(
      { kinds: [KIND_GEOHASH_CHAT, KIND_GEOHASH_PRESENCE], '#g': [this.geohash] },
      (event) => this.handleEvent(event),
    );
    if (broadcastsPresence(this.geohash.length)) this.schedulePresence();
  }

  leave(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
  }

  private handleEvent(event: NostrEvent): void {
    if (event.pubkey === this.ephemeralPublicKey) return;
    this.lastSeen.set(event.pubkey, event.created_at * 1000);
    if (event.kind === KIND_GEOHASH_CHAT) {
      const nickname = event.tags.find((t) => t[0] === 'n')?.[1] ?? 'anon';
      this.onMessage({ pubkey: event.pubkey, nickname, content: event.content, createdAt: event.created_at });
    }
  }

  sendMessage(content: string, nickname: string): void {
    const unsigned: UnsignedEvent = {
      pubkey: this.ephemeralPublicKey,
      created_at: Math.floor(this.now() / 1000),
      kind: KIND_GEOHASH_CHAT,
      tags: [
        ['g', this.geohash],
        ['n', nickname],
      ],
      content,
    };
    this.pool.publish(signEvent(unsigned, this.ephemeralPrivateKey));
  }

  private sendPresence(): void {
    const unsigned: UnsignedEvent = {
      pubkey: this.ephemeralPublicKey,
      created_at: Math.floor(this.now() / 1000),
      kind: KIND_GEOHASH_PRESENCE,
      tags: [['g', this.geohash]],
      content: '',
    };
    this.pool.publish(signEvent(unsigned, this.ephemeralPrivateKey));
  }

  private schedulePresence(): void {
    this.sendPresence();
    const delay = PRESENCE_MIN_MS + Math.random() * (PRESENCE_MAX_MS - PRESENCE_MIN_MS);
    this.presenceTimer = setTimeout(() => this.schedulePresence(), delay);
  }

  getParticipantCount(): ParticipantCount {
    const cutoff = this.now() - ONLINE_WINDOW_MS;
    let count = 0;
    for (const lastSeen of this.lastSeen.values()) if (lastSeen >= cutoff) count++;
    return { count, exact: broadcastsPresence(this.geohash.length) };
  }
}

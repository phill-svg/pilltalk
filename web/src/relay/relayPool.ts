import type { NostrEvent } from '../nostr/event';

export interface RelayFilter {
  kinds?: number[];
  '#g'?: string[];
  '#p'?: string[];
  since?: number;
}

export interface RelayPoolLike {
  subscribe(filter: RelayFilter, onEvent: (event: NostrEvent) => void): () => void;
  publish(event: NostrEvent): void;
}

export interface MinimalWebSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
}

export type WebSocketFactory = (url: string) => MinimalWebSocket;

interface Subscription {
  id: string;
  filter: RelayFilter;
  onEvent: (event: NostrEvent) => void;
}

const OPEN = 1;
const MAX_SEEN_IDS = 5000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isValidNostrEvent(event: unknown): event is NostrEvent {
  if (!event || typeof event !== 'object') return false;
  const e = event as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.pubkey === 'string' &&
    typeof e.created_at === 'number' &&
    typeof e.kind === 'number' &&
    Array.isArray(e.tags) &&
    e.tags.every(isStringArray) &&
    typeof e.content === 'string' &&
    typeof e.sig === 'string'
  );
}

export class RelayPool implements RelayPoolLike {
  private sockets = new Map<string, MinimalWebSocket>();
  private reconnectAttempts = new Map<string, number>();
  private subscriptions = new Map<string, Subscription>();
  private seenEventIds = new Set<string>();
  private nextSubId = 0;

  constructor(urls: string[], private wsFactory: WebSocketFactory) {
    for (const url of urls) this.connect(url);
  }

  private connect(url: string): void {
    const ws = this.wsFactory(url);
    ws.onopen = () => {
      this.reconnectAttempts.set(url, 0);
      for (const sub of this.subscriptions.values()) this.sendSubscribe(ws, sub);
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = () => this.scheduleReconnect(url);
    ws.onerror = () => this.scheduleReconnect(url);
    this.sockets.set(url, ws);
  }

  private scheduleReconnect(url: string): void {
    const attempt = this.reconnectAttempts.get(url) ?? 0;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    this.reconnectAttempts.set(url, attempt + 1);
    setTimeout(() => this.connect(url), delay);
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(parsed) || parsed[0] !== 'EVENT') return;
    const [, subId, event] = parsed as [string, string, unknown];
    if (!isValidNostrEvent(event)) {
      console.error('RelayPool: dropping malformed event', event);
      return;
    }
    if (this.seenEventIds.has(event.id)) return;
    this.seenEventIds.add(event.id);
    if (this.seenEventIds.size > MAX_SEEN_IDS) {
      const oldest = this.seenEventIds.values().next().value;
      if (oldest !== undefined) this.seenEventIds.delete(oldest);
    }
    const sub = this.subscriptions.get(subId);
    if (!sub) return;
    try {
      sub.onEvent(event);
    } catch (err) {
      console.error('RelayPool: subscriber onEvent threw', err);
    }
  }

  private sendSubscribe(ws: MinimalWebSocket, sub: Subscription): void {
    if (ws.readyState === OPEN) ws.send(JSON.stringify(['REQ', sub.id, sub.filter]));
  }

  subscribe(filter: RelayFilter, onEvent: (event: NostrEvent) => void): () => void {
    const id = `sub-${this.nextSubId++}`;
    const sub: Subscription = { id, filter, onEvent };
    this.subscriptions.set(id, sub);
    for (const ws of this.sockets.values()) this.sendSubscribe(ws, sub);
    return () => {
      this.subscriptions.delete(id);
      for (const ws of this.sockets.values()) {
        if (ws.readyState === OPEN) ws.send(JSON.stringify(['CLOSE', id]));
      }
    };
  }

  publish(event: NostrEvent): void {
    const message = JSON.stringify(['EVENT', event]);
    for (const ws of this.sockets.values()) {
      if (ws.readyState === OPEN) ws.send(message);
    }
  }

  connectedCount(): number {
    let count = 0;
    for (const ws of this.sockets.values()) if (ws.readyState === OPEN) count++;
    return count;
  }

  totalCount(): number {
    return this.sockets.size;
  }
}

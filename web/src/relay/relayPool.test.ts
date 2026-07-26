import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RelayPool, type MinimalWebSocket, type WebSocketFactory } from './relayPool';
import type { NostrEvent } from '../nostr/event';

class FakeWebSocket implements MinimalWebSocket {
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  receive(data: string): void {
    this.onmessage?.({ data });
  }
}

function fakeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1700000000,
    kind: 1,
    tags: [],
    content: 'hi',
    sig: 'c'.repeat(128),
    ...overrides,
  };
}

describe('RelayPool', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a REQ subscribe message once the socket opens', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://relay.example'], factory);
    pool.subscribe({ kinds: [1] }, () => {});
    sockets[0]!.open();

    expect(sockets[0]!.sent).toHaveLength(1);
    const [type, , filter] = JSON.parse(sockets[0]!.sent[0]!);
    expect(type).toBe('REQ');
    expect(filter).toEqual({ kinds: [1] });
  });

  it('delivers a matching EVENT message to the subscriber', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://relay.example'], factory);
    const onEvent = vi.fn();
    pool.subscribe({ kinds: [1] }, onEvent);
    sockets[0]!.open();
    const [, subId] = JSON.parse(sockets[0]!.sent[0]!);
    const event = fakeEvent();
    sockets[0]!.receive(JSON.stringify(['EVENT', subId, event]));

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it('deduplicates the same event id received from two relays', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://a.example', 'wss://b.example'], factory);
    const onEvent = vi.fn();
    pool.subscribe({ kinds: [1] }, onEvent);
    sockets[0]!.open();
    sockets[1]!.open();
    const event = fakeEvent();
    const [, subIdA] = JSON.parse(sockets[0]!.sent[0]!);
    const [, subIdB] = JSON.parse(sockets[1]!.sent[0]!);
    sockets[0]!.receive(JSON.stringify(['EVENT', subIdA, event]));
    sockets[1]!.receive(JSON.stringify(['EVENT', subIdB, event]));

    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('reconnects with exponential backoff after a socket closes', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    new RelayPool(['wss://relay.example'], factory);
    sockets[0]!.open();
    sockets[0]!.close();

    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
  });

  it('reports connected and total relay counts', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://a.example', 'wss://b.example'], factory);
    sockets[0]!.open();

    expect(pool.totalCount()).toBe(2);
    expect(pool.connectedCount()).toBe(1);
  });
});

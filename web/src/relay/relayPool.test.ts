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

  it('drops a structurally malformed event without calling onEvent or throwing', () => {
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
    const malformed = { ...fakeEvent(), tags: null };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      sockets[0]!.receive(JSON.stringify(['EVENT', subId, malformed]));
    }).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('drops an event missing the kind field without calling onEvent or throwing', () => {
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
    const { kind: _kind, ...missingKind } = fakeEvent();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      sockets[0]!.receive(JSON.stringify(['EVENT', subId, missingKind]));
    }).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not let a throwing subscriber break message handling', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://relay.example'], factory);
    const onEvent = vi.fn(() => {
      throw new Error('subscriber boom');
    });
    pool.subscribe({ kinds: [1] }, onEvent);
    sockets[0]!.open();
    const [, subId] = JSON.parse(sockets[0]!.sent[0]!);
    const event = fakeEvent();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      sockets[0]!.receive(JSON.stringify(['EVENT', subId, event]));
    }).not.toThrow();

    expect(onEvent).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('doubles the reconnect delay on consecutive failures before the next reconnect', () => {
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
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);

    // Second consecutive failure (socket never opens) should double the delay to 2000ms.
    sockets[1]!.close();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it('caps the reconnect delay at 30000ms after many consecutive failures', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    new RelayPool(['wss://relay.example'], factory);

    let expectedDelay = 1000;
    for (let i = 0; i < 8; i++) {
      const countBefore = sockets.length;
      sockets[sockets.length - 1]!.close();
      vi.advanceTimersByTime(expectedDelay - 1);
      expect(sockets).toHaveLength(countBefore);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(countBefore + 1);
      expectedDelay = Math.min(expectedDelay * 2, 30000);
    }
    expect(expectedDelay).toBe(30000);
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

  it('publishes an event queued before any socket opened once one connects', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://relay.example'], factory);
    const event = fakeEvent();
    pool.publish(event);

    expect(sockets[0]!.sent).toHaveLength(0);
    expect(pool.pendingPublishCount()).toBe(1);

    sockets[0]!.open();

    expect(sockets[0]!.sent.map((raw) => JSON.parse(raw))).toEqual([['EVENT', event]]);
    expect(pool.pendingPublishCount()).toBe(0);
  });

  it('sends a queued event to every relay exactly once as each one connects', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://a.example', 'wss://b.example'], factory);
    const event = fakeEvent();
    pool.publish(event);
    sockets[0]!.open();
    sockets[1]!.open();

    expect(sockets[0]!.sent.filter((raw) => JSON.parse(raw)[0] === 'EVENT')).toHaveLength(1);
    expect(sockets[1]!.sent.filter((raw) => JSON.parse(raw)[0] === 'EVENT')).toHaveLength(1);
    expect(pool.pendingPublishCount()).toBe(0);
  });

  it('does not re-send to a relay that already received the event when a second one connects', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    const pool = new RelayPool(['wss://a.example', 'wss://b.example'], factory);
    sockets[0]!.open();
    pool.publish(fakeEvent());
    sockets[1]!.open();

    expect(sockets[0]!.sent.filter((raw) => JSON.parse(raw)[0] === 'EVENT')).toHaveLength(1);
    expect(sockets[1]!.sent.filter((raw) => JSON.parse(raw)[0] === 'EVENT')).toHaveLength(1);
  });

  it('drops a queued event that has waited longer than the pending TTL', () => {
    const sockets: FakeWebSocket[] = [];
    const factory: WebSocketFactory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    let now = 1_000_000;
    const pool = new RelayPool(['wss://relay.example'], factory, () => now);
    pool.publish(fakeEvent());
    now += 60_001;
    sockets[0]!.open();

    expect(sockets[0]!.sent.filter((raw) => JSON.parse(raw)[0] === 'EVENT')).toHaveLength(0);
    expect(pool.pendingPublishCount()).toBe(0);
  });

  it('bounds the pending publish queue', () => {
    const factory: WebSocketFactory = () => new FakeWebSocket();
    const pool = new RelayPool(['wss://relay.example'], factory);
    for (let i = 0; i < 60; i++) pool.publish(fakeEvent({ id: String(i).padStart(64, '0') }));

    expect(pool.pendingPublishCount()).toBe(50);
  });

  it('clears queued publishes on disconnect', () => {
    const factory: WebSocketFactory = () => new FakeWebSocket();
    const pool = new RelayPool(['wss://relay.example'], factory);
    pool.publish(fakeEvent());
    pool.disconnect();

    expect(pool.pendingPublishCount()).toBe(0);
  });
});

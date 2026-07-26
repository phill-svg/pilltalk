import { describe, it, expect, vi } from 'vitest';
import { createInMemoryRelayPool } from './inMemoryRelayPool';
import type { NostrEvent } from '../nostr/event';

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

describe('createInMemoryRelayPool', () => {
  it('delivers a published event only to subscribers whose kind filter matches', () => {
    const pool = createInMemoryRelayPool();
    const onKind1 = vi.fn();
    const onKind2 = vi.fn();
    pool.subscribe({ kinds: [1] }, onKind1);
    pool.subscribe({ kinds: [2] }, onKind2);
    pool.publish(fakeEvent({ kind: 1 }));

    expect(onKind1).toHaveBeenCalledTimes(1);
    expect(onKind2).not.toHaveBeenCalled();
  });

  it('matches on #g and #p tag filters', () => {
    const pool = createInMemoryRelayPool();
    const onGeohash = vi.fn();
    pool.subscribe({ '#g': ['u4pru'] }, onGeohash);
    pool.publish(fakeEvent({ tags: [['g', 'u4pru']] }));
    pool.publish(fakeEvent({ tags: [['g', 'other']] }));

    expect(onGeohash).toHaveBeenCalledTimes(1);
  });

  it('only delivers events at or after the since timestamp', () => {
    const pool = createInMemoryRelayPool();
    const onEvent = vi.fn();
    pool.subscribe({ since: 1700000000 }, onEvent);
    pool.publish(fakeEvent({ created_at: 1699999999 }));
    pool.publish(fakeEvent({ created_at: 1700000000 }));
    pool.publish(fakeEvent({ created_at: 1700000001 }));

    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('stops delivering events after unsubscribe', () => {
    const pool = createInMemoryRelayPool();
    const onEvent = vi.fn();
    const unsubscribe = pool.subscribe({}, onEvent);
    unsubscribe();
    pool.publish(fakeEvent());

    expect(onEvent).not.toHaveBeenCalled();
  });
});

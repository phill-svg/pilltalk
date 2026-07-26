import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeohashChannel, KIND_GEOHASH_CHAT, KIND_GEOHASH_PRESENCE } from './geohashChannel';
import { createInMemoryRelayPool } from '../testutil/inMemoryRelayPool';

const MASTER_KEY = 'a'.repeat(64);

describe('GeohashChannel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes a signed kind-20000 chat event tagged with the geohash and nickname', () => {
    const pool = createInMemoryRelayPool();
    const received: unknown[] = [];
    pool.subscribe({ kinds: [KIND_GEOHASH_CHAT] }, (e) => received.push(e));
    const channel = new GeohashChannel(pool, MASTER_KEY, 'u4pru', () => {});
    channel.join();
    channel.sendMessage('hello room', 'phill');

    expect(received).toHaveLength(1);
    const event = received[0] as { tags: string[][]; content: string };
    expect(event.content).toBe('hello room');
    expect(event.tags).toContainEqual(['g', 'u4pru']);
    expect(event.tags).toContainEqual(['n', 'phill']);
  });

  it('delivers incoming chat events to the onMessage callback', () => {
    const pool = createInMemoryRelayPool();
    const onMessage = vi.fn();
    const channel = new GeohashChannel(pool, MASTER_KEY, 'u4pru', onMessage);
    channel.join();
    const sender = new GeohashChannel(pool, 'b'.repeat(64), 'u4pru', () => {});
    sender.sendMessage('hi there', 'alex');

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0]![0]).toMatchObject({ nickname: 'alex', content: 'hi there' });
  });

  it('delivers a channel own sent message back to its own onMessage callback', () => {
    const pool = createInMemoryRelayPool();
    const onMessage = vi.fn();
    const channel = new GeohashChannel(pool, MASTER_KEY, 'u4pru', onMessage);
    channel.join();
    channel.sendMessage('my own message', 'phill');

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0]![0]).toMatchObject({ nickname: 'phill', content: 'my own message' });
  });

  it('broadcasts presence heartbeats for a city-precision geohash but not a block-precision one', () => {
    const pool = createInMemoryRelayPool();
    const presenceEvents: unknown[] = [];
    pool.subscribe({ kinds: [KIND_GEOHASH_PRESENCE] }, (e) => presenceEvents.push(e));

    const cityChannel = new GeohashChannel(pool, MASTER_KEY, 'u4pru', () => {}); // length 5 = city
    cityChannel.join();
    expect(presenceEvents).toHaveLength(1); // immediate heartbeat on join

    const blockChannel = new GeohashChannel(pool, MASTER_KEY, 'u4pru12', () => {}); // length 7 = block
    blockChannel.join();
    expect(presenceEvents).toHaveLength(1); // unchanged
  });

  it('counts a participant as online only within the 5-minute window', () => {
    let now = 1_700_000_000_000;
    const pool = createInMemoryRelayPool();
    const listener = new GeohashChannel(pool, MASTER_KEY, 'u4pru', () => {}, () => now);
    listener.join();
    const sender = new GeohashChannel(pool, 'b'.repeat(64), 'u4pru', () => {}, () => now);
    sender.sendMessage('hi', 'alex');

    expect(listener.getParticipantCount()).toEqual({ count: 1, exact: true });
    now += 6 * 60 * 1000;
    expect(listener.getParticipantCount()).toEqual({ count: 0, exact: true });
  });
});

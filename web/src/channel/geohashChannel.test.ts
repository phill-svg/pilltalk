import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeohashChannel, KIND_GEOHASH_CHAT, KIND_GEOHASH_PRESENCE } from './geohashChannel';
import { createInMemoryRelayPool } from '../testutil/inMemoryRelayPool';
import { signEvent, getPublicKey, type UnsignedEvent } from '../nostr/event';
import { deriveGeohashKey } from '../geohash/geohash';

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

  it('silently drops an incoming chat event with a tampered/invalid signature', () => {
    const pool = createInMemoryRelayPool();
    const onMessage = vi.fn();
    const channel = new GeohashChannel(pool, MASTER_KEY, 'u4pru', onMessage);
    channel.join();

    // Build a validly-shaped, validly-tagged event for this geohash, signed by
    // a forger's own ephemeral key, then flip a character of its signature so
    // it fails verifyEvent - it should never reach onMessage or count towards
    // presence, even though its geohash tag and shape are perfectly valid.
    const forgerPrivateKey = deriveGeohashKey('f'.repeat(64), 'u4pru');
    const forgerPublicKey = getPublicKey(forgerPrivateKey);
    const unsigned: UnsignedEvent = {
      pubkey: forgerPublicKey,
      created_at: Math.floor(Date.now() / 1000),
      kind: KIND_GEOHASH_CHAT,
      tags: [
        ['g', 'u4pru'],
        ['n', 'forger'],
      ],
      content: 'forged message',
    };
    const properlySigned = signEvent(unsigned, forgerPrivateKey);
    const flippedChar = properlySigned.sig[0] === '0' ? '1' : '0';
    const tamperedEvent = { ...properlySigned, sig: flippedChar + properlySigned.sig.slice(1) };

    expect(() => pool.publish(tamperedEvent)).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
    expect(channel.getParticipantCount()).toEqual({ count: 0, exact: true });
  });
});

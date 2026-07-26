import type { NostrEvent } from '../nostr/event';
import type { RelayFilter, RelayPoolLike } from '../relay/relayPool';

function matchesFilter(filter: RelayFilter, event: NostrEvent): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter['#g']) {
    const geohashes = event.tags.filter((t) => t[0] === 'g').map((t) => t[1]);
    if (!filter['#g'].some((g) => geohashes.includes(g))) return false;
  }
  if (filter['#p']) {
    const recipients = event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    if (!filter['#p'].some((p) => recipients.includes(p))) return false;
  }
  return true;
}

export function createInMemoryRelayPool(): RelayPoolLike {
  const subscriptions = new Map<number, { filter: RelayFilter; onEvent: (event: NostrEvent) => void }>();
  let nextId = 0;

  return {
    subscribe(filter, onEvent) {
      const id = nextId++;
      subscriptions.set(id, { filter, onEvent });
      return () => {
        subscriptions.delete(id);
      };
    },
    publish(event) {
      for (const sub of subscriptions.values()) {
        if (matchesFilter(sub.filter, event)) sub.onEvent(event);
      }
    },
  };
}

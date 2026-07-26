// web/src/dm/dmManager.ts
import type { RelayPoolLike } from '../relay/relayPool';
import type { NostrEvent } from '../nostr/event';
import { createGiftWrap, openGiftWrap, KIND_GIFT_WRAP, KIND_DM_RUMOR, type Rumor } from './giftWrap';

export interface ChatMessage {
  fromPubkey: string;
  content: string;
  createdAt: number;
}

export type DmTransport = 'relay' | 'direct';

export class DmManager {
  private unsubscribe: (() => void) | null = null;

  constructor(
    protected pool: RelayPoolLike,
    protected identityPrivateKeyHex: string,
    protected identityPublicKeyHex: string,
    protected onMessage: (peerPubkey: string, message: ChatMessage) => void,
  ) {}

  start(): void {
    this.unsubscribe = this.pool.subscribe(
      { kinds: [KIND_GIFT_WRAP], '#p': [this.identityPublicKeyHex] },
      (event) => this.handleGiftWrap(event),
    );
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private handleGiftWrap(event: NostrEvent): void {
    let rumor: Rumor;
    try {
      rumor = openGiftWrap(event, this.identityPrivateKeyHex);
    } catch {
      return;
    }
    if (rumor.kind !== KIND_DM_RUMOR) return;
    this.onMessage(rumor.pubkey, { fromPubkey: rumor.pubkey, content: rumor.content, createdAt: rumor.created_at });
  }

  sendMessage(recipientPubkey: string, content: string): void {
    this.sendRumor(recipientPubkey, content, []);
  }

  protected sendRumor(recipientPubkey: string, content: string, extraTags: string[][]): void {
    const rumor: Rumor = {
      pubkey: this.identityPublicKeyHex,
      created_at: Math.floor(Date.now() / 1000),
      kind: KIND_DM_RUMOR,
      tags: [['p', recipientPubkey], ...extraTags],
      content,
    };
    const wrap = createGiftWrap(rumor, this.identityPrivateKeyHex, recipientPubkey);
    this.pool.publish(wrap);
  }

  getTransport(_peerPubkey: string): DmTransport {
    return 'relay';
  }
}

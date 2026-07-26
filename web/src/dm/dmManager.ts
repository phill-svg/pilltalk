// web/src/dm/dmManager.ts
import type { RelayPoolLike } from '../relay/relayPool';
import type { NostrEvent } from '../nostr/event';
import { createGiftWrap, openGiftWrap, KIND_GIFT_WRAP, KIND_DM_RUMOR, type Rumor } from './giftWrap';
import { WebRtcSignaling, type PeerConnectionFactory, type DataChannelLike, type SignalPayload } from '../webrtc/signaling';

export interface ChatMessage {
  fromPubkey: string;
  content: string;
  createdAt: number;
}

export type DmTransport = 'relay' | 'direct';

const WEBRTC_SIGNAL_TAG = 'webrtc-signal';

export class DmManager {
  private unsubscribe: (() => void) | null = null;
  private signaling: WebRtcSignaling;
  private directChannels = new Map<string, DataChannelLike>();
  private attemptedDirectConnect = new Set<string>();

  constructor(
    private pool: RelayPoolLike,
    private identityPrivateKeyHex: string,
    private identityPublicKeyHex: string,
    private onMessage: (peerPubkey: string, message: ChatMessage) => void,
    createPeerConnection: PeerConnectionFactory,
  ) {
    this.signaling = new WebRtcSignaling(
      createPeerConnection,
      (peerPubkey, payload) => this.sendRumor(peerPubkey, JSON.stringify(payload), [['t', WEBRTC_SIGNAL_TAG]]),
      (peerPubkey, channel) => this.onDirectChannelOpen(peerPubkey, channel),
    );
  }

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

  private onDirectChannelOpen(peerPubkey: string, channel: DataChannelLike): void {
    this.directChannels.set(peerPubkey, channel);
    channel.onmessage = (ev) => {
      const parsed = JSON.parse(ev.data) as { content: string; createdAt: number };
      this.onMessage(peerPubkey, { fromPubkey: peerPubkey, content: parsed.content, createdAt: parsed.createdAt });
    };
    channel.onclose = () => this.directChannels.delete(peerPubkey);
  }

  private handleGiftWrap(event: NostrEvent): void {
    let rumor: Rumor;
    try {
      rumor = openGiftWrap(event, this.identityPrivateKeyHex);
    } catch {
      return;
    }
    const isSignal = rumor.tags.some((t) => t[0] === 't' && t[1] === WEBRTC_SIGNAL_TAG);
    if (isSignal) {
      void this.signaling.handleSignal(rumor.pubkey, JSON.parse(rumor.content) as SignalPayload);
      return;
    }
    if (rumor.kind !== KIND_DM_RUMOR) return;
    this.onMessage(rumor.pubkey, { fromPubkey: rumor.pubkey, content: rumor.content, createdAt: rumor.created_at });
  }

  sendMessage(recipientPubkey: string, content: string): void {
    const channel = this.directChannels.get(recipientPubkey);
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify({ content, createdAt: Math.floor(Date.now() / 1000) }));
      return;
    }
    this.sendRumor(recipientPubkey, content, []);
    if (!this.attemptedDirectConnect.has(recipientPubkey)) {
      this.attemptedDirectConnect.add(recipientPubkey);
      void this.signaling.initiate(recipientPubkey);
    }
  }

  private sendRumor(recipientPubkey: string, content: string, extraTags: string[][]): void {
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

  getTransport(peerPubkey: string): DmTransport {
    const channel = this.directChannels.get(peerPubkey);
    return channel && channel.readyState === 'open' ? 'direct' : 'relay';
  }
}

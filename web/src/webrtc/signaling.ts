// web/src/webrtc/signaling.ts
export interface DataChannelLike {
  send(data: string): void;
  close(): void;
  readyState: string;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
}

export interface PeerConnectionLike {
  createOffer(): Promise<{ type: string; sdp: string }>;
  createAnswer(): Promise<{ type: string; sdp: string }>;
  setLocalDescription(desc: { type: string; sdp: string }): Promise<void>;
  setRemoteDescription(desc: { type: string; sdp: string }): Promise<void>;
  addIceCandidate(candidate: unknown): Promise<void>;
  createDataChannel(label: string): DataChannelLike;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null;
  ondatachannel: ((ev: { channel: DataChannelLike }) => void) | null;
}

export type PeerConnectionFactory = () => PeerConnectionLike;

export interface SignalPayload {
  type: 'offer' | 'answer' | 'ice';
  data: unknown;
}

export class WebRtcSignaling {
  private connections = new Map<string, PeerConnectionLike>();
  private channels = new Map<string, DataChannelLike>();

  constructor(
    private createPeerConnection: PeerConnectionFactory,
    private sendSignal: (peerPubkey: string, payload: SignalPayload) => void,
    private onChannelOpen: (peerPubkey: string, channel: DataChannelLike) => void,
  ) {}

  async initiate(peerPubkey: string): Promise<void> {
    const pc = this.createPeerConnection();
    this.connections.set(peerPubkey, pc);
    const channel = pc.createDataChannel('pilltalk');
    this.wireChannel(peerPubkey, channel);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.sendSignal(peerPubkey, { type: 'ice', data: ev.candidate });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal(peerPubkey, { type: 'offer', data: offer });
  }

  async handleSignal(peerPubkey: string, signal: SignalPayload): Promise<void> {
    if (signal.type === 'offer') {
      const pc = this.createPeerConnection();
      this.connections.set(peerPubkey, pc);
      pc.onicecandidate = (ev) => {
        if (ev.candidate) this.sendSignal(peerPubkey, { type: 'ice', data: ev.candidate });
      };
      pc.ondatachannel = (ev) => this.wireChannel(peerPubkey, ev.channel);
      await pc.setRemoteDescription(signal.data as { type: string; sdp: string });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(peerPubkey, { type: 'answer', data: answer });
      return;
    }

    const pc = this.connections.get(peerPubkey);
    if (!pc) return; // no in-flight handshake for this peer; safe no-op

    if (signal.type === 'answer') {
      await pc.setRemoteDescription(signal.data as { type: string; sdp: string });
      return;
    }
    if (signal.type === 'ice') {
      await pc.addIceCandidate(signal.data);
    }
  }

  private wireChannel(peerPubkey: string, channel: DataChannelLike): void {
    channel.onopen = () => {
      this.channels.set(peerPubkey, channel);
      this.onChannelOpen(peerPubkey, channel);
    };
    channel.onclose = () => this.channels.delete(peerPubkey);
  }

  getChannel(peerPubkey: string): DataChannelLike | undefined {
    return this.channels.get(peerPubkey);
  }
}

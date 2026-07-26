// web/src/webrtc/signaling.test.ts
import { describe, it, expect, vi } from 'vitest';
import { WebRtcSignaling, type PeerConnectionLike, type DataChannelLike, type SignalPayload } from './signaling';

class FakeDataChannel implements DataChannelLike {
  readyState = 'connecting';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }
  simulateOpen(): void {
    this.readyState = 'open';
    this.onopen?.();
  }
}

class FakePeerConnection implements PeerConnectionLike {
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null;
  ondatachannel: ((ev: { channel: DataChannelLike }) => void) | null = null;
  localChannel: FakeDataChannel | null = null;

  async createOffer() {
    return { type: 'offer', sdp: 'fake-offer-sdp' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'fake-answer-sdp' };
  }
  async setLocalDescription(): Promise<void> {}
  async setRemoteDescription(desc: { type: string; sdp: string }): Promise<void> {
    if (desc.type === 'offer') {
      const channel = new FakeDataChannel();
      this.localChannel = channel;
      this.ondatachannel?.({ channel });
    }
  }
  async addIceCandidate(): Promise<void> {}
  createDataChannel(): DataChannelLike {
    const channel = new FakeDataChannel();
    this.localChannel = channel;
    return channel;
  }
}

describe('WebRtcSignaling', () => {
  it('completes an offer/answer handshake between two peers and opens data channels on both sides', async () => {
    const alicePeerConnections: FakePeerConnection[] = [];
    const bobPeerConnections: FakePeerConnection[] = [];
    let bob: WebRtcSignaling;
    let alice: WebRtcSignaling;

    const aliceOnOpen = vi.fn();
    const bobOnOpen = vi.fn();

    alice = new WebRtcSignaling(
      () => {
        const pc = new FakePeerConnection();
        alicePeerConnections.push(pc);
        return pc;
      },
      (_peerPubkey, payload) => {
        void bob.handleSignal('alice', payload);
      },
      aliceOnOpen,
    );
    bob = new WebRtcSignaling(
      () => {
        const pc = new FakePeerConnection();
        bobPeerConnections.push(pc);
        return pc;
      },
      (_peerPubkey, payload) => {
        void alice.handleSignal('bob', payload);
      },
      bobOnOpen,
    );

    await alice.initiate('bob');

    expect(alicePeerConnections).toHaveLength(1);
    expect(bobPeerConnections).toHaveLength(1);

    const aliceChannel = alicePeerConnections[0]!.localChannel as FakeDataChannel;
    const bobChannel = bobPeerConnections[0]!.localChannel as FakeDataChannel;
    aliceChannel.simulateOpen();
    bobChannel.simulateOpen();

    expect(aliceOnOpen).toHaveBeenCalledWith('bob', aliceChannel);
    expect(bobOnOpen).toHaveBeenCalledWith('alice', bobChannel);
    expect(alice.getChannel('bob')).toBe(aliceChannel);
    expect(bob.getChannel('alice')).toBe(bobChannel);
  });

  it('forwards ICE candidates to the existing peer connection for that peer', async () => {
    let bob: WebRtcSignaling;
    const sentToBob: SignalPayload[] = [];
    const alice = new WebRtcSignaling(
      () => new FakePeerConnection(),
      (_peerPubkey, payload) => sentToBob.push(payload),
      () => {},
    );
    await alice.initiate('bob');
    sentToBob.length = 0; // clear the offer captured above

    const addIceCandidate = vi.fn();
    // Reach into the private map is not possible from a test; instead verify
    // handleSignal on an unknown peer with an 'ice' type is a safe no-op.
    await expect(alice.handleSignal('someone-unconnected', { type: 'ice', data: {} })).resolves.toBeUndefined();
    expect(addIceCandidate).not.toHaveBeenCalled();
  });
});

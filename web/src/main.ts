import { loadOrCreateIdentity, wipeIdentity } from './identity/identity';
import { RelayPool, type MinimalWebSocket } from './relay/relayPool';
import { GeohashChannel } from './channel/geohashChannel';
import { GEOHASH_PRECISION, geohashEncode } from './geohash/geohash';
import { DmManager } from './dm/dmManager';
import type { PeerConnectionLike } from './webrtc/signaling';
import { appendGeohashMessage, appendDmMessage, renderParticipantCount, renderTransport } from './ui/render';

const RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const DEFAULT_GEOHASH = 'u4pru'; // used when geolocation is unavailable or denied

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

async function currentGeohash(): Promise<string> {
  if (!navigator.geolocation) return DEFAULT_GEOHASH;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(geohashEncode(pos.coords.latitude, pos.coords.longitude, GEOHASH_PRECISION.neighborhood)),
      () => resolve(DEFAULT_GEOHASH),
      { timeout: 5000 },
    );
  });
}

async function main(): Promise<void> {
  const identity = loadOrCreateIdentity(window.localStorage);
  byId('pubkey-label').textContent = identity.publicKeyHex.slice(0, 12);

  const pool = new RelayPool(RELAY_URLS, (url) => new WebSocket(url) as unknown as MinimalWebSocket);

  const geohash = await currentGeohash();
  byId('geohash-label').textContent = geohash;
  const messagesEl = byId('messages');
  const participantCountEl = byId('participant-count');
  const channel = new GeohashChannel(pool, identity.privateKeyHex, geohash, (message) => {
    appendGeohashMessage(messagesEl, message);
    renderParticipantCount(participantCountEl, channel.getParticipantCount());
  });
  channel.join();
  renderParticipantCount(participantCountEl, channel.getParticipantCount());

  byId<HTMLFormElement>('geohash-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = byId<HTMLInputElement>('geohash-input');
    if (!input.value.trim()) return;
    channel.sendMessage(input.value, identity.publicKeyHex.slice(0, 8));
    input.value = '';
  });

  const dmMessagesEl = byId('dm-messages');
  const dmTransportEl = byId('dm-transport');
  const createPeerConnection = (): PeerConnectionLike =>
    new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }) as unknown as PeerConnectionLike;
  const dmManager = new DmManager(
    pool,
    identity.privateKeyHex,
    identity.publicKeyHex,
    (peerPubkey, message) => {
      appendDmMessage(dmMessagesEl, message, false);
      renderTransport(dmTransportEl, dmManager.getTransport(peerPubkey));
    },
    createPeerConnection,
  );
  dmManager.start();

  byId<HTMLFormElement>('dm-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const recipient = byId<HTMLInputElement>('dm-recipient').value.trim();
    const input = byId<HTMLInputElement>('dm-input');
    if (!recipient || !input.value.trim()) return;
    dmManager.sendMessage(recipient, input.value);
    appendDmMessage(dmMessagesEl, { fromPubkey: identity.publicKeyHex, content: input.value, createdAt: Date.now() / 1000 }, true);
    renderTransport(dmTransportEl, dmManager.getTransport(recipient));
    input.value = '';
  });

  byId('wipe-button').addEventListener('click', () => {
    wipeIdentity(window.localStorage);
    window.location.reload();
  });
}

void main();

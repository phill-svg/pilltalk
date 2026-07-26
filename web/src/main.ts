import { loadOrCreateIdentity, wipeIdentity } from './identity/identity';
import { RelayPool, type MinimalWebSocket } from './relay/relayPool';
import { GeohashChannel } from './channel/geohashChannel';
import { GEOHASH_PRECISION, geohashEncode } from './geohash/geohash';
import { DmManager } from './dm/dmManager';
import type { PeerConnectionLike } from './webrtc/signaling';
import { loadContacts, upsertContact, findContact, type Contact } from './contacts/contacts';
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

function shortPubkey(pubkey: string): string {
  return pubkey.slice(0, 8);
}

const GEOHASH_PATTERN = /^[0-9b-hjkmnp-z]{1,12}$/i;

function isValidGeohash(value: string): boolean {
  return GEOHASH_PATTERN.test(value);
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

  const pubkeyLabelEl = byId<HTMLButtonElement>('pubkey-label');
  pubkeyLabelEl.textContent = identity.publicKeyHex.slice(0, 12);
  pubkeyLabelEl.addEventListener('click', () => {
    void navigator.clipboard.writeText(identity.publicKeyHex).then(() => {
      pubkeyLabelEl.textContent = 'copied';
      setTimeout(() => {
        pubkeyLabelEl.textContent = identity.publicKeyHex.slice(0, 12);
      }, 1200);
    });
  });

  const pool = new RelayPool(RELAY_URLS, (url) => new WebSocket(url) as unknown as MinimalWebSocket);

  // --- Geohash room ---
  const messagesEl = byId('messages');
  const participantCountEl = byId('participant-count');
  const channelSignalEl = byId('channel-signal');
  const geohashLabelInput = byId<HTMLInputElement>('geohash-label');

  let channel: GeohashChannel;

  function updateChannelSignal(): void {
    const count = channel.getParticipantCount();
    renderParticipantCount(participantCountEl, count);
    channelSignalEl.dataset.level = count.exact ? String(Math.min(count.count, 4)) : 'unknown';
  }

  function joinChannel(newGeohash: string): void {
    channel?.leave();
    messagesEl.innerHTML = '';
    geohashLabelInput.value = newGeohash;
    channel = new GeohashChannel(pool, identity.privateKeyHex, newGeohash, (message) => {
      appendGeohashMessage(messagesEl, message);
      updateChannelSignal();
    });
    channel.join();
    updateChannelSignal();
  }

  joinChannel(await currentGeohash());

  byId<HTMLFormElement>('geohash-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = byId<HTMLInputElement>('geohash-input');
    if (!input.value.trim()) return;
    channel.sendMessage(input.value, identity.publicKeyHex.slice(0, 8));
    input.value = '';
  });

  byId<HTMLFormElement>('room-switch-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const value = geohashLabelInput.value.trim().toLowerCase();
    if (!isValidGeohash(value)) {
      geohashLabelInput.classList.add('is-invalid');
      setTimeout(() => geohashLabelInput.classList.remove('is-invalid'), 900);
      return;
    }
    joinChannel(value);
  });

  // --- Contacts + direct messages ---
  let contacts: Contact[] = loadContacts(window.localStorage);
  let activeRecipient: string | null = null;

  const contactListEl = byId('contact-list');
  const addContactForm = byId<HTMLFormElement>('add-contact-form');
  const newContactPubkeyInput = byId<HTMLInputElement>('new-contact-pubkey');
  const newContactNameInput = byId<HTMLInputElement>('new-contact-name');
  const activeRecipientEl = byId('active-recipient');
  const activeRecipientLabelEl = byId('active-recipient-label');
  const activeRecipientPubkeyEl = byId('active-recipient-pubkey');
  const dmInput = byId<HTMLInputElement>('dm-input');
  const dmMessagesEl = byId('dm-messages');
  const dmTransportEl = byId('dm-transport');
  const dmSignalEl = byId('dm-signal');

  function contactLabel(pubkey: string): string {
    return findContact(contacts, pubkey)?.label ?? shortPubkey(pubkey);
  }

  function updateDmSignal(): void {
    if (!activeRecipient) {
      dmTransportEl.textContent = '';
      dmSignalEl.removeAttribute('data-transport');
      return;
    }
    const transport = dmManager.getTransport(activeRecipient);
    renderTransport(dmTransportEl, transport);
    dmSignalEl.dataset.transport = transport;
  }

  function renderContactList(): void {
    contactListEl.innerHTML = '';
    for (const contact of contacts) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = contact.pubkey === activeRecipient ? 'contact-chip is-active' : 'contact-chip';
      chip.textContent = contact.label;
      chip.title = contact.pubkey;
      chip.addEventListener('click', () => selectRecipient(contact.pubkey));
      contactListEl.append(chip);
    }
    const addChip = document.createElement('button');
    addChip.type = 'button';
    addChip.className = 'contact-chip is-add';
    addChip.textContent = '+ Add';
    addChip.addEventListener('click', () => {
      addContactForm.classList.toggle('is-open');
      if (addContactForm.classList.contains('is-open')) newContactPubkeyInput.focus();
    });
    contactListEl.append(addChip);
  }

  function selectRecipient(pubkey: string): void {
    activeRecipient = pubkey;
    addContactForm.classList.remove('is-open');
    activeRecipientEl.hidden = false;
    activeRecipientLabelEl.textContent = contactLabel(pubkey);
    activeRecipientPubkeyEl.textContent = shortPubkey(pubkey);
    dmInput.disabled = false;
    renderContactList();
    updateDmSignal();
  }

  renderContactList();

  addContactForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const pubkey = newContactPubkeyInput.value.trim();
    const name = newContactNameInput.value.trim();
    if (!pubkey || !name) return;
    contacts = upsertContact(window.localStorage, pubkey, name);
    newContactPubkeyInput.value = '';
    newContactNameInput.value = '';
    selectRecipient(pubkey);
  });

  messagesEl.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>('.geohash-message');
    const pubkey = target?.dataset.pubkey;
    if (!pubkey || pubkey === identity.publicKeyHex) return;
    if (findContact(contacts, pubkey)) {
      selectRecipient(pubkey);
    } else {
      addContactForm.classList.add('is-open');
      newContactPubkeyInput.value = pubkey;
      newContactNameInput.value = '';
      newContactNameInput.focus();
    }
  });

  const createPeerConnection = (): PeerConnectionLike =>
    new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }) as unknown as PeerConnectionLike;

  const dmManager = new DmManager(
    pool,
    identity.privateKeyHex,
    identity.publicKeyHex,
    (peerPubkey, message) => {
      if (!findContact(contacts, peerPubkey)) {
        contacts = upsertContact(window.localStorage, peerPubkey, shortPubkey(peerPubkey));
        renderContactList();
      }
      appendDmMessage(dmMessagesEl, message, false, contactLabel(peerPubkey));
      if (peerPubkey === activeRecipient) updateDmSignal();
    },
    createPeerConnection,
  );
  dmManager.start();

  byId<HTMLFormElement>('dm-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!activeRecipient || !dmInput.value.trim()) return;
    dmManager.sendMessage(activeRecipient, dmInput.value);
    appendDmMessage(dmMessagesEl, { fromPubkey: identity.publicKeyHex, content: dmInput.value, createdAt: Date.now() / 1000 }, true, 'You');
    updateDmSignal();
    dmInput.value = '';
  });

  byId('wipe-button').addEventListener('click', () => {
    wipeIdentity(window.localStorage);
    window.location.reload();
  });
}

void main();

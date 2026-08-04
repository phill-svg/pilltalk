import { loadOrCreateIdentity, wipeIdentity } from './identity/identity';
import { loadNickname, saveNickname } from './identity/nickname';
import { RelayPool, type MinimalWebSocket } from './relay/relayPool';
import { GeohashChannel } from './channel/geohashChannel';
import { GEOHASH_PRECISION, geohashEncode, geohashDecodeCenter } from './geohash/geohash';
import { closestRelays } from './relay/geoRelayDirectory';
import { DmManager } from './dm/dmManager';
import type { PeerConnectionLike } from './webrtc/signaling';
import { loadContacts, upsertContact, findContact, type Contact } from './contacts/contacts';
import {
  appendGeohashMessage,
  appendDmMessage,
  renderParticipantCount,
  renderRelayStatus,
  renderTransport,
} from './ui/render';
import { renderContactsList } from './ui/contactsList';
import { isPushSupported, isPushEnabled, enablePush, notifyPeer, registerServiceWorker } from './push/push';

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

// Geolocation's own `timeout` only starts once the user answers the
// permission prompt, so an unanswered prompt leaves the promise pending
// forever. Nothing may wait on this, but cap it anyway so the room picker
// stops claiming to be looking for a location that will never arrive.
const GEOLOCATION_TIMEOUT_MS = 10_000;

async function currentPosition(): Promise<GeolocationCoordinates | null> {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    const done = (coords: GeolocationCoordinates | null) => resolve(coords);
    const timer = setTimeout(() => done(null), GEOLOCATION_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        done(pos.coords);
      },
      () => {
        clearTimeout(timer);
        done(null);
      },
      { timeout: GEOLOCATION_TIMEOUT_MS },
    );
  });
}

interface RoomTier {
  key: keyof typeof GEOHASH_PRECISION;
  label: string;
  geohash: string;
}

// Finest-to-broadest, matching the iOS/Android location channels list order.
const TIER_ORDER: Array<{ key: keyof typeof GEOHASH_PRECISION; label: string }> = [
  { key: 'block', label: 'Block' },
  { key: 'neighborhood', label: 'Neighborhood' },
  { key: 'city', label: 'City' },
  { key: 'province', label: 'Province' },
  { key: 'region', label: 'Region' },
];

function computeTiers(coords: GeolocationCoordinates): RoomTier[] {
  return TIER_ORDER.map(({ key, label }) => ({
    key,
    label,
    geohash: geohashEncode(coords.latitude, coords.longitude, GEOHASH_PRECISION[key]),
  }));
}

// Every DOM listener below is wired synchronously and on purpose. An `await`
// anywhere in this function delays -- or, if it rejects, permanently skips --
// every listener after it, and an unwired <form> falls back to the browser's
// default submit, which reloads the page and throws the typed message away.
// That is exactly what "the app won't send messages" looks like from the
// outside, so browser APIs that can hang or reject (push registration
// lookups, geolocation) run as non-blocking, self-contained follow-ups.
function main(): void {
  registerServiceWorker();

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

  type AppSection = 'chats' | 'contacts' | 'settings';

  const sectionEls: Record<AppSection, HTMLElement> = {
    chats: byId('section-chats'),
    contacts: byId('section-contacts'),
    settings: byId('section-settings'),
  };
  const sidebarItemEls: Record<AppSection, HTMLButtonElement> = {
    chats: byId('nav-chats'),
    contacts: byId('nav-contacts'),
    settings: byId('nav-settings'),
  };
  const sidebarEl = byId('app-sidebar');
  const sidebarToggleEl = byId<HTMLButtonElement>('sidebar-toggle');

  function showSection(section: AppSection): void {
    for (const key of Object.keys(sectionEls) as AppSection[]) {
      sectionEls[key].hidden = key !== section;
      sidebarItemEls[key].classList.toggle('is-active', key === section);
    }
    sidebarEl.classList.remove('is-open');
    sidebarToggleEl.setAttribute('aria-expanded', 'false');
  }

  for (const key of Object.keys(sidebarItemEls) as AppSection[]) {
    sidebarItemEls[key].addEventListener('click', () => showSection(key));
  }

  sidebarToggleEl.addEventListener('click', () => {
    const isOpen = sidebarEl.classList.toggle('is-open');
    sidebarToggleEl.setAttribute('aria-expanded', String(isOpen));
  });

  let nickname = loadNickname(window.localStorage);

  const nicknameForm = byId<HTMLFormElement>('nickname-form');
  const nicknameInput = byId<HTMLInputElement>('nickname-input');
  nicknameInput.value = nickname ?? '';

  nicknameForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    nickname = saveNickname(window.localStorage, nicknameInput.value);
    nicknameInput.value = nickname ?? '';
  });

  const notifyButton = byId<HTMLButtonElement>('notify-button');
  if (!isPushSupported()) {
    notifyButton.disabled = true;
    notifyButton.textContent = 'Notify: unsupported';
  } else {
    notifyButton.addEventListener('click', () => {
      void enablePush(identity.publicKeyHex)
        .then((enabled) => {
          notifyButton.textContent = enabled ? 'Notify: on' : 'Notify: blocked';
          notifyButton.classList.toggle('is-on', enabled);
        })
        .catch(() => {
          notifyButton.textContent = 'Notify: unavailable';
        });
    });
    // Reflecting an existing subscription is cosmetic: getRegistration() and
    // getSubscription() both reject outright in some browsers (private
    // windows, push-disabled builds), and that must not take the rest of the
    // app down with it.
    void isPushEnabled()
      .then((enabled) => {
        if (!enabled) return;
        notifyButton.textContent = 'Notify: on';
        notifyButton.classList.add('is-on');
      })
      .catch(() => {});
  }

  const pool = new RelayPool(RELAY_URLS, (url) => new WebSocket(url) as unknown as MinimalWebSocket);

  // --- Geohash room ---
  const messagesEl = byId('messages');
  const participantCountEl = byId('participant-count');
  const channelSignalEl = byId('channel-signal');
  const geohashLabelInput = byId<HTMLInputElement>('geohash-label');
  const geohashLabelDisplay = byId('geohash-label-display');
  const roomPickerButton = byId<HTMLButtonElement>('room-picker-button');
  const roomPickerBackdrop = byId<HTMLDivElement>('room-picker-backdrop');
  const roomPickerClose = byId<HTMLButtonElement>('room-picker-close');
  const roomTierList = byId('room-tier-list');

  let channel: GeohashChannel;
  let geoPool: RelayPool | null = null;
  let tiers: RoomTier[] = [];
  // Set once the user picks a room or talks in the current one, so a late
  // geolocation result can't yank them out of a conversation they started.
  let roomChosenByUser = false;

  // Matches the native apps' GeoRelayDirectory count (TransportConfig.nostrGeoRelayCount).
  const GEO_RELAY_COUNT = 5;

  function updateChannelSignal(): void {
    if (geoPool && geoPool.connectedCount() === 0) {
      renderRelayStatus(participantCountEl, geoPool.pendingPublishCount());
      channelSignalEl.dataset.level = '0';
      return;
    }
    const count = channel.getParticipantCount();
    renderParticipantCount(participantCountEl, count);
    channelSignalEl.dataset.level = count.exact ? String(Math.min(count.count, 4)) : 'unknown';
  }

  function renderTierList(activeGeohash: string): void {
    roomTierList.innerHTML = '';
    for (const tier of tiers) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = tier.geohash === activeGeohash ? 'room-tier-row is-active' : 'room-tier-row';
      row.innerHTML = `<span class="room-tier-name">${tier.label}</span><span class="room-tier-code">#${tier.geohash}</span>`;
      row.addEventListener('click', () => {
        roomChosenByUser = true;
        joinChannel(tier.geohash);
        roomPickerBackdrop.hidden = true;
      });
      roomTierList.append(row);
    }
  }

  function joinChannel(newGeohash: string): void {
    channel?.leave();
    geoPool?.disconnect();
    messagesEl.innerHTML = '';
    geohashLabelInput.value = newGeohash;
    geohashLabelDisplay.textContent = `#${newGeohash}`;
    renderTierList(newGeohash);

    // The native apps subscribe to and publish geohash chat/presence on the
    // relays geographically closest to the room, not a fixed global list --
    // matching that here is required for interop (see geoRelayDirectory.ts).
    const { lat, lon } = geohashDecodeCenter(newGeohash);
    const relaysForRoom = closestRelays(lat, lon, GEO_RELAY_COUNT);
    geoPool = new RelayPool(
      relaysForRoom.length > 0 ? relaysForRoom : RELAY_URLS,
      (url) => new WebSocket(url) as unknown as MinimalWebSocket,
    );

    channel = new GeohashChannel(geoPool, identity.privateKeyHex, newGeohash, (message) => {
      appendGeohashMessage(messagesEl, message, channel.myPubkey);
      updateChannelSignal();
    });
    channel.join();
    updateChannelSignal();
  }

  // Join something immediately so the room is live (and sendable) from the
  // first frame; the located room replaces it below once coordinates arrive.
  joinChannel(DEFAULT_GEOHASH);

  // Relay connectivity and presence both change with no user event to hang a
  // redraw off, so the room signal is refreshed on a timer.
  setInterval(updateChannelSignal, 2000);

  roomPickerButton.addEventListener('click', () => {
    roomPickerBackdrop.hidden = false;
  });
  roomPickerClose.addEventListener('click', () => {
    roomPickerBackdrop.hidden = true;
  });
  roomPickerBackdrop.addEventListener('click', (ev) => {
    if (ev.target === roomPickerBackdrop) roomPickerBackdrop.hidden = true;
  });

  byId<HTMLFormElement>('geohash-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = byId<HTMLInputElement>('geohash-input');
    if (!input.value.trim()) return;
    roomChosenByUser = true;
    channel.sendMessage(input.value, nickname ?? identity.publicKeyHex.slice(0, 8));
    input.value = '';
    updateChannelSignal(); // surface "queued" immediately if no relay is up yet
  });

  byId<HTMLFormElement>('room-switch-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const value = geohashLabelInput.value.trim().toLowerCase();
    if (!isValidGeohash(value)) {
      geohashLabelInput.classList.add('is-invalid');
      setTimeout(() => geohashLabelInput.classList.remove('is-invalid'), 900);
      return;
    }
    roomChosenByUser = true;
    joinChannel(value);
    roomPickerBackdrop.hidden = true;
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
  const contactsListContainerEl = byId('contacts-list-container');

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

    renderContactsList(contactsListContainerEl, contacts, activeRecipient, selectRecipient);
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
    notifyPeer(activeRecipient);
    appendDmMessage(dmMessagesEl, { fromPubkey: identity.publicKeyHex, content: dmInput.value, createdAt: Date.now() / 1000 }, true, 'You');
    updateDmSignal();
    dmInput.value = '';
  });

  byId('wipe-button').addEventListener('click', () => {
    wipeIdentity(window.localStorage);
    window.location.reload();
  });

  // Deliberately last, deliberately not awaited: the permission prompt can sit
  // unanswered indefinitely, and everything above has to work meanwhile.
  void currentPosition()
    .then((position) => {
      if (!position) return;
      tiers = computeTiers(position);
      const local = tiers.find((t) => t.key === 'neighborhood')?.geohash;
      if (!local) return;
      if (roomChosenByUser) {
        renderTierList(geohashLabelInput.value); // offer the located rooms without switching
        return;
      }
      joinChannel(local);
    })
    .catch(() => {});
}

main();

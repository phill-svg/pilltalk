// web/src/ui/render.ts
import type { GeohashMessage, ParticipantCount } from '../channel/geohashChannel';
import type { ChatMessage, DmTransport } from '../dm/dmManager';
import { colorForSender } from './peerColor';

export function appendGeohashMessage(container: HTMLElement, message: GeohashMessage, myPubkey?: string): void {
  const el = document.createElement('div');
  el.className = 'geohash-message';
  el.dataset.pubkey = message.pubkey;

  const isSelf = message.pubkey === myPubkey;
  const color = colorForSender(message.pubkey, isSelf);

  const openBracket = document.createElement('span');
  openBracket.className = 'bracket';
  openBracket.textContent = '<';
  const nickname = document.createElement('strong');
  nickname.className = 'sender';
  nickname.textContent = message.nickname;
  nickname.style.color = color;
  nickname.title = `${message.pubkey} — click to reply by DM`;
  const closeBracket = document.createElement('span');
  closeBracket.className = 'bracket';
  closeBracket.textContent = '>';
  const content = document.createElement('span');
  content.textContent = ` ${message.content}`;

  el.append(openBracket, nickname, closeBracket, content);
  container.append(el);
}

export function appendDmMessage(container: HTMLElement, message: ChatMessage, isOwn: boolean, senderLabel: string): void {
  const el = document.createElement('div');
  el.className = isOwn ? 'dm-message own' : 'dm-message';
  const color = colorForSender(message.fromPubkey || senderLabel, isOwn);

  const openBracket = document.createElement('span');
  openBracket.className = 'bracket';
  openBracket.textContent = '<';
  const sender = document.createElement('strong');
  sender.className = 'sender';
  sender.textContent = senderLabel;
  sender.style.color = color;
  const closeBracket = document.createElement('span');
  closeBracket.className = 'bracket';
  closeBracket.textContent = '>';
  const content = document.createElement('span');
  content.textContent = ` ${message.content}`;

  el.append(openBracket, sender, closeBracket, content);
  container.append(el);
}

export function renderParticipantCount(el: HTMLElement, count: ParticipantCount): void {
  el.textContent = count.exact ? `${count.count} people` : '? people';
}

/**
 * Shown in place of the participant count while no relay for the current room
 * is connected. Without it, a send during that window looks identical to a
 * successful one -- the message is queued and goes out on connect, but the
 * user has no way to tell the difference from "the app is broken".
 */
export function renderRelayStatus(el: HTMLElement, queuedMessages: number): void {
  el.textContent = queuedMessages > 0 ? `connecting… ${queuedMessages} queued` : 'connecting…';
}

export function renderTransport(el: HTMLElement, transport: DmTransport): void {
  el.textContent = transport;
}

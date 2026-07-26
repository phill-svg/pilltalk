// web/src/ui/render.ts
import type { GeohashMessage, ParticipantCount } from '../channel/geohashChannel';
import type { ChatMessage, DmTransport } from '../dm/dmManager';

export function appendGeohashMessage(container: HTMLElement, message: GeohashMessage): void {
  const el = document.createElement('div');
  el.className = 'geohash-message';
  el.dataset.pubkey = message.pubkey;
  const nickname = document.createElement('strong');
  nickname.className = 'sender';
  nickname.textContent = message.nickname;
  nickname.title = `${message.pubkey} — click to reply by DM`;
  const content = document.createElement('span');
  content.textContent = ` ${message.content}`;
  el.append(nickname, content);
  container.append(el);
}

export function appendDmMessage(container: HTMLElement, message: ChatMessage, isOwn: boolean, senderLabel: string): void {
  const el = document.createElement('div');
  el.className = isOwn ? 'dm-message own' : 'dm-message';
  const sender = document.createElement('strong');
  sender.className = 'sender';
  sender.textContent = senderLabel;
  const content = document.createElement('span');
  content.textContent = ` ${message.content}`;
  el.append(sender, content);
  container.append(el);
}

export function renderParticipantCount(el: HTMLElement, count: ParticipantCount): void {
  el.textContent = count.exact ? `${count.count} people` : '? people';
}

export function renderTransport(el: HTMLElement, transport: DmTransport): void {
  el.textContent = transport;
}

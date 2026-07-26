// web/src/ui/render.ts
import type { GeohashMessage, ParticipantCount } from '../channel/geohashChannel';
import type { ChatMessage, DmTransport } from '../dm/dmManager';

export function appendGeohashMessage(container: HTMLElement, message: GeohashMessage): void {
  const el = document.createElement('div');
  el.className = 'geohash-message';
  const nickname = document.createElement('strong');
  nickname.textContent = message.nickname;
  const content = document.createElement('span');
  content.textContent = ` ${message.content}`;
  el.append(nickname, content);
  container.append(el);
}

export function appendDmMessage(container: HTMLElement, message: ChatMessage, isOwn: boolean): void {
  const el = document.createElement('div');
  el.className = isOwn ? 'dm-message own' : 'dm-message';
  el.textContent = message.content;
  container.append(el);
}

export function renderParticipantCount(el: HTMLElement, count: ParticipantCount): void {
  el.textContent = count.exact ? `${count.count} people` : '? people';
}

export function renderTransport(el: HTMLElement, transport: DmTransport): void {
  el.textContent = transport;
}

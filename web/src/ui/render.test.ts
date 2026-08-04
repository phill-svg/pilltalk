// web/src/ui/render.test.ts
import { describe, it, expect } from 'vitest';
import {
  appendGeohashMessage,
  appendDmMessage,
  renderParticipantCount,
  renderRelayStatus,
  renderTransport,
} from './render';

describe('render helpers', () => {
  it('appends a geohash message with nickname and content', () => {
    const container = document.createElement('div');
    appendGeohashMessage(container, { pubkey: 'a'.repeat(64), nickname: 'phill', content: 'hey', createdAt: 1700000000 });

    expect(container.children).toHaveLength(1);
    expect(container.textContent).toContain('phill');
    expect(container.textContent).toContain('hey');
  });

  it('exposes the sender pubkey on the message element so the UI can wire click-to-DM', () => {
    const container = document.createElement('div');
    appendGeohashMessage(container, { pubkey: 'a'.repeat(64), nickname: 'phill', content: 'hey', createdAt: 1700000000 });

    const el = container.firstElementChild as HTMLElement;
    expect(el.dataset.pubkey).toBe('a'.repeat(64));
    expect(el.querySelector('.sender')?.getAttribute('title')).toContain('a'.repeat(64));
  });

  it('appends a DM message with a sender label and marks own messages with a distinct class', () => {
    const container = document.createElement('div');
    appendDmMessage(container, { fromPubkey: 'a'.repeat(64), content: 'hi', createdAt: 1700000000 }, true, 'You');
    appendDmMessage(container, { fromPubkey: 'b'.repeat(64), content: 'hey back', createdAt: 1700000001 }, false, 'Bao');

    expect(container.children).toHaveLength(2);
    expect((container.children[0] as HTMLElement).classList.contains('own')).toBe(true);
    expect(container.children[0]!.textContent).toContain('You');
    expect(container.children[0]!.textContent).toContain('hi');
    expect((container.children[1] as HTMLElement).classList.contains('own')).toBe(false);
    expect(container.children[1]!.textContent).toContain('Bao');
    expect(container.children[1]!.textContent).toContain('hey back');
  });

  it('renders an exact participant count when precision allows it', () => {
    const el = document.createElement('span');
    renderParticipantCount(el, { count: 12, exact: true });
    expect(el.textContent).toBe('12 people');
  });

  it('renders an unknown-count placeholder when precision hides presence', () => {
    const el = document.createElement('span');
    renderParticipantCount(el, { count: 0, exact: false });
    expect(el.textContent).toBe('? people');
  });

  it('renders a plain connecting status when nothing is queued', () => {
    const el = document.createElement('span');
    renderRelayStatus(el, 0);
    expect(el.textContent).toBe('connecting…');
  });

  it('reports how many messages are waiting on a relay connection', () => {
    const el = document.createElement('span');
    renderRelayStatus(el, 2);
    expect(el.textContent).toBe('connecting… 2 queued');
  });

  it('renders the DM transport indicator', () => {
    const el = document.createElement('span');
    renderTransport(el, 'direct');
    expect(el.textContent).toBe('direct');
    renderTransport(el, 'relay');
    expect(el.textContent).toBe('relay');
  });
});

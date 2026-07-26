// web/src/ui/render.test.ts
import { describe, it, expect } from 'vitest';
import { appendGeohashMessage, appendDmMessage, renderParticipantCount, renderTransport } from './render';

describe('render helpers', () => {
  it('appends a geohash message with nickname and content', () => {
    const container = document.createElement('div');
    appendGeohashMessage(container, { pubkey: 'a'.repeat(64), nickname: 'phill', content: 'hey', createdAt: 1700000000 });

    expect(container.children).toHaveLength(1);
    expect(container.textContent).toContain('phill');
    expect(container.textContent).toContain('hey');
  });

  it('appends a DM message and marks own messages with a distinct class', () => {
    const container = document.createElement('div');
    appendDmMessage(container, { fromPubkey: 'a'.repeat(64), content: 'hi', createdAt: 1700000000 }, true);
    appendDmMessage(container, { fromPubkey: 'b'.repeat(64), content: 'hey back', createdAt: 1700000001 }, false);

    expect(container.children).toHaveLength(2);
    expect((container.children[0] as HTMLElement).classList.contains('own')).toBe(true);
    expect((container.children[1] as HTMLElement).classList.contains('own')).toBe(false);
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

  it('renders the DM transport indicator', () => {
    const el = document.createElement('span');
    renderTransport(el, 'direct');
    expect(el.textContent).toBe('direct');
    renderTransport(el, 'relay');
    expect(el.textContent).toBe('relay');
  });
});

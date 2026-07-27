import { describe, it, expect } from 'vitest';
import { renderContactsList } from './contactsList';
import type { Contact } from '../contacts/contacts';

describe('renderContactsList', () => {
  const contacts: Contact[] = [
    { pubkey: 'a'.repeat(64), label: 'Alice' },
    { pubkey: 'b'.repeat(64), label: 'Bob' },
  ];

  it('renders one row per contact with the label as text', () => {
    const container = document.createElement('div');
    renderContactsList(container, contacts, null, () => {});

    const rows = container.querySelectorAll('.contacts-list-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Alice');
    expect(rows[1]?.textContent).toContain('Bob');
  });

  it('marks the row matching activeRecipient as active', () => {
    const container = document.createElement('div');
    renderContactsList(container, contacts, 'b'.repeat(64), () => {});

    const rows = container.querySelectorAll('.contacts-list-row');
    expect(rows[0]?.classList.contains('is-active')).toBe(false);
    expect(rows[1]?.classList.contains('is-active')).toBe(true);
  });

  it('calls onSelect with the pubkey when a row is clicked', () => {
    const container = document.createElement('div');
    let selected: string | null = null;
    renderContactsList(container, contacts, null, (pubkey) => {
      selected = pubkey;
    });

    const rows = container.querySelectorAll<HTMLElement>('.contacts-list-row');
    rows[1]?.click();
    expect(selected).toBe('b'.repeat(64));
  });

  it('clears the container before rendering (no stale rows on re-render)', () => {
    const container = document.createElement('div');
    renderContactsList(container, contacts, null, () => {});
    renderContactsList(container, [contacts[0]!], null, () => {});

    expect(container.querySelectorAll('.contacts-list-row')).toHaveLength(1);
  });

  it('renders an empty-state message when there are no contacts', () => {
    const container = document.createElement('div');
    renderContactsList(container, [], null, () => {});

    expect(container.querySelectorAll('.contacts-list-row')).toHaveLength(0);
    expect(container.textContent).toMatch(/no contacts/i);
  });
});

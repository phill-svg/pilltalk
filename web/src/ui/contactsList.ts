import type { Contact } from '../contacts/contacts';

/**
 * Renders a real, scrollable contacts list — the Contacts nav section's
 * content. Pure DOM helper matching render.ts's convention: takes a
 * container + data + callback, mutates the container, returns void.
 */
export function renderContactsList(
  container: HTMLElement,
  contacts: Contact[],
  activeRecipient: string | null,
  onSelect: (pubkey: string) => void,
): void {
  container.innerHTML = '';

  if (contacts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'contacts-list-empty';
    empty.textContent = 'No contacts yet — add one from the Chats tab.';
    container.append(empty);
    return;
  }

  for (const contact of contacts) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = contact.pubkey === activeRecipient ? 'contacts-list-row is-active' : 'contacts-list-row';
    row.title = contact.pubkey;

    const label = document.createElement('span');
    label.className = 'contacts-list-row-label';
    label.textContent = contact.label;
    row.append(label);

    row.addEventListener('click', () => onSelect(contact.pubkey));
    container.append(row);
  }
}

import type { PhoneObservation } from '../../src/phone/contracts.js';
import { CONTACTS } from './tasks.js';
import { visibleNode } from './support.js';

/** Require the loaded Contacts fixture, not its first-launch empty-state presentation. */
export function initialStateReady(screen: PhoneObservation, allowOpenSearch = false): boolean {
  if (screen.package !== CONTACTS) return true;
  const visible = screen.elements.filter(node => visibleNode(node, screen));
  const query = visible.filter(node => node.editable && node.resourceId === `${CONTACTS}:id/open_search_view_edit_text`);
  if (allowOpenSearch && query.length === 1) return true;
  const lists = visible.filter(node => node.resourceId === 'android:id/list');
  return lists.length === 1 && !lists[0].focused
    && !visible.some(node => node.resourceId === `${CONTACTS}:id/empty_view` || node.text === 'No contacts yet');
}

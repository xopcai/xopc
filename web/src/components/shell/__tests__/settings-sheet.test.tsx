// @vitest-environment jsdom
import * as Dialog from '@radix-ui/react-dialog';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({ portal: false }));
vi.mock('@/lib/use-media-query', () => ({ useMediaQuery: () => media.portal }));
import { SettingsSheet } from '../settings-sheet';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const layerNodes: HTMLElement[] = [];
function Location() { return <output data-testid="route">{useLocation().pathname}</output>; }
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); media.portal = false; });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); layerNodes.splice(0).forEach(node => node.remove()); vi.restoreAllMocks(); });
const escape = () => act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
const route = () => document.querySelector('[data-testid="route"]')?.textContent;
const render = (nested?: React.ReactNode) => act(async () => root.render(<MemoryRouter initialEntries={['/settings/capabilities/models']}><SettingsSheet><button>Service accounts</button></SettingsSheet>{nested}<Location /></MemoryRouter>));

it.each([false, true])('lets a nested Radix dialog close first and preserves the settings route (portal=%s)', async portal => {
  media.portal = portal;
  await render(<Dialog.Root defaultOpen><Dialog.Portal><Dialog.Content data-testid="nested"><Dialog.Title>Model configuration</Dialog.Title><Dialog.Description>Configure this capability</Dialog.Description><button>Save</button></Dialog.Content></Dialog.Portal></Dialog.Root>);
  const nested = document.querySelector<HTMLElement>('[data-testid="nested"]')!;
  vi.spyOn(nested, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList);
  await escape();
  expect(document.querySelector('[data-testid="nested"]')).toBeNull();
  expect(route()).toBe('/settings/capabilities/models');
  await escape(); expect(route()).toBe('/chat');
});

it.each(['dialog', 'alertdialog', 'menu', 'listbox'])('leaves Escape to the active %s instead of navigating away', async role => {
  await render();
  const layer = document.createElement('div'); layer.setAttribute('role', role); layer.dataset.state = 'open'; document.body.append(layer); layerNodes.push(layer);
  vi.spyOn(layer, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList);
  await escape(); expect(route()).toBe('/settings/capabilities/models');
});

it('ignores retained hidden dialogs so normal settings dismissal still works', async () => {
  await render();
  const layer = document.createElement('div'); layer.setAttribute('role', 'dialog'); layer.dataset.state = 'open'; document.body.append(layer); layerNodes.push(layer);
  vi.spyOn(layer, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
  await escape(); expect(route()).toBe('/chat');
});

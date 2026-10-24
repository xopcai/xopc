// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ setup: null as Record<string, unknown> | null, requests: [] as Record<string, unknown>[] }));
vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn(async (_url: unknown, init: RequestInit) => {
  const input = JSON.parse(String(init.body)); fixture.requests.push(input);
  if (input.action === 'inspect') return { payload: { setup: fixture.setup } };
  if (input.action === 'approve') fixture.setup = { ...fixture.setup, approvedBy: 'owner', revision: 2 };
  if (input.action === 'prepare') fixture.setup = { ...fixture.setup, state: 'waiting_extension', revision: 3 };
  if (input.action === 'release') fixture.setup = { ...fixture.setup, attempt: { released: true }, checks: { configured: true, read: false, clicked: false, filled: false, released: true } };
  return { payload: fixture.setup };
}) }));

import { BrowserSetupPanel } from '../browser-setup-panel';
import { useLocaleStore } from '@/stores/locale-store';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'en' }); fixture.requests = [];
  fixture.setup = { id: 'setup-one', revision: 1, state: 'plan_ready', stale: false, endpoints: [], checks: { configured: false, read: false, clicked: false, filled: false, released: false } };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(disabled = false) {
  await act(async () => { root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><MemoryRouter><BrowserSetupPanel conversationId="conversation-one" requested disabled={disabled} /></MemoryRouter></SWRConfig>); });
}
function button(text: string) { return [...container.querySelectorAll('button')].find(b => b.textContent === text)!; }

it('explains the shared change, requires product approval and then prepares files without claiming installation', async () => {
  await render();
  expect(container.textContent).toContain('shared across this Gateway');
  expect(fixture.requests.map(r => r.action)).toEqual(['inspect']);
  await act(async () => button('Enable Chrome and prepare files').click());
  expect(fixture.requests).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'approve', setupId: 'setup-one', expectedRevision: 1 }),
    expect.objectContaining({ action: 'prepare', setupId: 'setup-one' }),
  ]));
  expect(container.textContent).toContain('Waiting for Chrome');
  expect(container.textContent).toContain('Load unpacked');
  expect(container.textContent).not.toContain('Interaction test passed');
});

it('keeps verification disabled until a specific Chrome is selected', async () => {
  fixture.setup = { ...fixture.setup, state: 'ready_for_verification', approvedBy: 'owner', endpoints: [{ endpointId: 'chrome-one', displayName: 'Chrome' }] };
  await render();
  expect(button('Start demo test').disabled).toBe(true);
  expect(container.textContent).toContain('Choose Chrome to test');
});

it('offers direct cleanup after cancellation even when Agent execution is busy', async () => {
  fixture.setup = { ...fixture.setup, state: 'cancelled', attempt: { id: 'attempt', released: false }, error: 'CONTROL_RELEASE_REQUIRED' };
  await render(true);
  expect(button('Release demo control').disabled).toBe(false);
  await act(async () => button('Release demo control').click());
  expect(fixture.requests).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'release', setupId: 'setup-one' })]));
});

it('marks old successful evidence stale after settings change', async () => {
  fixture.setup = { ...fixture.setup, state: 'completed', stale: true };
  await render();
  expect(container.textContent).toContain('Previous evidence is stale');
  expect(container.textContent).not.toContain('Attach a page');
});

it('allows owner cleanup during verification even when Agent execution cannot continue', async () => {
  fixture.setup = { ...fixture.setup, state: 'verifying', attempt: { id: 'attempt', released: false } };
  await render(true);
  expect(button('Release demo control').disabled).toBe(false);
  await act(async () => button('Release demo control').click());
  expect(fixture.requests).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'release' })]));
});

it('preserves permission guidance across reloads with a link back to Agent settings', async () => {
  fixture.setup = { ...fixture.setup, state: 'ready_for_verification', agentId: 'main', toolPermission: 'denied' };
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('cannot use the browser');
  expect(container.querySelector('a[href="/capabilities/agents/main"]')?.textContent).toContain('return to this chat');
});

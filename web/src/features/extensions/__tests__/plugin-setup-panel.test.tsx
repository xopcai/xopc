// @vitest-environment jsdom
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PluginSetupPanel } from '../plugin-setup-panel';
import type { ExtensionApiRow } from '../types';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.request }));
vi.mock('@/lib/url', () => ({ apiUrl: (p: string) => p }));
const extension: ExtensionApiRow = { id: 'plugin:sample', pluginId: 'sample', name: 'Sample', source: 'agent-plugin', active: true, hasUi: false, setup: { userConfig: {}, tasks: ['Read a note'] } };
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const onChanged = vi.fn().mockResolvedValue(undefined);
const base = '/api/extensions/agent-plugins/sample';
let job: { revision: number; state: string; resources: string; partial: boolean; missingConfig: string[]; connections: Array<{ name: string; state: string }> } | null;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); job = null;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.request.mockImplementation(async (path: string, options: { method: string; body?: string }) => {
    if (options.method === 'GET') return { ok: true, payload: path.endsWith('/reusable') ? {} : job };
    const input = JSON.parse(options.body!);
    if (input.action === 'start') job = { revision: 1, state: 'pending', resources: 'pending', connections: [], partial: false, missingConfig: [] };
    else if (input.action === 'prepare') job = { ...job!, revision: 2, state: 'action_required', resources: 'ready' };
    else if (input.action === 'complete') job = { ...job!, revision: 3, state: 'completed' };
    else if (input.action === 'defer') job = { ...job!, revision: 3, state: 'completed', partial: true };
    else if (input.action === 'cancel') job = { ...job!, revision: 4, state: 'cancelled' };
    return { ok: true, payload: job };
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<MemoryRouter><PluginSetupPanel extension={extension} zh={false} onChanged={onChanged} /></MemoryRouter>)); }
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === label); expect(button).toBeDefined();
  await act(async () => button!.click());
}
it('automatically prepares and enables globally without fetching or choosing Agents', async () => {
  await render(); await click('Continue installation');
  expect(host.textContent).toContain('Available to all agents.');
  expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
  expect(mocks.request.mock.calls.some(([path]) => path === '/api/agents')).toBe(false);
  const completion = mocks.request.mock.calls.find(([, options]) => options.body && JSON.parse(options.body).action === 'complete');
  expect(completion![0]).toBe(`${base}/setup`);
  expect(JSON.parse(completion![1].body)).not.toHaveProperty('agentIds');
  expect(host.querySelector('a')?.getAttribute('href')).toContain('draft=Read+a+note');
});
it('resumes persisted authorization without selecting Agents or prematurely completing', async () => {
  job = { revision: 8, state: 'action_required', resources: 'ready', connections: [{ name: 'docs', state: 'oauth_required' }], partial: false, missingConfig: [] };
  await render(); expect(host.textContent).toContain('Connect docs');
  expect(mocks.request.mock.calls.some(([, o]) => o.body && JSON.parse(o.body).action === 'complete')).toBe(false);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Back to plugin details"]')!.click());
  await click('Cancel installation'); expect(host.textContent).toContain('Continue installation');
});
it('persists explicit Skip for now and shows a recoverable authorization warning', async () => {
  job = { revision: 2, state: 'action_required', resources: 'ready', connections: [{ name: 'docs', state: 'token_required' }], partial: true, missingConfig: [] };
  await render(); expect(host.textContent).toContain('Access token');
  await click('Skip for now');
  expect(host.textContent).toContain('Authorization required');
  expect(host.textContent).toContain('Connect account');
  const mutation = mocks.request.mock.calls.find(([, options]) => options.body && JSON.parse(options.body).action === 'defer');
  expect(mutation).toBeDefined();
});
it('does not autoenable when required configuration is missing', async () => {
  job = { revision: 2, state: 'action_required', resources: 'ready', connections: [], partial: false, missingConfig: ['accessKey'] };
  await render(); expect(host.textContent).not.toContain('Installation complete');
  expect(mocks.request.mock.calls.some(([, o]) => o.body && JSON.parse(o.body).action === 'complete')).toBe(false);
});

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
  vi.clearAllMocks(); vi.spyOn(window, 'open').mockReturnValue(null); job = null;
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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
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
it('opens the declared token form from a connection link without starting authorization', async () => {
  job = { revision: 3, state: 'completed', resources: 'ready', connections: [{ name: 'provider', state: 'token_required' }], partial: true, missingConfig: ['accessKey'] };
  const owned: ExtensionApiRow = { ...extension, setup: { tasks: [], userConfig: {
    accessKey: { type: 'string', title: 'Access token', required: true, sensitive: true },
  }, authorizations: [{ id: 'account', title: 'Provider', servers: ['provider'], methods: [{ id: 'token', title: 'Access token', type: 'form', fields: ['accessKey'] }] }] } };
  await act(async () => root.render(<MemoryRouter><PluginSetupPanel extension={owned} initialConnect zh={false} onChanged={onChanged} /></MemoryRouter>));
  expect(host.textContent).toContain('Connect Provider');
  expect(host.querySelector('input[type=password]')).not.toBeNull();
  expect(mocks.request.mock.calls.some(([, options]) => options.body && JSON.parse(options.body).action === 'authorize')).toBe(false);
});
it('starts CLI login after saving its fields without racing a preparation job', async () => {
  job = { revision: 8, state: 'completed', resources: 'ready', connections: [{ name: 'provider', state: 'skipped' }], partial: true, missingConfig: [] };
  const owned: ExtensionApiRow = { ...extension, setup: { tasks: [], userConfig: {
    profile: { type: 'string', title: 'Profile', required: true, sensitive: false },
  }, authorizations: [{ id: 'account', title: 'Provider', servers: ['provider'], methods: [{ id: 'existing', title: 'Existing account', type: 'cli', fields: ['profile'] }] }] } };
  mocks.request.mockImplementation(async (path: string, options: { method: string; body?: string }) => {
    if (options.method === 'GET') return { ok: true, payload: path.includes('/auth/') ? null : job };
    const input = JSON.parse(options.body!);
    job = { ...job!, revision: job!.revision + 1, state: input.action === 'prepare' ? 'running' : 'action_required' };
    return { ok: true, payload: job };
  });
  await act(async () => root.render(<MemoryRouter><PluginSetupPanel extension={owned} initialConnect zh={false} onChanged={onChanged} /></MemoryRouter>));
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'qmdemo');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Save and connect');
  const actions = mocks.request.mock.calls.filter(([, options]) => options.body).map(([, options]) => JSON.parse(options.body).action);
  expect(actions).toEqual(['configure', 'authorize']);
});

it('shows missing business scopes on a connected account and starts targeted recovery', async () => {
  job = { revision: 8, state: 'completed', resources: 'ready', connections: [{ name: 'provider', state: 'connected' }], partial: false, missingConfig: [] };
  Object.assign(job, { installed: true, authorizations: [{ id: 'account', state: 'connected', issues: [{ id: 'calendar', title: 'Calendar permission required', scopes: ['calendar:calendar.event:read'], instructions: ['Enable application access first'], method: 'calendar', helpUrl: 'https://example.com/permissions' }] }] });
  const owned: ExtensionApiRow = { ...extension, setup: { tasks: [], userConfig: {}, authorizations: [{ id: 'account', title: 'Provider', servers: ['provider'], methods: [{ id: 'calendar', title: 'Calendar', type: 'cli', fields: [] }] }] } };
  await act(async () => root.render(<MemoryRouter><PluginSetupPanel extension={owned} zh={false} onChanged={onChanged} /></MemoryRouter>));
  expect(host.textContent).toContain('Calendar permission required');
  expect(host.textContent).toContain('calendar:calendar.event:read');
  expect(host.querySelector('a[href="https://example.com/permissions"]')).not.toBeNull();
  await click('Grant missing permissions');
  const request = mocks.request.mock.calls.find(([, options]) => options.body && JSON.parse(options.body).action === 'authorize');
  expect(JSON.parse(request![1].body)).toMatchObject({ action: 'authorize', server: 'account', method: 'calendar' });
});

for (const type of ['oauth', 'cli'] as const) {
  it(`automatically opens ${type} browser authorization once while polling`, async () => {
    vi.useFakeTimers();
    const popup = { closed: false, opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    vi.mocked(window.open).mockReturnValue(popup as unknown as Window);
    job = { revision: 8, state: 'action_required', resources: 'ready', connections: [{ name: 'provider', state: 'oauth_required' }], partial: true, missingConfig: [] };
    const owned: ExtensionApiRow = { ...extension, setup: { tasks: [], userConfig: {}, authorizations: [{ id: 'account', title: 'Provider', servers: ['provider'], methods: [{ id: 'login', title: 'Login', type }] }] } };
    mocks.request.mockImplementation(async (path: string) => ({ ok: true, payload: path.includes('/auth/') ? { id: 'attempt', state: 'awaiting_user', ...(type === 'oauth' ? { authorizationUrl: 'https://example.com/login' } : { challenge: { type: 'url', url: 'https://example.com/login' } }) } : path.endsWith('/reusable') ? {} : job }));
    try {
      await act(async () => root.render(<MemoryRouter><PluginSetupPanel extension={owned} zh={false} onChanged={onChanged} /></MemoryRouter>));
      await click('Connect account');
      expect(window.open).toHaveBeenCalledWith('about:blank', '_blank');
      expect(popup.opener).toBeNull();
      expect(popup.location.replace).toHaveBeenCalledWith('https://example.com/login');
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(window.open).toHaveBeenCalledTimes(1);
      expect(popup.location.replace).toHaveBeenCalledTimes(1);
      expect(host.querySelector('a[href="https://example.com/login"]')).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });
}

it('attempts to open the URL once when a popup is blocked and keeps the manual link', async () => {
  vi.useFakeTimers();
  job = { revision: 8, state: 'action_required', resources: 'ready', connections: [{ name: 'provider', state: 'oauth_required' }], partial: true, missingConfig: [] };
  mocks.request.mockImplementation(async (path: string) => ({ ok: true, payload: path.includes('/auth/') ? { id: 'attempt', state: 'awaiting_user', authorizationUrl: 'https://example.com/login' } : path.endsWith('/reusable') ? {} : job }));
  try {
    await render(); await click('Connect account');
    expect(window.open).toHaveBeenLastCalledWith('https://example.com/login', '_blank', 'noopener,noreferrer');
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(window.open).toHaveBeenCalledTimes(2);
    expect(host.querySelector('a[href="https://example.com/login"]')).not.toBeNull();
  } finally { vi.useRealTimers(); }
});

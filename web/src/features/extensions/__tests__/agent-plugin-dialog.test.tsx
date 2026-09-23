// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn(), mutate: vi.fn(), status: vi.fn(), start: vi.fn(), reserve: vi.fn(), open: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.request, apiFetch: mocks.fetch }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: mocks.mutate }) }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (select: (state: { language: string }) => unknown) => select({ language: 'en' }) }));
vi.mock('@/features/connectors/mcp/mcp-config-api', () => ({ getMcpOAuthStatus: mocks.status, startMcpOAuth: mocks.start, disconnectMcpOAuth: vi.fn() }));
vi.mock('@/features/settings/oauth-authorization-window', () => ({ reserveOAuthAuthorizationWindow: mocks.reserve, openOAuthAuthorizationUrl: mocks.open, closeOAuthAuthorizationWindow: mocks.close }));
import { AgentPluginDialog, PluginMcpConnection } from '../agent-plugin-dialog';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); mocks.status.mockResolvedValue({ configured: true, status: 'disconnected' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (node: ReactNode) => { await act(async () => root.render(node)); };
const click = async (text: string) => {
  const button = [...document.querySelectorAll('button')].find(button => button.textContent === text);
  expect(button).toBeDefined(); await act(async () => button!.click());
};
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('keeps the dialog open after install and offers immediate activation', async () => {
  const onClose = vi.fn();
  const installed = {
    id: 'plugin:sample', pluginId: 'sample', format: 'agent-plugin', name: 'sample', version: '1.0.0', source: 'agent-plugin', active: false,
    activationEligible: false, readiness: 'setup_required', hasUi: false, components: { skills: [{ name: 'sample' }], mcp: [] }, diagnostics: [],
  };
  mocks.request
    .mockResolvedValueOnce({ ok: true, payload: { manifest: { name: 'sample' }, reviewHash: 'reviewed-hash', capabilities: ['content.skills:sample'], addedCapabilities: ['content.skills:sample'], diagnostics: [], installed: false } })
    .mockResolvedValueOnce({ ok: true, payload: installed })
    .mockResolvedValueOnce({ ok: true, payload: { ...installed, active: true, activationEligible: true, readiness: 'ready' } });
  await render(<AgentPluginDialog initialSource="/tmp/plugin" onClose={onClose} />);
  expect(document.body.textContent).not.toContain('Accept capabilities and install');
  await click('Inspect package');
  expect(document.body.textContent).toContain('content.skills:sample');
  await click('Accept capabilities and install');
  expect(mocks.request).toHaveBeenNthCalledWith(2, '/api/extensions/install', { method: 'POST', body: JSON.stringify({ source: '/tmp/plugin', reviewHash: 'reviewed-hash' }) });
  expect(onClose).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Plugin installed. It is not enabled yet.');
  await click('Enable plugin');
  expect(mocks.request).toHaveBeenLastCalledWith('/api/extensions/agent-plugins/sample/activation', { method: 'POST', body: JSON.stringify({ enabled: true }) });
  expect(document.body.textContent).toContain('Disable');
  expect(document.body.textContent).not.toContain('Plugin installed. It is not enabled yet.');
});
it('invalidates a reviewed plan when the source changes', async () => {
  mocks.request.mockResolvedValue({ ok: true, payload: { manifest: { name: 'sample' }, reviewHash: 'hash', capabilities: [], addedCapabilities: [], diagnostics: [] } });
  await render(<AgentPluginDialog initialSource="/tmp/one" onClose={() => {}} />);
  await click('Inspect package');
  await input(document.querySelector('input')!, '/tmp/two');
  expect(document.body.textContent).not.toContain('Accept capabilities and install');
});
it('does not start OAuth on render and clears a secret after host-managed storage', async () => {
  mocks.request.mockResolvedValue({ ok: true });
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, payload: { toolCount: 2 } }) });
  await render(<PluginMcpConnection pluginId="sample" server={{ id: 'plugin/sample/main', name: 'main', type: 'streamable-http' }} enabled />);
  expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
  await click('Set API key');
  await input(document.querySelector('input[type=password]')!, 'private-token');
  await click('Save and test');
  expect(mocks.request).toHaveBeenCalledWith('/api/extensions/agent-plugins/sample/mcp/main/auth', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('private-token') }));
  expect(document.querySelector('input[type=password]')).toBeNull();
  expect(document.body.textContent).not.toContain('private-token');
  expect(document.body.textContent).toContain('Connected · 2 tools');
});

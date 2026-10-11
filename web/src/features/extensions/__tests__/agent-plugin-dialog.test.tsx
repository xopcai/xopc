// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn(), mutate: vi.fn(), status: vi.fn(), start: vi.fn(), reserve: vi.fn(), open: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.request, apiFetch: mocks.fetch }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: mocks.mutate }) }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (select: (state: { language: string }) => unknown) => select({ language: 'en' }) }));
import { AgentPluginDialog, PluginMcpConnection } from '../agent-plugin-dialog';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const previousElectronApi = window.electronAPI;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); mocks.status.mockResolvedValue({ configured: true, status: 'disconnected' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); window.electronAPI = previousElectronApi; });
const render = async (node: ReactNode) => { await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>)); };
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

it('installs and enables a reviewed local plugin in one continuation', async () => {
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
  expect(document.body.textContent).not.toContain('Authorize and install');
  await click('Inspect package');
  expect(document.body.textContent).toContain('Add skill: sample');
  await click('Authorize and install');
  expect(mocks.request).toHaveBeenNthCalledWith(2, '/api/extensions/install', { method: 'POST', body: JSON.stringify({ source: '/tmp/plugin', reviewHash: 'reviewed-hash' }) });
  expect(mocks.request).toHaveBeenNthCalledWith(3, '/api/extensions/agent-plugins/sample/activation', { method: 'POST', body: JSON.stringify({ enabled: true }) });
  expect(onClose).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Plugin installed and enabled');
  expect(document.querySelector('a[href="/capabilities/skills?source=plugin"]')).not.toBeNull();
  expect(document.body.textContent).toContain('Disable');
  expect(document.body.textContent).not.toContain('Plugin installed. It is not enabled yet.');
});
it('invalidates a reviewed plan when the source changes', async () => {
  mocks.request.mockResolvedValue({ ok: true, payload: { manifest: { name: 'sample' }, reviewHash: 'hash', capabilities: [], addedCapabilities: [], diagnostics: [] } });
  await render(<AgentPluginDialog initialSource="/tmp/one" onClose={() => {}} />);
  await click('Inspect package');
  await input(document.querySelector('input')!, '/tmp/two');
  expect(document.body.textContent).not.toContain('Authorize and install');
});

it('one-click installs and enables a verified content-only Store plugin', async () => {
  const installed = {
    id: 'plugin:brief', pluginId: 'brief', format: 'agent-plugin', name: 'brief', version: '1.0.0', source: 'agent-plugin', active: false,
    activationEligible: false, readiness: 'setup_required', hasUi: false, components: { skills: [{ name: 'brief' }], mcp: [] }, diagnostics: [],
  };
  mocks.request
    .mockResolvedValueOnce({ ok: true, payload: { manifest: { name: 'brief' }, reviewHash: 'brief-hash', capabilities: ['content.skills:brief'], addedCapabilities: ['content.skills:brief'], diagnostics: [], installed: false } })
    .mockResolvedValueOnce({ ok: true, payload: installed })
    .mockResolvedValueOnce({ ok: true, payload: { ...installed, active: true, activationEligible: true, readiness: 'ready' } });

  await render(<AgentPluginDialog
    initialSource="store:brief"
    autoInstall
    marketplace={{
      id: 'brief', name: 'Brief', type: 'plugin', description: 'Create briefs', readme: null, downloads: 1,
      author: { username: 'xopc', avatarUrl: null }, publisher: { verification: 'verified', sourceRepository: null },
      latestVersion: { version: '1.0.0', changelog: null, publishedAt: '2026-09-30', riskTier: 'content' },
      installability: { available: true },
    }}
    onClose={() => {}}
  />);
  await act(async () => {});

  expect(mocks.request).toHaveBeenNthCalledWith(1, '/api/extensions/inspect', { method: 'POST', body: JSON.stringify({ source: 'store:brief' }) });
  expect(mocks.request).toHaveBeenNthCalledWith(2, '/api/extensions/install', { method: 'POST', body: JSON.stringify({ source: 'store:brief', reviewHash: 'brief-hash' }) });
  expect(mocks.request).toHaveBeenNthCalledWith(3, '/api/extensions/agent-plugins/brief/activation', { method: 'POST', body: JSON.stringify({ enabled: true }) });
  expect(document.body.textContent).toContain('Plugin installed and enabled');
  expect(document.body.textContent).not.toContain('Package source');
});

it('pauses one-click installation for authorization when a Store plugin can run local code', async () => {
  const plan = { manifest: { name: 'tools' }, reviewHash: 'tools-hash', capabilities: ['runtime.mcp.stdio:data:{}'], addedCapabilities: ['runtime.mcp.stdio:data:{}'], diagnostics: [], installed: false };
  const installed = {
    id: 'plugin:tools', pluginId: 'tools', format: 'agent-plugin', name: 'tools', version: '1.0.0', source: 'agent-plugin', active: false,
    activationEligible: false, readiness: 'setup_required', hasUi: false, components: { skills: [], mcp: [{ name: 'data', id: 'plugin/tools/data', type: 'stdio' }] }, diagnostics: [],
  };
  mocks.request
    .mockResolvedValueOnce({ ok: true, payload: plan })
    .mockResolvedValueOnce({ ok: true, payload: installed })
    .mockResolvedValueOnce({ ok: true, payload: { ...installed, active: true, activationEligible: true } });

  await render(<AgentPluginDialog
    initialSource="store:tools"
    autoInstall
    marketplace={{
      id: 'tools', name: 'Tools', type: 'plugin', description: 'Local tools', readme: null, downloads: 1,
      author: { username: 'xopc', avatarUrl: null }, publisher: { verification: 'verified', sourceRepository: null },
      latestVersion: { version: '1.0.0', changelog: null, publishedAt: '2026-09-30', riskTier: 'local-exec' },
      installability: { available: true },
    }}
    onClose={() => {}}
  />);
  await act(async () => {});

  expect(document.body.textContent).toContain('Your authorization is required');
  expect(document.body.textContent).toContain('Run a local tool service: data');
  expect(mocks.request).toHaveBeenCalledTimes(1);
  await click('Authorize and install');
  expect(mocks.request).toHaveBeenCalledTimes(3);
  expect(document.body.textContent).toContain('Plugin installed and enabled');
});
it('supports native package picking and dropped plugin paths in the desktop app', async () => {
  const openDirectory = vi.fn().mockResolvedValue('/tmp/chosen-plugin');
  const getPathForFile = vi.fn().mockReturnValue('/tmp/dropped-plugin.zip');
  window.electronAPI = { file: { openDirectory, getPathForFile } } as unknown as Window['electronAPI'];
  await render(<AgentPluginDialog onClose={() => {}} />);

  await click('Choose directory');
  await act(async () => {});
  expect(openDirectory).toHaveBeenCalled();
  expect((document.querySelector('input[placeholder="/plugin/folder/or/plugin.zip"]') as HTMLInputElement).value).toBe('/tmp/chosen-plugin');

  const drop = new Event('drop', { bubbles: true, cancelable: true });
  const file = new File(['plugin'], 'plugin.zip', { type: 'application/zip' });
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file], getData: () => '' } });
  await act(async () => document.querySelector('[data-testid="plugin-source-dropzone"]')!.dispatchEvent(drop));
  expect(getPathForFile).toHaveBeenCalledWith(file);
  expect((document.querySelector('input[placeholder="/plugin/folder/or/plugin.zip"]') as HTMLInputElement).value).toBe('/tmp/dropped-plugin.zip');
});
it('provides native MCP login instructions and clears a saved API key', async () => {
  mocks.request.mockResolvedValue({ ok: true });
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, payload: { toolCount: 2 } }) });
  await render(<PluginMcpConnection pluginId="sample" server={{ id: 'plugin/sample/main', name: 'main', type: 'streamable-http' }} enabled />);
  expect(document.body.textContent).toContain('xopc mcp login');
  await input(document.querySelector('input[type=password]')!, 'private-token');
  await click('Save API key');
  expect(mocks.request).toHaveBeenCalledWith('/api/extensions/agent-plugins/sample/mcp/main/auth', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('private-token') }));
  expect((document.querySelector('input[type=password]') as HTMLInputElement).value).toBe('');
  expect(document.body.textContent).not.toContain('private-token');
  expect(mocks.fetch).not.toHaveBeenCalled();
});

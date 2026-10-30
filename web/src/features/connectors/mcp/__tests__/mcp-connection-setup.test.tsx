// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom';
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';
import { messages } from '@/i18n/messages';
import { CustomMcpServerDialog } from '../../custom-mcp-server-dialog';
import { emptyMcpServerRow, normalizeMcpSettingsFromConfig } from '../mcp-config-api';

const api = vi.hoisted(() => ({ patchMcpSettings: vi.fn(), createMcpConnectionDraft: vi.fn(), commitMcpDraft: vi.fn(), deleteMcpDraft: vi.fn(), probeMcpDraft: vi.fn(), startMcpDraftSignIn: vi.fn(),
  fetchMcpDraftTools: vi.fn(), fetchMcpTools: vi.fn(), readMcpDraftSignIn: vi.fn(), cancelMcpDraftSignIn: vi.fn(), submitMcpDraftRedirect: vi.fn() }));
vi.mock('../mcp-config-api', async original => ({ ...await original<typeof import('../mcp-config-api')>(), ...api }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const m = messages('zh'); const t = m.mcpSettings;
beforeEach(() => {
  useLocaleStore.setState({ language: 'zh' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  Object.values(api).forEach(mock => mock.mockReset()); api.createMcpConnectionDraft.mockResolvedValue({ id: 'draft-1', serverId: 'docs', expiresAt: Date.now() + 600_000 });
  api.commitMcpDraft.mockResolvedValue(undefined); api.deleteMcpDraft.mockResolvedValue(undefined); api.cancelMcpDraftSignIn.mockResolvedValue(undefined);
  api.fetchMcpDraftTools.mockResolvedValue([{ name: 'search_docs', description: '搜索文档', inputSchema: {} }]); api.fetchMcpTools.mockResolvedValue([{ name: 'search_docs', description: '搜索文档', inputSchema: {} }]);
  api.probeMcpDraft.mockResolvedValue({ state: 'connected', toolCount: 8 });
  vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); });
async function render(overrides: Partial<ComponentProps<typeof CustomMcpServerDialog>> = {}) {
  const onSaved = vi.fn(async () => {}); const onClose = vi.fn();
  await act(async () => root.render(<MemoryRouter><CustomMcpServerDialog open mode="add" initialRow={emptyMcpServerRow()} existingCustomServers={[]}
    config={{}} managedServerIds={new Set()} t={t} cs={m.connectorsSettings} onClose={onClose} onSaved={onSaved} {...overrides} /></MemoryRouter>));
  return { onSaved, onClose };
}
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function button(label: string) { return Array.from(document.querySelectorAll('button')).find(item => item.textContent?.replace(/^\+ /, '') === label)!; }
async function click(label: string) { expect(button(label), label).toBeTruthy(); await act(async () => button(label).click()); }
function input(label: string) {
  return Array.from(document.querySelectorAll('label')).find(item => item.textContent?.startsWith(label))!.querySelector('input')!;
}
async function auth(label: string) {
  const control = Array.from(document.querySelectorAll('label')).find(item => item.textContent?.startsWith(t.setupAuthLabel))!.querySelector('button')!;
  await act(async () => control.click()); await click(label);
}
async function address() { await type(document.querySelector<HTMLInputElement>('input[placeholder="https://example.com/mcp"]')!, 'mcp.example.com/tools'); }
async function connect() { await address(); await click(t.setupTestConnection); }

it('saves an address with a generated ID, keeps advanced fields collapsed and clearly labels the operation', async () => {
  const { onSaved, onClose } = await render();
  expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));
  expect(Array.from(document.querySelectorAll('details')).every(item => !item.open)).toBe(true);
  expect(document.body.textContent).toContain(t.setupTestNotice);
  await connect();
  expect(api.createMcpConnectionDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'mcp_example_com', url: 'https://mcp.example.com/tools' }), undefined, {}, expect.any(AbortSignal));
  expect(api.patchMcpSettings).not.toHaveBeenCalled(); expect(api.commitMcpDraft).not.toHaveBeenCalled();
  expect(api.probeMcpDraft).toHaveBeenCalledWith('draft-1', expect.any(AbortSignal));
  expect(document.body.textContent).toContain('连接检查成功 · 发现 8 个工具'); expect(onSaved).not.toHaveBeenCalled();
  await click(t.setupAddConnection); expect(api.commitMcpDraft).toHaveBeenCalledWith('draft-1', false); expect(onSaved).toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('连接已保存，可以开始使用');
  expect(document.querySelector('a[href*="chat/new"]')).toBeTruthy();
  await click(t.setupClose); expect(onClose).toHaveBeenCalled();
});

it('allows Bearer entry before connecting, keeps prefix singular and invalidates old success when editing', async () => {
  await render(); await address(); await auth('Bearer Token');
  await click(t.setupTestConnection);
  expect(api.patchMcpSettings).not.toHaveBeenCalled();
  await type(input(t.setupTokenLabel), 'Bearer my-token'); await click(t.setupTestConnection);
  expect(api.createMcpConnectionDraft.mock.calls[0][0].headers).toEqual([expect.objectContaining({ key: 'Authorization', value: 'Bearer my-token' })]);
  expect(api.startMcpDraftSignIn).not.toHaveBeenCalled();
  await type(input(t.setupNameLabel), '新名称');
  expect(document.body.textContent).not.toContain('连接检查成功 ·');
});

it('supports a service-specific API Key header without sending inactive Bearer credentials', async () => {
  await render(); await address(); await auth('Bearer Token'); await type(input(t.setupTokenLabel), 'unused-token');
  await auth('API Key'); await type(input(t.setupApiKeyHeader), 'X-Service-Key'); await type(input('API Key'), 'service-key');
  await click(t.setupTestConnection);
  expect(api.createMcpConnectionDraft.mock.calls[0][0].headers).toEqual([expect.objectContaining({ key: 'X-Service-Key', value: 'service-key' })]);
  expect(JSON.stringify(api.createMcpConnectionDraft.mock.calls[0])).not.toContain('unused-token');
});

it('keeps generic credential failures neutral instead of assuming Bearer is required', async () => {
  api.probeMcpDraft.mockResolvedValue({ state: 'token_required' });
  await render(); await connect();
  expect(document.body.textContent).toContain(t.setupNeedsAuth);
  expect(document.querySelector('input[type="password"]')).toBeNull();
  await auth('API Key'); expect(input(t.setupApiKeyHeader)).toBeTruthy();
});

it('lets the user cancel a pending check and keep editing without accepting stale results', async () => {
  let resolve!: (result: { state: 'connected'; toolCount: number }) => void;
  api.probeMcpDraft.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await render(); await connect();
  const signal = api.probeMcpDraft.mock.calls[0][1] as AbortSignal;
  expect(document.body.textContent).toContain(t.setupChecking);
  await click(m.connectorsSettings.modalCancel);
  expect(signal.aborted).toBe(true);
  await click(t.setupKeepEditing);
  await act(async () => resolve({ state: 'connected', toolCount: 8 }));
  expect(document.body.textContent).not.toContain(t.setupConnected.replace('{{count}}', '8'));
  expect(button(t.setupTestConnection).disabled).toBe(false);
  expect(api.commitMcpDraft).not.toHaveBeenCalled();
});

it('keeps saved configuration after a failed check and does not expose raw credentials in errors', async () => {
  api.probeMcpDraft.mockResolvedValue({ state: 'error', error: 'request https://example.com/?token=super-secret failed' });
  const { onClose } = await render(); await connect();
  expect(document.body.textContent).toContain(t.setupTestFailure);
  expect(api.commitMcpDraft).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('super-secret');
  await click(m.connectorsSettings.modalCancel); await click(t.setupDiscard); expect(onClose).toHaveBeenCalled();
});

it('distinguishes save failure from a persisted connection failure', async () => {
  api.commitMcpDraft.mockRejectedValue(new Error('secret storage failed'));
  await render(); await connect(); await click(t.setupAddConnection);
  expect(document.body.textContent).toContain(t.setupSaveFailed);
  expect(document.body.textContent).not.toContain(t.setupSavedFailure); expect(api.probeMcpDraft).toHaveBeenCalled();
});

it('tests disabled servers without enabling them and saves only after explicit confirmation', async () => {
  const server = normalizeMcpSettingsFromConfig({ mcp: { servers: { docs: { url: 'https://example.com/mcp', enabled: false, toolExposure: { write: 'hidden' } } } } }).servers[0];
  await render({ mode: 'edit', initialRow: server, existingCustomServers: [server] });
  await type(input(t.setupNameLabel), '团队知识库'); await click(t.setupTestConnection);
  expect(api.createMcpConnectionDraft.mock.calls[0][0]).toMatchObject({ id: 'docs', displayName: '团队知识库', extra: { enabled: false, toolExposure: { write: 'hidden' } } });
  expect(api.commitMcpDraft).not.toHaveBeenCalled();
  await click(t.setupSaveOnly); expect(api.commitMcpDraft).toHaveBeenCalledWith('draft-1', false);
  expect(document.querySelector('a[href*="chat/new"]')).toBeNull();
  expect(document.body.textContent).not.toContain('连接已保存，可以开始使用');
});

it('shows the saved last check when reopening an unchanged connection', async () => {
  const server = normalizeMcpSettingsFromConfig({ mcp: { servers: { docs: { url: 'https://example.com/mcp' } } } }).servers[0];
  await render({ mode: 'edit', initialRow: server, existingCustomServers: [server], lastCheck: { checkedAt: '2026-10-17T01:00:00Z', toolCount: 3 } });
  expect(document.body.textContent).toContain(t.setupLastCheck.replace('{{count}}', '3'));
  expect(document.body.textContent).not.toContain(t.setupSavedUnchecked);
  expect(api.probeMcpDraft).not.toHaveBeenCalled();
  expect(api.commitMcpDraft).not.toHaveBeenCalled();
});

it('requires a successful test before an explicit enable-and-save action', async () => {
  const server = normalizeMcpSettingsFromConfig({ mcp: { servers: { docs: { url: 'https://example.com/mcp', enabled: false } } } }).servers[0];
  await render({ mode: 'edit', initialRow: server, existingCustomServers: [server] });
  expect(button(t.setupEnableSave)).toBeUndefined(); await click(t.setupTestConnection); await click(t.setupEnableSave);
  expect(api.commitMcpDraft).toHaveBeenCalledWith('draft-1', true);
  expect(document.querySelector('a[href*="chat/new"]')).toBeTruthy();
});

it('preserves provider auth and reference credentials when editing unrelated fields', async () => {
  const reference = { xopcSecretRef: { provider: 'vendor', fieldKey: 'apiKey' } };
  const server = normalizeMcpSettingsFromConfig({ mcp: { servers: { docs: { url: 'https://example.com/mcp', headers: { Authorization: reference }, auth: { provider: 'vendor' } } } } }).servers[0];
  await render({ mode: 'edit', initialRow: server, existingCustomServers: [server] });
  expect(document.body.textContent).toContain(t.setupExistingHint);
  await type(input(t.setupNameLabel), '文档'); await click(t.setupTestConnection);
  expect(api.createMcpConnectionDraft.mock.calls[0][0]).toMatchObject({ headers: [expect.objectContaining({ reference })], extra: { auth: { provider: 'vendor' } } });
});

it('previews multiple imported services and only applies the explicitly selected service', async () => {
  await render(); await click(t.setupImport);
  await type(document.querySelector('textarea')!, JSON.stringify({ mcpServers: { first: { url: 'https://first.example/mcp?token=secret' }, second: { command: 'node', args: ['server.js', 'C:\\folder with spaces'] } } }));
  await click(t.setupImportPreview);
  expect(api.patchMcpSettings).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(t.setupImportScope);
  expect(Array.from(document.querySelectorAll('p')).map(item => item.textContent).join(' ')).not.toContain('?token=secret');
  const chooser = Array.from(document.querySelectorAll('label')).find(item => item.textContent?.startsWith(t.setupImportChoose))!.querySelector('button')!;
  await act(async () => chooser.click()); await click('second'); await click(t.setupImportApply);
  expect(input(t.commandLabel).value).toBe('node'); await click(t.setupTestConnection);
  expect(api.createMcpConnectionDraft.mock.calls).toHaveLength(1);
  expect(api.createMcpConnectionDraft.mock.calls[0][0]).toMatchObject({ id: 'second', command: 'node', argsText: '["server.js","C:\\\\folder with spaces"]' });
});

it('retains input and configuration after an invalid import', async () => {
  await render(); await address(); await click(t.setupImport); await type(document.querySelector('textarea')!, '{invalid'); await click(t.setupImportPreview);
  expect(document.querySelector('textarea')!.value).toBe('{invalid'); expect(document.body.textContent).toContain(t.setupImportError);
  await click(t.setupImportBack); expect(input(t.urlLabel).value).toBe('mcp.example.com/tools');
});

it('shows command host guidance, edits argument boundaries individually and prevents duplicate environment variables', async () => {
  await render(); await click(t.setupUseCommand);
  expect(document.body.textContent).toContain(t.setupCommandHostHint);
  await type(input(t.commandLabel), 'node'); await click(t.setupAddArg);
  await type(document.querySelector<HTMLInputElement>(`input[aria-label="${t.argsLabel} 1"]`)!, 'C:\\folder with spaces');
  await type(document.querySelector<HTMLInputElement>('input[aria-label="变量名 1"]')!, 'TOKEN');
  await type(document.querySelector<HTMLInputElement>('input[aria-label="变量值 1"]')!, 'one');
  await click(t.setupAddEnv);
  await type(document.querySelector<HTMLInputElement>('input[aria-label="变量名 2"]')!, 'TOKEN');
  await click(t.setupTestConnection); expect(api.patchMcpSettings).not.toHaveBeenCalled();
});

it('offers browser sign-in and reports success only after authorized tools are verified', async () => {
  api.probeMcpDraft.mockResolvedValue({ state: 'oauth_required' });
  api.startMcpDraftSignIn.mockResolvedValue({ id: 'attempt', serverId: 'mcp_example_com', state: 'starting' });
  api.readMcpDraftSignIn.mockResolvedValue({ id: 'attempt', serverId: 'mcp_example_com', state: 'connected', toolCount: 3 });
  await render(); await connect(); await click(t.setupSignIn);
  expect(api.startMcpDraftSignIn).toHaveBeenCalledWith('draft-1');
  expect(document.body.textContent).toContain('连接检查成功 · 发现 3 个工具'); expect(api.cancelMcpDraftSignIn).not.toHaveBeenCalled();
});

it('lets users cancel authorization and ignores a late successful response', async () => {
  let finish: (value: unknown) => void = () => {};
  api.probeMcpDraft.mockResolvedValue({ state: 'oauth_required' });
  api.startMcpDraftSignIn.mockResolvedValue({ id: 'waiting', serverId: 'mcp_example_com', state: 'starting' });
  api.readMcpDraftSignIn.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render(); await connect(); await click(t.setupSignIn); await click(t.setupCancelAuth);
  await act(async () => finish({ id: 'waiting', state: 'connected', toolCount: 99 }));
  expect(api.cancelMcpDraftSignIn).toHaveBeenCalledWith('draft-1'); expect(document.body.textContent).not.toContain('发现 99');
});

it('cancels pending authorization on unmount and shows callback fallback only when accepted', async () => {
  api.probeMcpDraft.mockResolvedValue({ state: 'oauth_required' });
  api.startMcpDraftSignIn.mockResolvedValue({ id: 'waiting', serverId: 'mcp_example_com', state: 'starting' });
  api.readMcpDraftSignIn.mockResolvedValue({ id: 'waiting', serverId: 'mcp_example_com', state: 'authorizing', authorizationUrl: 'https://example.com/authorize', acceptsRedirect: true });
  await render(); await connect(); await click(t.setupSignIn);
  expect(document.body.textContent).toContain(t.setupRemoteFallback);
  await act(async () => root.unmount()); root = createRoot(container);
  expect(api.deleteMcpDraft).toHaveBeenCalledWith('draft-1');
});

it('asks before discarding local changes and distinguishes zero tools from available tools', async () => {
  api.probeMcpDraft.mockResolvedValue({ state: 'connected', toolCount: 0 });
  const { onClose } = await render(); await address(); await click(m.connectorsSettings.modalCancel);
  expect(document.body.textContent).toContain(t.setupUnsavedTitle); expect(onClose).not.toHaveBeenCalled();
  await click(t.setupKeepEditing); await click(t.setupTestConnection);
  expect(document.body.textContent).toContain(t.setupZeroTools);
});

it('rejects duplicate authorization headers, focuses the authentication controls, and allows correction', async () => {
  await render(); await address(); await auth('Bearer Token'); await type(input(t.setupTokenLabel), 'secret-token');
  const advanced = document.querySelector<HTMLDetailsElement>('details')!;
  await act(async () => { advanced.open = true; });
  await click(t.addHeader);
  await type(document.querySelector<HTMLInputElement>(`input[aria-label="${t.headerKeyPlaceholder} 1"]`)!, 'authorization');
  await type(document.querySelector<HTMLInputElement>(`input[aria-label="${t.headerValuePlaceholder} 1"]`)!, 'second-token');
  await click(t.setupTestConnection);
  expect(api.patchMcpSettings).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(t.setupHeaderInvalid);
  expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
});

it('submits remote callback URLs, keeps invalid input for retry, and can reopen authorization after popup blocking', async () => {
  api.probeMcpDraft.mockResolvedValue({ state: 'oauth_required' });
  api.startMcpDraftSignIn.mockResolvedValue({ id: 'remote', serverId: 'mcp_example_com', state: 'starting' });
  api.readMcpDraftSignIn.mockResolvedValue({ id: 'remote', serverId: 'mcp_example_com', state: 'authorizing', authorizationUrl: 'https://example.com/authorize', acceptsRedirect: true });
  await render(); await connect(); await click(t.setupSignIn);
  await click(t.oauthOpenAuthorization);
  expect(window.open).toHaveBeenCalledWith('https://example.com/authorize', '_blank', 'noopener,noreferrer');
  api.submitMcpDraftRedirect.mockRejectedValueOnce(new Error('bad redirect')).mockResolvedValueOnce(undefined);
  const redirect = input(t.setupRedirectLabel);
  await type(redirect, 'http://127.0.0.1/callback?code=fixture&state=fixture');
  await click(t.setupContinue); expect(redirect.value).not.toBe(''); expect(document.body.textContent).toContain(t.setupRedirectInvalid);
  await click(t.setupContinue); expect(api.submitMcpDraftRedirect).toHaveBeenCalledWith('draft-1', 'http://127.0.0.1/callback?code=fixture&state=fixture');
  expect(redirect.value).toBe('');
});

it('shows a persisted reload failure honestly, disables resaving, and permits closing without discarding saved work', async () => {
  api.commitMcpDraft.mockResolvedValueOnce({ serverId: 'docs', reloadRequired: true });
  const { onClose } = await render(); await connect(); await click(t.setupAddConnection);
  expect(document.body.textContent).toContain(t.setupReloadRequired);
  expect(button(t.setupAddConnection)).toBeUndefined(); expect(button(t.setupTestConnection)).toBeUndefined();
  await click(t.setupClose); expect(onClose).toHaveBeenCalled(); expect(document.body.textContent).not.toContain(t.setupUnsavedTitle);
  expect(api.commitMcpDraft).toHaveBeenCalledTimes(1);
});

it('prevents restarting authorization until the pending cancellation has completed', async () => {
  api.probeMcpDraft.mockResolvedValue({ state: 'oauth_required' });
  api.startMcpDraftSignIn.mockResolvedValue({ id: 'waiting', state: 'starting' });
  api.readMcpDraftSignIn.mockReturnValue(new Promise(() => {}));
  let finish: () => void = () => {};
  api.cancelMcpDraftSignIn.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  await render(); await connect(); await click(t.setupSignIn); await click(t.setupCancelAuth);
  expect(button(t.setupSignIn).disabled).toBe(true);
  await act(async () => finish()); expect(button(t.setupSignIn).disabled).toBe(false);
});


it('discards the old draft after an authorization polling failure before allowing a fresh attempt', async () => {
  api.probeMcpDraft.mockResolvedValue({ state: 'oauth_required' });
  api.startMcpDraftSignIn.mockResolvedValue({ id: 'auth-1', state: 'starting' });
  api.readMcpDraftSignIn.mockRejectedValue(new Error('network failed'));
  api.deleteMcpDraft.mockReturnValueOnce(new Promise(() => {}));
  await render(); await connect(); await click(t.setupSignIn);
  expect(document.body.textContent).toContain(t.setupAuthFailed);
  expect(api.deleteMcpDraft).toHaveBeenCalledWith('draft-1');
  expect(api.cancelMcpDraftSignIn).not.toHaveBeenCalled();
  expect(button(t.setupSignIn)).toBeUndefined();
  api.createMcpConnectionDraft.mockResolvedValueOnce({ id: 'draft-2', serverId: 'docs' });
  api.probeMcpDraft.mockResolvedValueOnce({ state: 'connected', toolCount: 4 });
  await click(t.setupTestConnection); await click(t.setupAddConnection);
  expect(api.commitMcpDraft).toHaveBeenCalledWith('draft-2', false);
});


it.each([
  [429, 'setupRateLimited'], [401, 'setupGatewayUnauthorized'], [404, 'setupConflict'], [503, 'setupGatewayCheckFailed'],
] as const)('explains Gateway HTTP %s without showing raw errors or attempting a commit', async (status, key) => {
  api.createMcpConnectionDraft.mockRejectedValueOnce(Object.assign(new Error('private-url?token=fixture-secret'), { status }));
  await render(); await connect();
  expect(document.body.textContent).toContain(t[key]);
  expect(document.body.textContent).not.toContain('fixture-secret');
  expect(api.commitMcpDraft).not.toHaveBeenCalled();
});

it.each([
  ['tls', 'setupTlsFailed'], ['network', 'setupServiceNetworkFailed'], ['not_found', 'setupEndpointNotFound'],
  ['rate_limited', 'setupServiceRateLimited'], ['invalid_response', 'setupInvalidResponse'],
] as const)('explains the safe %s service failure category and preserves unsaved inputs', async (errorCode, key) => {
  api.probeMcpDraft.mockResolvedValueOnce({ state: 'error', errorCode, error: 'private-url?token=fixture-secret' });
  await render(); await connect();
  expect(document.body.textContent).toContain(t[key]);
  expect(document.body.textContent).not.toContain('fixture-secret');
  expect(document.querySelector<HTMLInputElement>('input[placeholder="https://example.com/mcp"]')!.value).toContain('mcp.example.com');
  expect(api.commitMcpDraft).not.toHaveBeenCalled();
});

it('distinguishes browser-to-Gateway network failure from an MCP service rejection', async () => {
  api.createMcpConnectionDraft.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await render(); await connect();
  expect(document.body.textContent).toContain(t.setupGatewayNetworkFailed);
});


it('keeps a legacy service fetch failure distinct from browser-to-Gateway connectivity', async () => {
  api.probeMcpDraft.mockResolvedValueOnce({ state: 'error', error: 'fetch failed' });
  await render(); await connect();
  expect(document.body.textContent).toContain(t.setupServiceNetworkFailed);
  expect(document.body.textContent).not.toContain(t.setupGatewayNetworkFailed);
});

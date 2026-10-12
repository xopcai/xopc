// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import { CustomMcpServerDialog } from '../../custom-mcp-server-dialog';
import { emptyMcpServerRow } from '../mcp-config-api';

const api = vi.hoisted(() => ({ patchMcpSettings: vi.fn(), probeMcpServer: vi.fn(), startMcpSignIn: vi.fn(),
  readMcpSignIn: vi.fn(), cancelMcpSignIn: vi.fn(), submitMcpSignInRedirect: vi.fn() }));
vi.mock('../mcp-config-api', async original => ({ ...await original<typeof import('../mcp-config-api')>(), ...api }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.clearAllMocks(); api.patchMcpSettings.mockResolvedValue(undefined); api.cancelMcpSignIn.mockResolvedValue(undefined);
  api.probeMcpServer.mockResolvedValue({ state: 'connected', toolCount: 8 });
  vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); });
async function render() {
  const m = messages('zh'); const onSaved = vi.fn(async () => {});
  await act(async () => root.render(<CustomMcpServerDialog open mode="add" initialRow={emptyMcpServerRow()} existingCustomServers={[]}
    config={{}} managedServerIds={new Set()} t={m.mcpSettings} cs={m.connectorsSettings} onClose={() => {}} onSaved={onSaved} />));
  return onSaved;
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function button(label: string) { return Array.from(document.querySelectorAll('button')).find(item => item.textContent === label)!; }
async function connect() {
  await type(document.querySelector<HTMLInputElement>('input[placeholder="https://example.com/mcp"]')!, 'mcp.example.com/tools');
  await act(async () => button('连接').click());
}
it('connects with only an address and keeps manual fields collapsed', async () => {
  const onSaved = await render();
  expect(Array.from(document.querySelectorAll('details')).every(item => !item.open)).toBe(true);
  expect(Array.from(document.querySelectorAll('input')).filter(input => !input.closest('details'))).toHaveLength(1);
  await connect();
  expect(api.patchMcpSettings).toHaveBeenCalledWith(expect.objectContaining({ servers: [expect.objectContaining({ id: 'mcp_example_com', url: 'https://mcp.example.com/tools' })] }), {});
  expect(api.probeMcpServer).toHaveBeenCalledWith('mcp_example_com', expect.any(AbortSignal));
  expect(document.body.textContent).toContain('已连接 · 8 个可用工具'); expect(onSaved).toHaveBeenCalled();
});
it('asks for a token only when required and creates the Authorization header', async () => {
  api.probeMcpServer.mockResolvedValueOnce({ state: 'token_required' });
  await render(); await connect();
  const token = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(token).toBeTruthy(); expect(button('连接').disabled).toBe(true); await type(token, 'my-token');
  await act(async () => button('连接').click());
  expect(api.patchMcpSettings.mock.calls[1][0].servers[0].headers).toEqual([expect.objectContaining({ key: 'Authorization', value: 'Bearer my-token' })]);
  expect(api.startMcpSignIn).not.toHaveBeenCalled();
});
it('keeps local command setup available and names it automatically', async () => {
  await render();
  await act(async () => button('改用本地命令').click());
  const label = Array.from(document.querySelectorAll('label')).find(item => item.textContent?.startsWith('命令'))!;
  await type(label.querySelector('input')!, 'npx');
  await act(async () => button('连接').click());
  expect(api.patchMcpSettings.mock.calls[0][0].servers[0]).toMatchObject({ id: 'npx', transport: 'stdio', command: 'npx' });
});
it('offers browser sign-in and automatically verifies the authorized tools', async () => {
  api.probeMcpServer.mockResolvedValue({ state: 'oauth_required' });
  api.startMcpSignIn.mockResolvedValue({ id: 'attempt', serverId: 'mcp_example_com', state: 'starting' });
  api.readMcpSignIn.mockResolvedValue({ id: 'attempt', serverId: 'mcp_example_com', state: 'connected', toolCount: 3 });
  await render(); await connect();
  await act(async () => button('登录并连接').click());
  expect(api.startMcpSignIn).toHaveBeenCalledWith('mcp_example_com');
  expect(document.body.textContent).toContain('已连接 · 3 个可用工具');
  expect(api.cancelMcpSignIn).not.toHaveBeenCalled();
});
it('cancels an unfinished authorization when the dialog closes', async () => {
  api.probeMcpServer.mockResolvedValue({ state: 'oauth_required' });
  api.startMcpSignIn.mockResolvedValue({ id: 'waiting', serverId: 'mcp_example_com', state: 'starting' });
  api.readMcpSignIn.mockResolvedValue({ id: 'waiting', serverId: 'mcp_example_com', state: 'authorizing', authorizationUrl: 'https://example.com/authorize', acceptsRedirect: true });
  await render(); await connect(); await act(async () => button('登录并连接').click());
  expect(document.body.textContent).toContain('已授权，但连接仍在等待？');
  await act(async () => root.unmount()); root = createRoot(container);
  expect(api.cancelMcpSignIn).toHaveBeenCalledWith('waiting');
});

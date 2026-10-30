// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import type { ConnectorHealthResult, ConnectorInstance } from '../connectors-api';
import { InstalledConnectorDetailDialog } from '../components/installed-connector-detail-dialog';

const { testConnector } = vi.hoisted(() => ({ testConnector: vi.fn() }));
vi.mock('../connectors-api', async original => ({
  ...await original<typeof import('../connectors-api')>(), testConnector,
}));
vi.mock('../mcp/mcp-config-api', () => ({ fetchMcpTools: vi.fn(async () => []) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.clearAllMocks(); });

const instance = { instanceId: 'railway_12306', connectorId: 'railway-12306', displayName: '12306', enabled: true,
  status: 'installed', connectionStatus: 'unknown', materialized: { type: 'mcp', serverId: 'railway_12306' }, usage: {},
} as ConnectorInstance;

async function renderDialog() {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const onChanged = vi.fn(async () => {});
  const m = messages('zh');
  await act(async () => root!.render(<MemoryRouter><InstalledConnectorDetailDialog instance={instance} onClose={() => {}}
    onChanged={onChanged} t={m.connectorsSettings} mcp={m.mcpSettings} /></MemoryRouter>));
  const button = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '测试')!;
  return { button, onChanged };
}

it('lets an installed MCP leave pending status through an explicit test and refreshes the list', async () => {
  let finish!: (value: Partial<ConnectorHealthResult>) => void;
  testConnector.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { button, onChanged } = await renderDialog();
  await act(async () => button.click());
  expect(button.disabled).toBe(true);
  expect(testConnector).toHaveBeenCalledWith('railway_12306');
  await act(async () => finish({ ok: true, status: 'ok', toolCount: 8 }));
  expect(button.disabled).toBe(false);
  expect(document.querySelector('[role="status"]')?.textContent).toContain('8');
  expect(onChanged).toHaveBeenCalledOnce();
});

it('shows the connection error and allows another test after failure', async () => {
  testConnector.mockResolvedValue({ ok: false, status: 'startup_failed', error: 'Could not start MCP server' });
  const { button, onChanged } = await renderDialog();
  await act(async () => button.click());
  expect(document.body.textContent).toContain('Could not start MCP server');
  expect(button.disabled).toBe(false);
  expect(onChanged).toHaveBeenCalledOnce();
});

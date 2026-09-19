// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import * as api from '../connectors-api';
import { ComposioConnectorPanel } from '../components/composio-connector-panel';

vi.mock('../connectors-api', async importOriginal => ({
  ...await importOriginal<typeof import('../connectors-api')>(),
  listComposioConnections: vi.fn(), getComposioScope: vi.fn(), getComposioPolicy: vi.fn(),
  getComposioHealth: vi.fn(), listComposioTools: vi.fn(), listComposioTriggerEvents: vi.fn(),
  getComposioToolkitAuthState: vi.fn(), listConnectorLearningJobs: vi.fn(), getConnectorSyncPolicy: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const t = messages('zh').connectorsSettings;
const instance = { instanceId: 'gmail', connectorId: 'composio-gmail', config: {}, materialized: { type: 'composio', role: 'toolkit', toolkit: 'gmail' } } as api.ConnectorInstance;
const account = { id: 'auth', accountId: 'account', toolkit: 'gmail', status: 'active', accountEmail: 'work@example.test', accountEnabled: true, allowedAgentIds: null, supportsLearning: false } as api.ComposioConnection;
beforeEach(() => {
  vi.useFakeTimers(); useLocaleStore.setState({ language: 'zh' });
  vi.mocked(api.listComposioConnections).mockResolvedValue([account]);
  vi.mocked(api.getComposioScope).mockResolvedValue('read');
  vi.mocked(api.getComposioPolicy).mockResolvedValue({ policy: { maxScope: 'read', allowedAgentIds: [], selectedAccountIds: null, confirmationPolicy: 'writes' }, agents: [] } as unknown as Awaited<ReturnType<typeof api.getComposioPolicy>>);
  for (const read of [api.getComposioHealth, api.listComposioTools, api.listComposioTriggerEvents, api.getComposioToolkitAuthState]) vi.mocked(read).mockImplementation(() => new Promise<never>(() => {}));
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.clearAllMocks(); vi.useRealTimers(); });
async function render() { await act(async () => root.render(<ComposioConnectorPanel instance={instance} t={t} />)); }
it('shows accounts without requesting advanced diagnostics', async () => {
  await render();
  expect(container.textContent).toContain('work@example.test');
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(api.getComposioHealth).not.toHaveBeenCalled();
  expect(api.listComposioTools).not.toHaveBeenCalled();
  expect(api.getComposioToolkitAuthState).not.toHaveBeenCalled();
  const summary = [...container.querySelectorAll('summary')].filter(node => node.textContent === t.composioAdvancedSettings).at(-1)!;
  await act(async () => { const details = summary.parentElement as HTMLDetailsElement; details.open = true; details.dispatchEvent(new Event('toggle')); });
  expect(api.listComposioTools).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('work@example.test');
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(container.textContent).toContain(t.composioDiagnosticsUnavailable);
});
it('ends a hung account request, supports retry and ignores late results', async () => {
  let resolveOld!: (accounts: api.ComposioConnection[]) => void;
  vi.mocked(api.listComposioConnections).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  await render();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('响应超时');
  const retry = container.querySelector('[role="alert"] button') as HTMLButtonElement;
  await act(async () => retry.click());
  expect(container.textContent).toContain('work@example.test');
  await act(async () => resolveOld([{ ...account, accountEmail: 'stale@example.test' }]));
  expect(container.textContent).not.toContain('stale@example.test');
});
it('keeps loaded accounts visible when policy fails', async () => {
  vi.mocked(api.getComposioPolicy).mockRejectedValueOnce(new Error('Policy unavailable'));
  await render();
  expect(container.textContent).toContain('work@example.test');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Policy unavailable');
});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionWaitView } from '@xopcai/gateway-contract';
import { ConnectionActionBar } from '../connection-action-bar';

const mocked = vi.hoisted(() => ({
  state: { wait: null as ConnectionWaitView | null, isLoading: false, busy: false, error: undefined, act: vi.fn() },
  fetchPlan: vi.fn(),
}));
vi.mock('../use-connection-wait', () => ({ useConnectionWait: () => mocked.state }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (select: (state: { language: string }) => unknown) => select({ language: 'en' }) }));
vi.mock('@/features/connectors/connectors-api', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/connectors/connectors-api')>(),
  fetchStoreConnectorInstallPlan: mocked.fetchPlan,
}));
vi.mock('@/features/connectors/components/install-connector-dialog', () => ({
  InstallConnectorDialog: ({ onInstalled }: { onInstalled: (instance: { instanceId: string }) => Promise<void> }) => (
    <button type="button" onClick={() => void onInstalled({ instanceId: 'demo-instance' })}>Finish installation</button>
  ),
}));

describe('single connection action area', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const render = async () => { await act(async () => root.render(<ConnectionActionBar conversationId="one" />)); };
  const click = async (text: string) => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === text);
    expect(button, text).toBeTruthy();
    await act(async () => button!.click());
  };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    mocked.state.wait = {
      id: 'wait', conversationId: 'one', transcriptId: 'instance', principalId: 'local-owner', agentId: 'main', objectiveId: 'objective', objectiveRevision: 1, objectiveUpdatedAt: 1,
      originInputId: 'input', originRunId: 'run', summary: 'Summarize unread email from last week', status: 'open', phase: 'needs_connection', version: 1, createdAt: 1, updatedAt: 1,
      needs: [{ key: 'gmail', target: { type: 'connector', connectorId: 'composio-gmail' }, label: 'Gmail', capabilities: ['email.read'], phase: 'connect', accounts: [] }],
    };
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  it('keeps a single current action through repeated updates and clears it when resolved', async () => {
    for (let version = 1; version < 11; version++) { mocked.state.wait!.version = version; await render(); }
    expect(document.querySelectorAll('section[aria-label="Waiting for connection"]')).toHaveLength(1);
    await click('Connect Gmail');
    expect(mocked.state.act).toHaveBeenCalledWith('connect', 'gmail');
    mocked.state.wait = null; await render();
    expect(document.querySelector('section')).toBeNull();
  });
  it('lets the user skip without launching authorization', async () => {
    await render(); await click('Skip connection');
    expect(mocked.state.act).toHaveBeenCalledExactlyOnceWith('skip');
  });
  it('does not render a second continue action after the connection is ready', async () => {
    mocked.state.wait!.phase = 'ready';
    mocked.state.wait!.needs[0].phase = 'ready';
    await render();
    expect(container.querySelector('section')).toBeNull();
    expect(mocked.state.act).not.toHaveBeenCalled();
  });
  it('requires an explicit scope confirmation for a delayed objective', async () => {
    mocked.state.wait!.phase = 'review_scope'; mocked.state.wait!.needs[0].phase = 'ready';
    await render(); await click('Confirm and continue');
    expect(mocked.state.act).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('last week');
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(node => node.textContent === 'Confirm and continue') as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(mocked.state.act).toHaveBeenCalledWith('confirm_scope');
  });
  it('shows a tool retry instead of authorization when a connected app lacks its capability', async () => {
    mocked.state.wait!.needs[0] = { ...mocked.state.wait!.needs[0], phase: 'blocked', connectionId: 'account',
      capabilityError: 'Required message tools unavailable', reason: 'Required message tools unavailable', accounts: [{ id: 'account', label: 'User' }] };
    await render();
    expect(container.textContent).toContain('App tools unavailable');
    await click('Details');
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('without reconnecting');
    expect([...dialog.querySelectorAll('button')].some(button => button.textContent === 'Connect')).toBe(false);
    await click('Retry check');
    expect(mocked.state.act).toHaveBeenCalledExactlyOnceWith('check');
  });
  it('groups multiple apps behind one action area and keeps closing the dialog separate from cancellation', async () => {
    mocked.state.wait!.needs.push({ key: 'calendar', target: { type: 'connector', connectorId: 'composio-googlecalendar' }, label: 'Google Calendar', capabilities: ['calendar.read'], phase: 'connect', accounts: [] });
    await render(); await click('Details');
    expect(document.querySelectorAll('section')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Google Calendar');
    await act(async () => (document.querySelector('[aria-label="Close"]') as HTMLButtonElement).click());
    expect(mocked.state.act).not.toHaveBeenCalled();
    expect(document.querySelector('section')).not.toBeNull();
  });
  it('opens the reviewed Store installer and resumes the preserved objective after installation', async () => {
    mocked.state.act.mockResolvedValue(true);
    mocked.state.wait!.needs[0] = {
      key: 'store-demo',
      target: {
        type: 'store-connector', packageName: 'demo-connector', connectorId: 'demo-connector', version: '1.0.0',
        sha256: 'a'.repeat(64), reviewHash: 'b'.repeat(64), description: 'Demo tools',
      },
      label: 'Demo Connector', capabilities: ['tools'], phase: 'install', accounts: [],
    };
    mocked.fetchPlan.mockResolvedValue({
      packageName: 'demo-connector', version: '1.0.0', reviewHash: 'b'.repeat(64), permissions: {}, requiresRestart: false,
      definition: {
        id: 'demo-connector', version: '1.0.0', displayName: 'Demo Connector', description: 'Demo tools', category: 'custom',
        kind: 'mcp', source: 'store', capabilities: ['tools'], auth: { mode: 'none' }, setup: {},
        runtime: { type: 'mcp', serverId: 'demo' }, provenance: { packageName: 'demo-connector', sha256: 'a'.repeat(64) },
      },
    });

    await render();
    await click('Install Demo Connector');
    expect(mocked.fetchPlan).toHaveBeenCalledWith('demo-connector', '1.0.0');
    await click('Finish installation');
    expect(mocked.state.act).toHaveBeenCalledWith('install_complete', 'store-demo', undefined, undefined, undefined, 'demo-instance');
  });
});

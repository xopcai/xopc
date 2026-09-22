// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextEnvelope } from '@xopcai/gateway-contract';

import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { pageContextDrafts } from './page-context-draft';
import { PageContextCaptureButton } from './page-context-capture-button';

const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/capabilities', () => ({ readCapability: mocks.read }));
vi.mock('../session/session-manager', () => ({ SessionManager: class { createSession = mocks.create; } }));

function result(snapshot: AppContextEnvelope) {
  return { snapshot, resources: [{ reference: snapshot.resourceRefs[0], title: 'Verified title', text: 'Verified body', truncated: true }], selectionTrust: 'user-supplied' };
}
describe('explicit resource capture action', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.read.mockReset().mockImplementation(async (_id, snapshot) => result(snapshot));
    mocks.create.mockReset().mockResolvedValue({ key: 'new-chat' });
    pageContextDrafts.store.setState({ drafts: {} });
    useGatewayStore.setState({ baseUrl: 'http://fixture', conversationId: 'identity' });
    useLocaleStore.setState({ language: 'en' });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  async function render(kind: AppContextEnvelope['resourceRefs'][number]['kind'], disabled = false) {
    function Harness() {
      const location = useLocation();
      const navigate = useNavigate();
      return <><output>{location.pathname}</output><button data-leave onClick={() => navigate('/elsewhere')}>Leave</button>
        <PageContextCaptureButton resource={{ kind, id: 'resource', revision: '3' }} disabled={disabled} /></>;
    }
    await act(async () => root.render(<MemoryRouter initialEntries={['/resource']}><Harness /></MemoryRouter>));
  }
  async function click() { await act(async () => container.querySelector<HTMLButtonElement>('button[aria-busy]')!.click()); }

  it.each(['task', 'project', 'scene', 'local_app'] as const)('captures %s from the validated server preview', async kind => {
    await render(kind); await click();
    expect(mocks.read).toHaveBeenCalledWith('xopc.context.resolve', expect.objectContaining({ resourceRefs: [{ kind, id: 'resource', revision: '3' }] }));
    expect(mocks.create).toHaveBeenCalledWith();
    expect(container.querySelector('output')?.textContent).toBe('/chat/new-chat');
    expect(Object.values(pageContextDrafts.store.getState().drafts)).toMatchObject([{ title: 'Verified title', preview: 'Verified body', truncated: true }]);
  });

  it('keeps the page and offers retry when resolving fails', async () => {
    mocks.read.mockRejectedValueOnce(new Error('REVISION_CONFLICT'));
    await render('task'); await click();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('try again');
    expect(mocks.create).not.toHaveBeenCalled();
    await click();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it.each(['route', 'identity', 'unmount'] as const)('ignores resolution after a %s change', async change => {
    let finish!: () => void;
    mocks.read.mockImplementation((_id, snapshot) => new Promise(resolve => { finish = () => resolve(result(snapshot)); }));
    await render('task'); await click();
    await act(async () => {
      if (change === 'route') container.querySelector<HTMLButtonElement>('[data-leave]')!.click();
      else if (change === 'identity') useGatewayStore.setState({ conversationId: 'other' });
      else root.render(null);
    });
    await act(async () => finish());
    expect(mocks.create).not.toHaveBeenCalled();
    expect(pageContextDrafts.store.getState().drafts).toEqual({});
  });

  it('prevents duplicate capture and ignores a late session creation after logout', async () => {
    let finish!: () => void;
    mocks.create.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ key: 'late' }); }));
    await render('project'); await click(); await click();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await act(async () => useGatewayStore.setState({ conversationId: undefined }));
    await act(async () => finish());
    expect(container.querySelector('output')?.textContent).toBe('/resource');
    expect(pageContextDrafts.store.getState().drafts).toEqual({});
  });

  it('does not capture while editing is blocked', async () => {
    await render('scene', true); await click();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('rejects mismatched snapshots before creating a chat', async () => {
    mocks.read.mockImplementation(async (_id, snapshot) => result({ ...snapshot, sequence: snapshot.sequence + 1 }));
    await render('local_app'); await click();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

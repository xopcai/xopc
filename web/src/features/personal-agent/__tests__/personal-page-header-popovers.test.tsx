// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersonalTaskPanel } from '@/features/personal-agent/personal-task-panel';
import { PERSONAL_TASKS_TAB_ID, useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { PersonalPage } from '@/features/personal-agent/personal-page';
import { fetchJson } from '@/lib/fetch';
import { usePageHeaderStore } from '@/stores/page-header-store';

const { openVoiceCall, minimizeVoiceCall, callState } = vi.hoisted(() => ({
  openVoiceCall: vi.fn(), minimizeVoiceCall: vi.fn(), callState: { active: false, expanded: false },
}));

vi.mock('@/features/chat/chat-page', () => ({
  ChatPage: ({ personalWelcome }: { personalWelcome?: { addressAs?: string } }) => <div data-testid="personal-chat" data-user-name={personalWelcome?.addressAs} />,
}));
vi.mock('@/features/voice/realtime/voice-call-context', () => ({
  useVoiceCall: () => ({ ...callState, open: openVoiceCall, minimize: minimizeVoiceCall, setMiniAnchor: vi.fn() }),
}));
vi.mock('@/features/personal-agent/personal-avatar', () => ({
  PersonalAvatar: ({ appearance, className }: { appearance: string; className?: string }) => <span data-testid="personal-avatar" data-appearance={appearance} className={className} />,
}));
vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));

function TaskPanelHost() {
  const pane = useRightWorkspaceStore(state => state.panes['conversation-1']);
  return pane?.open && pane.activeId === PERSONAL_TASKS_TAB_ID
    ? <aside><PersonalTaskPanel scope="conversation-1" zh={false} /></aside> : null;
}

describe('Personal AI header', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let headerContainer: HTMLDivElement;
  let headerRoot: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useRightWorkspaceStore.getState().reset();
    callState.active = false;
    callState.expanded = false;
    minimizeVoiceCall.mockImplementation(() => { callState.expanded = false; });
    let revision = 1;
    vi.mocked(fetchJson).mockImplementation(async (url, options) => {
      if (String(url).includes('/activity')) return { ok: true, payload: { items: [], total: 0, current: [] } };
      if (String(url).includes('/clarification')) return { ok: true, payload: { clarification: null } };
      if (String(url).includes('/models')) return { ok: true, payload: [] };
      if (String(url).includes('/schedules')) return { ok: true, payload: [] };
      const body = options?.method === 'PATCH' ? JSON.parse(String(options.body)) : null;
      return { ok: true, payload: {
        agentId: 'personal',
        conversationId: 'conversation-1',
        state: 'ready',
        displayName: body?.displayName ?? 'Ada',
        userCallName: 'Shared name',
        appearance: body?.appearance ?? 'loopi',
        revision: body ? ++revision : revision,
        errorMessage: null,
      } };
    });
    container = document.createElement('div');
    headerContainer = document.createElement('div');
    document.body.append(container, headerContainer);
    root = createRoot(container);
    headerRoot = createRoot(headerContainer);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      headerRoot.unmount();
    });
    container.remove();
    headerContainer.remove();
    vi.clearAllMocks();
  });

  it.each(['assistant', 'natural'] as const)('starts one automatic Ada call regardless of the legacy mode (%s)', async mode => {
    const fetchPersonal = vi.mocked(fetchJson).getMockImplementation()!;
    vi.mocked(fetchJson).mockImplementation(async (url, options) => {
      if (String(url).includes('/api/voice/boson')) return { payload: { credentialSource: 'env', defaultForNatural: true, voice: 'default', legacyModel: null } };
      const result = await fetchPersonal(url, options) as { payload: Record<string, unknown> };
      if (String(url).endsWith('/api/personal-agent') && mode === 'natural') {
        return { ...result, payload: { ...result.payload, voiceCallPreferences: { openingGreetingEnabled: true, defaultMode: 'natural' } } };
      }
      return result;
    });
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><PersonalPage /></MemoryRouter></SWRConfig>));
    act(() => headerRoot.render(usePageHeaderStore.getState().end));
    expect(headerContainer.querySelector('button[aria-label="Choose call mode"]')).toBeNull();
    act(() => headerContainer.querySelector<HTMLButtonElement>('button[aria-label="Voice call"]')?.click());
    expect(openVoiceCall).toHaveBeenCalledExactlyOnceWith({
      conversationId: 'conversation-1', name: 'Ada',
    }, expect.objectContaining({ anchor: headerContainer.firstElementChild }));
  });

  it('keeps quick controls in settings and opens the settings page only for more settings', async () => {
    const label = 'Ada settings';
    function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
    await act(async () => root.render(<MemoryRouter initialEntries={['/personal']}><PersonalPage /><Location /></MemoryRouter>));
    act(() => headerRoot.render(<>{usePageHeaderStore.getState().main}{usePageHeaderStore.getState().end}</>));
    const trigger = [...headerContainer.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label);
    expect(trigger).toBeDefined();
    await act(async () => trigger!.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/personal');
    const quick = document.querySelector('[aria-label="Ada quick settings"]');
    expect(quick?.querySelector('[aria-label="Call engine"]')).not.toBeNull();
    expect(quick?.querySelector('[aria-label="Natural voice model"]')).not.toBeNull();
    expect(quick?.querySelector('#personal-name')).not.toBeNull();
    expect(quick?.textContent).not.toContain('API Key');
    expect(quick?.textContent).not.toContain('Privacy');
    const more = [...quick!.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'More settings');
    await act(async () => more!.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings/personal');
    expect(vi.mocked(fetchJson).mock.calls.some(([url, options]) => String(url).includes('/profile') && options?.method === 'PATCH')).toBe(false);
  });

  it('toggles the shared right-hand workspace from the avatar', async () => {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter initialEntries={['/personal']}><PersonalPage /><TaskPanelHost /></MemoryRouter></SWRConfig>));
    const renderHeader = () => act(() => headerRoot.render(usePageHeaderStore.getState().main));
    const trigger = () => headerContainer.querySelector<HTMLButtonElement>('[data-personal-tasks-trigger]');
    renderHeader();
    expect(trigger()?.textContent).toBe('Ada');
    expect(container.querySelector('aside')).toBeNull();

    await act(async () => trigger()!.click());
    renderHeader();
    expect(trigger()).toBeNull();
    expect(usePageHeaderStore.getState().personalChat).toBe('controls');
    expect(container.querySelector('aside [aria-label="Delegated tasks"]')).not.toBeNull();
    expect(container.querySelector('[data-personal-task-identity]')?.textContent).toBe('Ada');
    act(() => useRightWorkspaceStore.getState().openFiles('conversation-1'));
    renderHeader();
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('aside')).toBeNull();
    await act(async () => trigger()!.click());
    expect(useRightWorkspaceStore.getState().panes['conversation-1'].tabs.map(tab => tab.kind)).toEqual(['personal-tasks', 'files']);
    renderHeader();
    act(() => useRightWorkspaceStore.getState().setOpen(false, 'conversation-1'));
    renderHeader();
    expect(trigger()).not.toBeNull();
    expect(useRightWorkspaceStore.getState().panes['conversation-1'].open).toBe(false);
  });

  it('opens settings and calls beside the task panel', async () => {
    callState.active = true;
    callState.expanded = true;
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><PersonalPage /><TaskPanelHost /></MemoryRouter></SWRConfig>));
    const renderHeader = () => act(() => headerRoot.render(<>{usePageHeaderStore.getState().main}{usePageHeaderStore.getState().end}</>));
    const click = async (label: string) => {
      renderHeader();
      const button = [...headerContainer.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label);
      await act(async () => button!.click());
      renderHeader();
    };
    await click('Ada settings');
    expect(minimizeVoiceCall).toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Ada quick settings"]')).not.toBeNull();
    await click("Ada's tasks");
    expect(document.querySelector('[aria-label="Ada quick settings"]')).toBeNull();
    expect(document.querySelector('[aria-label="Delegated tasks"]')).not.toBeNull();
    await click('Ada settings');
    expect(document.querySelector('[aria-label="Delegated tasks"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Ada quick settings"]')).not.toBeNull();
    await click('Voice call');
    expect(openVoiceCall).toHaveBeenCalledExactlyOnceWith({ conversationId: 'conversation-1', name: 'Ada' },
      expect.objectContaining({ anchor: expect.any(HTMLElement) }));
    expect(document.querySelector('[aria-label="Delegated tasks"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Ada quick settings"]')).toBeNull();
  });

  it('updates the collapsed header and open panel as delegated work progresses', async () => {
    let finished = false;
    const fetchPersonal = vi.mocked(fetchJson).getMockImplementation()!;
    vi.mocked(fetchJson).mockImplementation(async (url, options) => {
      if (!String(url).includes('/activity')) return fetchPersonal(url, options);
      const task = { id: 'task-1', title: 'Research', updatedAt: Date.now() };
      return { ok: true, payload: finished
        ? { current: [], items: [{ ...task, phase: 'closed', resolution: 'done' }], total: 1 }
        : { current: [{ ...task, phase: 'active', operationalState: 'running' }], items: [], total: 0 } };
    });
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><PersonalPage /><TaskPanelHost /></MemoryRouter></SWRConfig>));
    act(() => headerRoot.render(usePageHeaderStore.getState().main));
    expect(headerContainer.textContent).toContain('Working · Research');
    expect(container.querySelector('aside')).toBeNull();
    await act(async () => headerContainer.querySelector<HTMLButtonElement>('[data-personal-tasks-trigger]')!.click());
    expect(container.querySelector('aside')?.textContent).toContain('Working');

    finished = true;
    await act(async () => {
      window.dispatchEvent(new CustomEvent('task-changed-v2'));
      await new Promise(resolve => setTimeout(resolve, 180));
    });
    act(() => headerRoot.render(usePageHeaderStore.getState().main));
    expect(container.querySelector('aside')?.textContent).toContain('Finished');
    expect([...container.querySelectorAll('aside h3')].map(node => node.textContent)).toEqual(['Scheduled tasks', 'Today']);
    const tabs = container.querySelectorAll('aside [aria-label="Tasks and deliverables"] [role="tab"]');
    expect([...tabs].map(tab => tab.textContent)).toEqual(['Tasks', 'Deliverables']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-personal-task-identity]')?.textContent).toContain('Just delivered');
    expect(headerContainer.textContent).not.toContain('Just delivered');
  });
});

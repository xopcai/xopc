// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersonalPage } from '@/features/personal-agent/personal-page';
import { fetchJson } from '@/lib/fetch';
import { usePageHeaderStore } from '@/stores/page-header-store';

const { openVoiceCall } = vi.hoisted(() => ({ openVoiceCall: vi.fn() }));

vi.mock('@/features/chat/chat-page', () => ({
  ChatPage: ({ personalWelcome }: { personalWelcome?: { addressAs?: string } }) => <div data-testid="personal-chat" data-user-name={personalWelcome?.addressAs} />,
}));
vi.mock('@/features/voice/realtime/voice-call-context', () => ({
  useVoiceCall: () => ({ active: false, open: openVoiceCall }),
}));
vi.mock('@/features/personal-agent/personal-avatar', () => ({
  PersonalAvatar: ({ appearance, className }: { appearance: string; className?: string }) => <span data-testid="personal-avatar" data-appearance={appearance} className={className} />,
}));
vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));

describe('Personal AI editor', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let headerContainer: HTMLDivElement;
  let headerRoot: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    let revision = 1;
    vi.mocked(fetchJson).mockImplementation(async (url, options) => {
      if (String(url).includes('/activity')) return { ok: true, payload: { items: [], total: 0 } };
      if (String(url).includes('/models')) return { ok: true, payload: [] };
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
    });
  });

  it.each(["Edit Ada's profile", 'Ada settings'])('keeps quick controls at %s and opens the settings page only for more settings', async label => {
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

  it('toggles the delegated tasks popover from the header button', async () => {
    await act(async () => {
      root.render(<MemoryRouter><PersonalPage /></MemoryRouter>);
    });
    act(() => headerRoot.render(usePageHeaderStore.getState().end));

    await act(async () => headerContainer.querySelector<HTMLButtonElement>('button[aria-label="Activity"]')?.click());
    act(() => headerRoot.render(usePageHeaderStore.getState().end));
    expect(document.querySelector('[data-radix-popper-content-wrapper] [aria-label="Delegated tasks"]')).not.toBeNull();
    expect(container.querySelector('aside')).toBeNull();
    expect(headerContainer.querySelector('button[aria-label="Activity"]')?.getAttribute('aria-pressed')).toBe('true');
    act(() => headerContainer.querySelector<HTMLButtonElement>('button[aria-label="Activity"]')?.click());
    act(() => headerRoot.render(usePageHeaderStore.getState().end));
    expect(document.querySelector('[data-radix-popper-content-wrapper] [aria-label="Delegated tasks"]')).toBeNull();
    expect(headerContainer.querySelector('button[aria-label="Activity"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('refreshes an open delegated task when its run finishes', async () => {
    let phase = 'active';
    let runStatus = 'running';
    let operationalState = 'running';
    vi.mocked(fetchJson).mockImplementation(async (url) => String(url).includes('/activity')
      ? { ok: true, payload: { items: [{ id: 'task-1', title: 'Research', phase, operationalState, runStatus, updatedAt: 1 }], total: 1 } }
      : String(url).includes('/models')
        ? { ok: true, payload: [] }
        : { ok: true, payload: { agentId: 'personal', conversationId: 'conversation-1',
          state: 'ready', displayName: 'Ada', appearance: 'loopi', revision: 1 } });
    await act(async () => root.render(<MemoryRouter><PersonalPage /></MemoryRouter>));
    act(() => headerRoot.render(<MemoryRouter>{usePageHeaderStore.getState().end}</MemoryRouter>));
    await act(async () => headerContainer.querySelector<HTMLButtonElement>('button[aria-label="Activity"]')?.click());
    act(() => headerRoot.render(<MemoryRouter>{usePageHeaderStore.getState().end}</MemoryRouter>));
    expect(document.querySelector('[aria-label="Delegated tasks"]')?.textContent).toContain('Working');

    phase = 'closed';
    runStatus = 'succeeded';
    operationalState = 'idle';
    await act(async () => {
      window.dispatchEvent(new CustomEvent('task-changed-v2'));
      await new Promise(resolve => setTimeout(resolve, 180));
    });
    act(() => headerRoot.render(<MemoryRouter>{usePageHeaderStore.getState().end}</MemoryRouter>));
    expect(document.querySelector('[aria-label="Delegated tasks"]')?.textContent).toContain('Finished');
  });
});

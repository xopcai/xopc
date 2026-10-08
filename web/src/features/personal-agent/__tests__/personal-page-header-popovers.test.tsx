// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersonalPage } from '@/features/personal-agent/personal-page';
import { fetchJson } from '@/lib/fetch';
import { usePageHeaderStore } from '@/stores/page-header-store';

vi.mock('@/features/chat/chat-page', () => ({
  ChatPage: () => <div data-testid="personal-chat" />,
}));
vi.mock('@/features/voice/realtime/voice-call-context', () => ({
  useVoiceCall: () => ({ active: false, open: vi.fn() }),
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
        appearance: body?.appearance ?? 'loopi',
        preferences: body?.preferences ?? {},
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

  it('opens a compact editor popover from the avatar while keeping the conversation mounted', async () => {
    await act(async () => {
      root.render(<MemoryRouter><PersonalPage /></MemoryRouter>);
    });
    act(() => headerRoot.render(<>{usePageHeaderStore.getState().main}{usePageHeaderStore.getState().end}</>));

    const chat = container.querySelector('[data-testid="personal-chat"]');
    expect(chat).not.toBeNull();
    act(() => headerContainer.querySelector<HTMLButtonElement>('button[aria-label="Edit Ada\'s profile"]')?.click());

    const editor = document.querySelector('[data-radix-popper-content-wrapper] [aria-label="Edit Personal AI"]');
    expect(editor).not.toBeNull();
    expect(editor?.querySelector('[data-testid="personal-avatar"].size-20')).not.toBeNull();
    const avatarButton = editor?.querySelector<HTMLButtonElement>('button[aria-label="Choose avatar"]');
    expect(avatarButton?.parentElement?.className).toContain('items-center');
    expect(avatarButton?.parentElement?.className).not.toContain('border-b');
    expect(avatarButton?.querySelector('svg')).toBeNull();
    expect(editor?.textContent).not.toContain('Edit Personal AI');
    expect(avatarButton?.getAttribute('aria-expanded')).toBe('false');
    expect(editor?.querySelector('#personal-appearance-options')).toBeNull();
    act(() => avatarButton?.click());
    expect(editor?.querySelector('#personal-appearance-options')).not.toBeNull();
    await act(async () => [...(editor?.querySelectorAll<HTMLButtonElement>('#personal-appearance-options button') ?? [])].find(button => button.textContent === 'Curious')?.click());
    expect(editor?.querySelector('#personal-appearance-options')).toBeNull();
    expect(avatarButton?.getAttribute('aria-expanded')).toBe('false');
    expect(avatarButton?.querySelector('[data-testid="personal-avatar"]')?.getAttribute('data-appearance')).toBe('loopi-curious');
    const avatarPatch = vi.mocked(fetchJson).mock.calls.find(([url, options]) => String(url).includes('/profile') && options?.method === 'PATCH');
    expect(JSON.parse(String(avatarPatch?.[1]?.body)).appearance).toBe('loopi-curious');
    expect(editor?.querySelector('button[aria-label="Close editor"]')).toBeNull();
    expect([...editor!.querySelectorAll('button')].some(button => button.textContent === 'Save')).toBe(false);
    expect(document.querySelector('.xopc-drawer-right')).toBeNull();
    expect(document.querySelector('[aria-label="Edit Personal AI"]')?.textContent).not.toContain('Choose a starting point');
    expect(container.querySelector('[data-testid="personal-chat"]')).toBe(chat);

    act(() => headerContainer.querySelector<HTMLButtonElement>('button[aria-label="Response preferences"]')?.click());
    expect(document.querySelector('[data-radix-popper-content-wrapper] [aria-label="Edit Personal AI"]')).toBeNull();
    expect(container.querySelector('[data-testid="personal-chat"]')).toBe(chat);
  });

  it('automatically saves selected preferences in order', async () => {
    await act(async () => {
      root.render(<MemoryRouter><PersonalPage /></MemoryRouter>);
    });
    act(() => headerRoot.render(<>{usePageHeaderStore.getState().main}{usePageHeaderStore.getState().end}</>));

    act(() => headerContainer.querySelector<HTMLButtonElement>('button[aria-label="Response preferences"]')?.click());
    const editor = document.querySelector('[aria-label="Edit Personal AI"]');
    expect(editor).not.toBeNull();
    await act(async () => {
      [...(editor?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Direct')?.click();
      [...(editor?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Suggest')?.click();
    });
    const patches = vi.mocked(fetchJson).mock.calls.filter(([url, options]) => String(url).includes('/profile') && options?.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(JSON.parse(String(patches[0]?.[1]?.body)).revision).toBe(1);
    expect(JSON.parse(String(patches[1]?.[1]?.body)).revision).toBe(2);
    expect(JSON.parse(String(patches[1]?.[1]?.body)).preferences).toMatchObject({ warmth: 'reserved', supportMode: 'solutions' });
    expect(document.querySelector('[aria-label="Edit Personal AI"]')).not.toBeNull();
  });

  it('saves the assistant name when the input loses focus', async () => {
    await act(async () => {
      root.render(<MemoryRouter><PersonalPage /></MemoryRouter>);
    });
    act(() => headerRoot.render(usePageHeaderStore.getState().end));
    act(() => headerContainer.querySelector<HTMLButtonElement>('button[aria-label="Response preferences"]')?.click());

    const name = document.querySelector<HTMLInputElement>('#personal-name');
    expect(name).not.toBeNull();
    await act(async () => {
      name?.focus();
      if (name) name.value = 'Nova';
      name?.blur();
    });

    const patch = vi.mocked(fetchJson).mock.calls.find(([url, options]) => String(url).includes('/profile') && options?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body)).displayName).toBe('Nova');
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
          state: 'ready', displayName: 'Ada', appearance: 'loopi', preferences: {}, revision: 1 } });
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

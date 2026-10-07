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
  PersonalAvatar: () => <span data-testid="personal-avatar" />,
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
    vi.mocked(fetchJson).mockImplementation(async (url) => String(url).includes('/activity') ? {
      ok: true,
      payload: { items: [], total: 0 },
    } : ({
      ok: true,
      payload: String(url).includes('/models') ? [] : {
        agentId: 'personal',
        conversationId: 'conversation-1',
        state: 'ready',
        displayName: 'Ada',
        appearance: 'loopi',
        preferences: {},
        revision: 1,
        errorMessage: null,
      },
    }));
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

  it('opens a right drawer from the avatar while keeping the conversation mounted', async () => {
    await act(async () => {
      root.render(<MemoryRouter><PersonalPage /></MemoryRouter>);
    });
    act(() => headerRoot.render(usePageHeaderStore.getState().main));

    const chat = container.querySelector('[data-testid="personal-chat"]');
    expect(chat).not.toBeNull();
    act(() => headerContainer.querySelector<HTMLButtonElement>('button[aria-label="Edit Ada\'s profile"]')?.click());

    expect(document.querySelector('[role="dialog"]')?.classList.contains('xopc-drawer-right')).toBe(true);
    expect(container.querySelector('[data-testid="personal-chat"]')).toBe(chat);

    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Close editor"]')?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="personal-chat"]')).toBe(chat);
  });

  it('closes the delegated tasks panel when the header button is clicked again', async () => {
    await act(async () => {
      root.render(<MemoryRouter><PersonalPage /></MemoryRouter>);
    });
    act(() => headerRoot.render(usePageHeaderStore.getState().end));

    await act(async () => headerContainer.querySelector<HTMLButtonElement>('button[aria-label="Activity"]')?.click());
    expect(container.querySelector('aside[aria-label="Delegated tasks"]')).not.toBeNull();

    act(() => headerRoot.render(usePageHeaderStore.getState().end));
    expect(headerContainer.querySelector('button[aria-label="Activity"]')?.getAttribute('aria-pressed')).toBe('true');
    act(() => headerContainer.querySelector<HTMLButtonElement>('button[aria-label="Activity"]')?.click());
    expect(container.querySelector('aside[aria-label="Delegated tasks"]')).toBeNull();
    act(() => headerRoot.render(usePageHeaderStore.getState().end));
    expect(headerContainer.querySelector('button[aria-label="Activity"]')?.getAttribute('aria-pressed')).toBe('false');
  });
});

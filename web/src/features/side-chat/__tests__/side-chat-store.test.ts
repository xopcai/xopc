// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('side chat store session isolation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
  });

  it('keeps tabs, active state, and visibility separate for each parent session', async () => {
    const { useSideChatStore } = await import('@/stores/side-chat-store');
    const store = useSideChatStore.getState();

    store.addTab({ id: 'side-a', parentSessionKey: 'session-a', title: 'A' });
    useSideChatStore.getState().addTab({ id: 'side-b', parentSessionKey: 'session-b', title: 'B' });

    expect(useSideChatStore.getState().panes).toMatchObject({
      'session-a': { open: true, activeId: 'side-a' },
      'session-b': { open: true, activeId: 'side-b' },
    });

    useSideChatStore.getState().setOpen('session-a', false);
    expect(useSideChatStore.getState().panes['session-a']?.open).toBe(false);
    expect(useSideChatStore.getState().panes['session-b']?.open).toBe(true);

    useSideChatStore.getState().removeTab('side-a');
    expect(useSideChatStore.getState().panes['session-a']).toEqual({ open: false, activeId: null });
    expect(useSideChatStore.getState().panes['session-b']).toEqual({ open: true, activeId: 'side-b' });
    expect(useSideChatStore.getState().tabs).toEqual([
      { id: 'side-b', parentSessionKey: 'session-b', title: 'B' },
    ]);
  });

  it('allows a pending creation request to be claimed only once', async () => {
    const { useSideChatStore } = await import('@/stores/side-chat-store');
    useSideChatStore.getState().requestCreate('session-a');
    const pending = useSideChatStore.getState().pendingCreate;
    expect(pending).not.toBeNull();

    const first = useSideChatStore.getState().claimPendingCreate('session-a', pending!.requestId);
    const second = useSideChatStore.getState().claimPendingCreate('session-a', pending!.requestId);

    expect(first).toEqual(pending);
    expect(second).toBeNull();
    expect(useSideChatStore.getState().pendingCreate).toBeNull();
  });
});

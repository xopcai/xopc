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

    store.addTab({ id: 'side-a', parentConversationId: 'session-a', title: 'A' });
    useSideChatStore.getState().addTab({ id: 'side-b', parentConversationId: 'session-b', title: 'B' });

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
    expect(useSideChatStore.getState().tabs).toMatchObject([
      { id: 'side-b', parentConversationId: 'session-b', title: 'B' },
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

  it('creates on opening an empty pane and deduplicates pending and in-flight requests', async () => {
    const { useSideChatStore } = await import('@/stores/side-chat-store');
    const store = useSideChatStore.getState();
    store.setOpen('parent', true);
    const request = useSideChatStore.getState().pendingCreate!;
    expect(request).toMatchObject({ parentConversationId: 'parent', selections: [] });
    store.setOpen('parent', true);
    expect(useSideChatStore.getState().pendingCreate).toEqual(request);
    store.claimPendingCreate('parent', request.requestId);
    store.setOpen('parent', false);
    store.setOpen('parent', true);
    expect(useSideChatStore.getState().pendingCreate).toBeNull();
    store.finishCreate('parent', request.requestId);
    store.requestCreate('parent');
    expect(useSideChatStore.getState().pendingCreate).not.toBeNull();
  });

  it('restores the last selected usable chat for the current parent and preserves its draft', async () => {
    const { useSideChatStore } = await import('@/stores/side-chat-store');
    const store = useSideChatStore.getState();
    store.addTab({ id: 'older', parentConversationId: 'parent', title: 'Older' });
    store.addTab({ id: 'newer', parentConversationId: 'parent', title: 'Newer' });
    store.addTab({ id: 'other', parentConversationId: 'other-parent', title: 'Other' });
    store.setActive('older');
    store.setDraftText('older', 'unfinished');
    store.setOpen('parent', false);
    store.setOpen('parent', true);
    expect(useSideChatStore.getState().panes.parent).toEqual({ open: true, activeId: 'older' });
    expect(useSideChatStore.getState().drafts.older.text).toBe('unfinished');
    expect(useSideChatStore.getState().pendingCreate).toBeNull();
    store.markEnded('older', 'idle');
    store.setOpen('parent', false);
    store.setOpen('parent', true);
    expect(useSideChatStore.getState().panes.parent.activeId).toBe('newer');
    store.markPromoted('newer', 'saved');
    store.setOpen('parent', false);
    store.setOpen('parent', true);
    expect(useSideChatStore.getState().panes.parent.activeId).toBeNull();
    expect(useSideChatStore.getState().pendingCreate?.parentConversationId).toBe('parent');
    expect(useSideChatStore.getState().tabs).toHaveLength(3);
  });
  it('bounds reading copies, strips tool data, and never persists drafts or content', async () => {
    const { useSideChatStore } = await import('@/stores/side-chat-store');
    const state = useSideChatStore.getState();
    for (let i = 0; i < 8; i++) {
      state.addTab({ id: `side-${i}`, parentConversationId: 'parent', title: 'Side chat' });
      state.rememberMessages(`side-${i}`, [{ role: 'assistant', content: [
        { type: 'text', text: 'x'.repeat(900_000) },
        { type: 'tool_use', id: 'tool', name: 'exec', status: 'done', result: 'private-tool-output' },
      ] }]);
    }
    state.setDraftText('side-7', 'private-draft');
    await Promise.resolve();
    const readings = useSideChatStore.getState().readings;
    expect(Object.keys(readings).length).toBeLessThanOrEqual(5);
    expect(Object.values(readings).reduce((sum, reading) => sum + reading.bytes, 0)).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(readings['side-7'].truncated).toBe(true);
    expect(JSON.stringify(readings)).not.toContain('private-tool-output');
    const storage = sessionStorage.getItem('xopc:side-chat-panes:v2') ?? '';
    expect(storage).not.toContain('private-draft');
    expect(storage).not.toContain('xxxx');
  });

  it('transfers drafts atomically and clears page data on gateway identity changes', async () => {
    const { useSideChatStore } = await import('@/stores/side-chat-store');
    const { useGatewayStore } = await import('@/stores/gateway-store');
    const state = useSideChatStore.getState();
    state.addTab({ id: 'old', parentConversationId: 'parent', title: 'Side chat' });
    state.setDraftText('old', 'unsent');
    state.setDraftAttachments('old', [{ name: 'notes.txt', type: 'document', mimeType: 'text/plain', size: 5, content: 'aGVsbG8=' }]);
    state.markEnded('old', 'idle');
    state.replaceTab('old', { id: 'new', parentConversationId: 'parent', title: 'Side chat' });
    expect(useSideChatStore.getState().drafts).toEqual({
      new: { text: 'unsent', attachments: [{ name: 'notes.txt', type: 'document', mimeType: 'text/plain', size: 5, content: 'aGVsbG8=' }] },
    });
    expect(useSideChatStore.getState().tabs.map((tab) => tab.id)).toEqual(['new']);
    useGatewayStore.setState({ baseUrl: 'https://different-gateway.invalid' });
    expect(useSideChatStore.getState().drafts).toEqual({});
    expect(useSideChatStore.getState().tabs).toEqual([]);
    expect(useSideChatStore.getState().readings).toEqual({});
  });

});

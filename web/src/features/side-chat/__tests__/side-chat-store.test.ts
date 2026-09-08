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
  it('bounds reading copies, strips tool data, and never persists drafts or content', async () => {
    const { useSideChatStore } = await import('@/stores/side-chat-store');
    const state = useSideChatStore.getState();
    for (let i = 0; i < 8; i++) {
      state.addTab({ id: `side-${i}`, parentSessionKey: 'parent', title: 'Side chat' });
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
    state.addTab({ id: 'old', parentSessionKey: 'parent', title: 'Side chat' });
    state.setDraftText('old', 'unsent');
    state.setDraftAttachments('old', [{ name: 'notes.txt', type: 'document', mimeType: 'text/plain', size: 5, content: 'aGVsbG8=' }]);
    state.markEnded('old', 'idle');
    state.replaceTab('old', { id: 'new', parentSessionKey: 'parent', title: 'Side chat' });
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

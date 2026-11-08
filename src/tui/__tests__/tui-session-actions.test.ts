import { describe, expect, it, vi } from 'vitest';

import { ChatLog } from '../components/chat-log.js';
import type { TuiBackend } from '../tui-backend.js';
import { createSessionActions } from '../tui-session-actions.js';
import { createInitialState } from '../tui-types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(overrides: Partial<TuiBackend> = {}) {
  const state = createInitialState('A');
  const chatLog = new ChatLog();
  const client = {
    loadHistory: vi.fn(async () => ({ messages: [] })),
    getSessionInfo: vi.fn(async () => ({})),
    abortChat: vi.fn(async () => ({ ok: true })),
    resetSession: vi.fn(async () => {}),
    ...overrides,
  } as unknown as TuiBackend;
  const actions = createSessionActions({
    state, client, chatLog, tui: { requestRender: vi.fn() } as never,
    resolveConversationId: (id) => id!, updateHeader: vi.fn(), updateFooter: vi.fn(),
    setActivityStatus: (status) => { state.activityStatus = status as typeof state.activityStatus; },
  });
  return { state, chatLog, client, actions, text: () => chatLog.render(100).join('\n') };
}

describe('TUI session request ownership', () => {
  it('discards late history after A → B → A, including the old finally block', async () => {
    const old = deferred<Awaited<ReturnType<TuiBackend['loadHistory']>>>();
    let calls = 0;
    const s = setup({ loadHistory: vi.fn(async ({ conversationId }) => ++calls === 1
      ? old.promise : { messages: [{ role: 'user', content: `current-${conversationId}` }] }) });
    const pending = s.actions.loadHistory();
    await s.actions.setSession('B');
    await s.actions.setSession('A');
    old.resolve({ messages: [{ role: 'user', content: 'stale-A' }] });
    await pending;
    expect(s.text()).toContain('current-A');
    expect(s.text()).not.toContain('stale-A');
    expect(s.client.getSessionInfo).toHaveBeenCalledTimes(2);
  });

  it('keeps the last history and reports a failed refresh', async () => {
    const loadHistory = vi.fn<TuiBackend['loadHistory']>()
      .mockResolvedValueOnce({ messages: [{ role: 'user', content: 'saved-history' }] })
      .mockRejectedValueOnce(new Error('503'));
    const s = setup({ loadHistory });
    await s.actions.loadHistory();
    await s.actions.loadHistory();
    expect(s.text()).toContain('saved-history');
    expect(s.text()).toContain('503');
  });

  it('does not mark a failed first history request loaded', async () => {
    const s = setup({ loadHistory: vi.fn().mockRejectedValue(new Error('offline')) });
    await s.actions.loadHistory();
    expect(s.state.historyLoaded).toBe(false);
  });

  it('discards session metadata that arrives after switching', async () => {
    const old = deferred<Awaited<ReturnType<TuiBackend['getSessionInfo']>>>();
    const s = setup({ getSessionInfo: vi.fn(async (id) => id === 'A' ? old.promise : { agentId: 'B' }) });
    const pending = s.actions.refreshSessionInfo();
    await s.actions.setSession('B');
    old.resolve({ agentId: 'wrong-agent' });
    await pending;
    expect(s.state.sessionInfo.agentId).toBe('B');
  });

  it('ignores a late transcript window after a session switch', async () => {
    const old = deferred<Awaited<ReturnType<NonNullable<TuiBackend['loadHistoryWindow']>>>>();
    const s = setup({ loadHistoryWindow: vi.fn(() => old.promise) });
    const pending = s.actions.loadHistoryWindow({ rowNumber: 10 });
    await s.actions.setSession('B');
    old.resolve({ messages: [{ role: 'user', content: 'stale-window' }], startRowNumber: 1, endRowNumber: 1, totalRows: 1 });
    expect(await pending).toBe(false);
    expect(s.text()).not.toContain('stale-window');
  });
});

describe('TUI stop and reset confirmation', () => {
  it('stops B independently while the stop for A is still pending', async () => {
    const first = deferred<{ ok: boolean }>();
    const second = deferred<{ ok: boolean }>();
    const abortChat = vi.fn<TuiBackend['abortChat']>()
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const s = setup({ abortChat });
    s.state.activeRunId = 'run-A';
    const a = s.actions.abortActive();
    await s.actions.setSession('B');
    s.state.activeRunId = 'run-B';
    const b = s.actions.abortActive();
    expect(abortChat).toHaveBeenCalledTimes(2);
    first.resolve({ ok: true });
    await a;
    expect(s.actions.abortActive()).toBe(b);
    second.resolve({ ok: true });
    await b;
    expect(s.state.activeRunId).toBeNull();
  });
  it('keeps the run busy until stop succeeds and coalesces repeated stops', async () => {
    const stopped = deferred<{ ok: boolean }>();
    const s = setup({ abortChat: vi.fn(() => stopped.promise) });
    s.state.activeRunId = 'run-A';
    const pending = s.actions.abortActive();
    const repeated = s.actions.abortActive();
    expect(s.state.activeRunId).toBe('run-A');
    expect(s.state.activityStatus).toBe('aborting');
    stopped.resolve({ ok: true });
    await Promise.all([pending, repeated]);
    expect(s.client.abortChat).toHaveBeenCalledOnce();
    expect(s.state.activeRunId).toBeNull();
    expect(s.state.activityStatus).toBe('idle');
  });

  it('retains an unconfirmed run and prevents reset', async () => {
    const s = setup({ abortChat: vi.fn(async () => ({ ok: false })) });
    s.state.activeRunId = 'run-A';
    await expect(s.actions.resetCurrentSession()).rejects.toThrow('did not confirm');
    expect(s.state.activeRunId).toBe('run-A');
    expect(s.state.activityStatus).toBe('stalled');
    expect(s.client.resetSession).not.toHaveBeenCalled();
  });

  it('does not clear history when reset fails', async () => {
    const s = setup({ resetSession: vi.fn().mockRejectedValue(new Error('503')) });
    s.chatLog.addUser('keep-this-history');
    await expect(s.actions.resetCurrentSession()).rejects.toThrow('503');
    expect(s.text()).toContain('keep-this-history');
  });

  it('does not clear a different run when stop completes late', async () => {
    const stopped = deferred<{ ok: boolean }>();
    const s = setup({ abortChat: vi.fn(() => stopped.promise) });
    s.state.activeRunId = 'run-A';
    const pending = s.actions.abortActive();
    await s.actions.setSession('B');
    s.state.activeRunId = 'run-B';
    stopped.resolve({ ok: true });
    await pending;
    expect(s.state.activeRunId).toBe('run-B');
  });
});

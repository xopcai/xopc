// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentStreamMessagingCallbacks } from '../agent-stream-messaging-callbacks';
import { useChatSessionStore } from '../../session/chat-session-store';
import { defaultSessionMeta } from '../../session/chat-session-defaults';
import type { SessionManager } from '../../session/session-manager';

const id = 'stream-generation-test';
let current: boolean;
let load: ReturnType<typeof vi.fn>;
const apply = vi.fn<(...args: unknown[]) => void>();
const finalize = vi.fn<(...args: unknown[]) => void>();
function callbacks(visible = true) {
  return createAgentStreamMessagingCallbacks({ chatId: id, shouldApplyStreamUpdate: () => visible,
    isCurrentRun: () => current, beforeAssistantDelta: () => {}, reconcileHydratedAssistantText: false,
    setStreamingOnStreamStart: true, clearResumeRunIdOnBackgroundTerminal: true, clearResumeRunIdOnVisibleError: true,
    setError: vi.fn(), sessionMgrRef: { current: { loadSession: load } as unknown as SessionManager },
    applyLoadedSessionSnapshot: apply, finalizeMessage: finalize,
    fq: { dismissClarifyForSession: vi.fn(), makeOnClarifyRequest: () => vi.fn() } });
}
beforeEach(() => {
  current = true; load = vi.fn(); apply.mockReset(); finalize.mockReset();
  useChatSessionStore.setState({ sessions: {} });
  useChatSessionStore.getState().initSessionSnapshot(id, { ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false,
    messages: [], sending: true, streaming: true, streamingMsg: { role: 'assistant', content: [], turnId: 'new-run' }, progress: null, taskPlan: null });
});
afterEach(() => vi.useRealTimers());

describe('obsolete stream callbacks', () => {
  it.each([true, false])('cannot clear a newer run on an old terminal event (visible=%s)', visible => {
    const handlers = callbacks(visible);
    current = false;
    handlers.onResult({ runId: 'old-run', conversationId: id, status: 'cancelled' });
    handlers.onError('Old failure');
    handlers.onToken('Old token');
    const state = useChatSessionStore.getState().sessions[id];
    expect(state).toMatchObject({ sending: true, streaming: true, streamingMsg: { turnId: 'new-run', content: [] } });
    expect(finalize).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
  it('ignores a snapshot requested by an earlier run', async () => {
    let complete!: (value: { messages: []; hasMore: false }) => void;
    load.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const handlers = callbacks();
    const reloading = handlers.onReplayGap?.();
    current = false;
    complete({ messages: [], hasMore: false });
    await reloading;
    expect(apply).not.toHaveBeenCalled();
  });
  it('discards review deltas buffered before a run was superseded', () => {
    vi.useFakeTimers();
    const handlers = callbacks();
    handlers.onReviewStart?.({ reviewId: 'review', target: 'branch', stage: 'reviewing' });
    handlers.onReviewDelta?.({ reviewId: 'review', delta: 'Old buffered output' });
    const before = useChatSessionStore.getState().sessions[id].streamingMsg;
    current = false;
    vi.advanceTimersByTime(200);
    expect(useChatSessionStore.getState().sessions[id].streamingMsg).toBe(before);
  });
});

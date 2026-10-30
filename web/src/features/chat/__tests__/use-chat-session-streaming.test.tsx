import { rememberInputControl } from '../session/session-input-control';
import { setPendingAgentRun } from '../messages/message-sender';
// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatRunManager } from '@/features/chat/session/chat-run-manager';
import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import { getChatSessionSnapshot, useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { resolveResumeRunId } from '@/features/chat/session/resolve-resume-run-id';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { useChatSessionStreaming } from '@/features/chat/session/use-chat-session-streaming';
import type { ChatFollowUpClarifyApi } from '@/features/chat/session/use-chat-follow-up-clarify';

vi.mock('@/features/chat/session/resolve-resume-run-id', () => ({ resolveResumeRunId: vi.fn() }));

const conversationId = 'pending-run-lookup-test';

describe('useChatSessionStreaming run lookup', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let streaming: ReturnType<typeof useChatSessionStreaming>;
  let sessionManager: SessionManager;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    chatRunManager.abort(conversationId, false);
    sessionStorage.clear();
    useChatSessionStore.setState({ sessions: {} });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    sessionManager = { loadSession: vi.fn() } as unknown as SessionManager;

    function Harness() {
      streaming = useChatSessionStreaming({
        conversationId,
        thinkingLevel: 'off',
        modelSupportsThinking: false,
        conversationIdRef: { current: conversationId },
        sendingRef: { current: false },
        streamingRef: { current: false },
        sessionMgrRef: { current: sessionManager },
        sendMessageRef: { current: async () => {} },
        shouldApplyStreamUpdate: () => true,
        fq: { dismissClarify: vi.fn(), makeOnClarifyRequest: vi.fn(() => vi.fn()) } as unknown as ChatFollowUpClarifyApi,
        applyLoadedSessionSnapshot: () => {},
        loadSessionById: async () => [],
        resetCurrentSession: async () => {},
        pollSessionNameAfterTurn: () => {},
      });
      return null;
    }
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it.each(['success', 'cancelled', 'error'] as const)('settles pending text after a missing message-end on %s', status => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false, messages: [],
      streamingMsg: { role: 'assistant', content: [
        { type: 'text', text: 'Checking files', segmentId: 'progress', presentation: 'pending' },
        { type: 'tool_use', id: 'read', name: 'read_file', status: 'done' },
        { type: 'text', text: '| File | Result |\n| --- | --- |\n| one | ok |', segmentId: 'final', presentation: 'pending' },
      ] },
      progress: null, taskPlan: null, sending: false, streaming: true,
    });
    act(() => streaming.finalizeMessage(conversationId, status));
    const slice = getChatSessionSnapshot(conversationId)!;
    expect(slice.streaming).toBe(false);
    expect(slice.streamingMsg).toBeNull();
    expect(slice.messages.at(-1)?.content).toMatchObject([
      { presentation: 'narration' }, { type: 'tool_use' },
      { segmentId: 'final', presentation: status === 'success' ? 'answer' : 'pending' },
    ]);
    act(() => streaming.finalizeMessage(conversationId, status));
    expect(getChatSessionSnapshot(conversationId)?.messages).toHaveLength(1);
  });

  it('shows a rejected thinking configuration instead of a generic network error', async () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false,
      messages: [], streamingMsg: null, progress: null, taskPlan: null, sending: false, streaming: false,
    });
    const sender = { send: vi.fn().mockRejectedValue(new Error('This agent uses thinking off')) };
    vi.spyOn(chatRunManager, 'senderFor').mockReturnValue(sender as unknown as ReturnType<typeof chatRunManager.senderFor>);

    await act(async () => { await streaming.sendMessage('hello'); });

    expect(sender.send).toHaveBeenCalledOnce();
    expect(useChatSessionStore.getState().shellError).toBe('This agent uses thinking off');
    expect(getChatSessionSnapshot(conversationId)?.messages.at(-1)?.deliveryStatus).toBe('failed');
  });

  it('keeps an accepted input placeholder while the gateway has not assigned a run', async () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false,
      messages: [], streamingMsg: { role: 'assistant', content: [], pendingResponseStatus: 'waiting' },
      progress: null, taskPlan: null, sending: false, streaming: false,
    });
    vi.mocked(resolveResumeRunId).mockResolvedValue(null);

    await act(async () => streaming.tryResumeAgentRun(conversationId));

    expect(getChatSessionSnapshot(conversationId)?.streamingMsg?.pendingResponseStatus).toBe('waiting');
  });

  it('keeps HTTP-accepted user input across cancellation before its transcript echo', async () => {
    useChatSessionStore.getState().seedSessionIfEmpty(conversationId, [], false, false);
    const sender = { send: vi.fn(async (...args: unknown[]) => {
      const callbacks = args[4] as { onInputAccepted: () => void };
      callbacks.onInputAccepted();
      throw new DOMException('Interrupted', 'AbortError');
    }) };
    vi.spyOn(chatRunManager, 'senderFor').mockReturnValue(sender as unknown as ReturnType<typeof chatRunManager.senderFor>);
    await act(async () => streaming.sendMessage('keep this input'));
    const accepted = getChatSessionSnapshot(conversationId)?.messages[0];
    expect(accepted).toMatchObject({ deliveryStatus: 'accepted', content: [{ type: 'text', text: 'keep this input' }] });
    useChatSessionStore.getState().mergeCommittedFromServer(conversationId, [], false);
    expect(getChatSessionSnapshot(conversationId)?.messages[0]?.renderKey).toBe(accepted?.renderKey);
  });

  it('ignores a stale missing-run result after the first stream event arrives', async () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false,
      messages: [], streamingMsg: { role: 'assistant', content: [], pendingResponseStatus: 'waiting' },
      progress: null, taskPlan: null, sending: false, streaming: false,
    });
    let finishLookup!: (runId: string | null) => void;
    vi.mocked(resolveResumeRunId).mockImplementation(() => new Promise((resolve) => { finishLookup = resolve; }));

    const resume = streaming.tryResumeAgentRun(conversationId);
    act(() => {
      useChatSessionStore.getState().mutateSessionStreaming(conversationId, (message) => {
        message.content.push({ type: 'text', text: 'Reply started' });
      });
    });
    await act(async () => {
      finishLookup(null);
      await resume;
    });

    expect(getChatSessionSnapshot(conversationId)?.streamingMsg?.content).toEqual([
      { type: 'text', text: 'Reply started' },
    ]);
  });
  it('ignores an old run lookup that resolves after a new local send was inserted', async () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false,
      messages: [], streamingMsg: null,
      progress: null, taskPlan: null, sending: false, streaming: false,
    });
    let finishLookup!: (runId: string | null) => void;
    vi.mocked(resolveResumeRunId).mockImplementation(() => new Promise(resolve => { finishLookup = resolve; }));
    const resume = streaming.tryResumeAgentRun(conversationId);
    act(() => useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'New question' }], clientSubmissionId: 'new-input' }],
      streamingMsg: { role: 'assistant', content: [], renderKey: 'new-reply', pendingResponseStatus: 'waiting' },
      progress: null, taskPlan: null, sending: false, streaming: false,
    }));
    await act(async () => { finishLookup('old-run'); await resume; });
    const slice = getChatSessionSnapshot(conversationId)!;
    expect(slice.messages.at(-1)?.clientSubmissionId).toBe('new-input');
    expect(slice.streamingMsg?.renderKey).toBe('new-reply');
    expect(slice.streamingMsg?.pendingResponseStatus).toBe('waiting');
    expect(slice.streaming).toBe(false);
  });

  it('ignores stale history that finishes loading after a new send begins', async () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false,
      messages: [], streamingMsg: null,
      progress: null, taskPlan: null, sending: false, streaming: false,
    });
    vi.mocked(resolveResumeRunId).mockResolvedValue('old-run');
    let finishHistory!: (result: Awaited<ReturnType<SessionManager['loadSession']>>) => void;
    vi.mocked(sessionManager.loadSession).mockImplementation(() => new Promise(resolve => { finishHistory = resolve; }));
    const resume = streaming.tryResumeAgentRun(conversationId);
    await act(async () => {});
    expect(sessionManager.loadSession).toHaveBeenCalledTimes(1);
    act(() => useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'New question' }], clientSubmissionId: 'new-input' }],
      streamingMsg: { role: 'assistant', content: [], renderKey: 'new-reply', pendingResponseStatus: 'waiting' },
      progress: null, taskPlan: null, sending: false, streaming: false,
    }));
    await act(async () => { finishHistory({ messages: [], hasMore: false }); await resume; });
    const slice = getChatSessionSnapshot(conversationId)!;
    expect(slice.messages.at(-1)?.clientSubmissionId).toBe('new-input');
    expect(slice.streamingMsg?.pendingResponseStatus).toBe('waiting');
    expect(slice.streaming).toBe(false);
  });

  it('does not clear a successor announced before the stopped predecessor cleanup runs', () => {
    rememberInputControl(conversationId, { paused: true, phase: 'idle', version: 1, reviewRequired: false });
    const generation = chatRunManager.getGeneration(conversationId);
    chatRunManager.setResumeRunId(conversationId, 'new-run');
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false, messages: [],
      streamingMsg: { role: 'assistant', content: [{ type: 'text', text: 'New reply' }], turnId: 'new-run' },
      progress: null, taskPlan: null, sending: true, streaming: true,
    });
    act(() => streaming.settleStoppedRun(generation, 'old-run'));
    expect(getChatSessionSnapshot(conversationId)).toMatchObject({ streaming: true, sending: true, streamingMsg: { turnId: 'new-run' } });
    expect(chatRunManager.getResumeRunId(conversationId)).toBe('new-run');
  });

  it('replaces the predecessor bubble when reconnecting to the queued successor', async () => {
    const sender = chatRunManager.senderFor(conversationId);
    const resume = vi.spyOn(sender, 'resume').mockImplementation(async (runId, _id, callbacks) => {
      callbacks?.onStreamStart(runId);
      callbacks?.onToken('New reply');
      return true;
    });
    setPendingAgentRun(conversationId, 'new-run');
    vi.mocked(resolveResumeRunId).mockResolvedValue('new-run');
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false,
      messages: [{ role: 'user', turnId: 'old-run', content: [{ type: 'text', text: 'First question' }] }],
      streamingMsg: { role: 'assistant', turnId: 'old-run', content: [{ type: 'text', text: 'Old partial' }] },
      progress: null, taskPlan: null, sending: true, streaming: true,
    });
    vi.mocked(sessionManager.loadSession).mockResolvedValue({ hasMore: false, messages: [
      { role: 'user', turnId: 'old-run', content: [{ type: 'text', text: 'First question' }] },
      { role: 'assistant', turnId: 'old-run', content: [{ type: 'text', text: 'Old final' }] },
      { role: 'user', turnId: 'new-run', content: [{ type: 'text', text: 'Follow-up' }] },
    ] });
    await act(async () => streaming.tryResumeAgentRun(conversationId));
    expect(resume).toHaveBeenCalledWith('new-run', conversationId, expect.any(Object), { replayFromStart: true });
    const snapshot = getChatSessionSnapshot(conversationId)!;
    expect(snapshot.streamingMsg).toMatchObject({ turnId: 'new-run' });
    expect(JSON.stringify(snapshot.streamingMsg?.content)).not.toContain('Old partial');
    expect(JSON.stringify(snapshot.streamingMsg?.content)).toContain('New reply');
    expect(snapshot.messages.filter(message => message.role === 'assistant')).toHaveLength(1);
  });

  it('keeps the cursor when reconnecting with the matching live buffer still in memory', async () => {
    const sender = chatRunManager.senderFor(conversationId);
    const resume = vi.spyOn(sender, 'resume').mockResolvedValue(true);
    setPendingAgentRun(conversationId, 'same-run');
    vi.mocked(resolveResumeRunId).mockResolvedValue('same-run');
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...defaultSessionMeta(), historyStatus: 'ready', hasMore: false,
      messages: [{ role: 'user', turnId: 'same-run', content: [{ type: 'text', text: 'Question' }] }],
      streamingMsg: { role: 'assistant', turnId: 'same-run', content: [{ type: 'text', text: 'Already rendered prefix' }] },
      progress: null, taskPlan: null, sending: true, streaming: true,
    });
    vi.mocked(sessionManager.loadSession).mockResolvedValue({ hasMore: false, messages: [] });
    await act(async () => streaming.tryResumeAgentRun(conversationId));
    expect(resume).toHaveBeenCalledWith('same-run', conversationId, expect.any(Object), { replayFromStart: false });
  });

});

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentStreamMessagingCallbacks } from '../agent-stream-messaging-callbacks';
import { buildAssistantTurnViewModel } from '../assistant-turn-view-model';
import { MessageSender } from '../message-sender';
import { getChatSessionSnapshot, useChatSessionStore } from '../../session/chat-session-store';
import type { SessionManager } from '../../session/session-manager';
import { subscribeRealtimeTopic } from '@/features/gateway/gateway-realtime';

vi.mock('@/features/gateway/gateway-realtime', () => ({ subscribeRealtimeTopic: vi.fn() }));

afterEach(() => { useChatSessionStore.setState({ sessions: {} }); sessionStorage.clear(); vi.resetAllMocks(); });

describe('Personal response realtime replay', () => {
  it('keeps one task failure notification across live retry and replay starts', () => {
    const conversationId = 'task-update-retries';
    useChatSessionStore.getState().seedSessionIfEmpty(conversationId, [], false, true);
    const callbacks = createAgentStreamMessagingCallbacks({
      chatId: conversationId, shouldApplyStreamUpdate: () => true, beforeAssistantDelta: () => {},
      reconcileHydratedAssistantText: true, setStreamingOnStreamStart: true,
      clearResumeRunIdOnBackgroundTerminal: true, clearResumeRunIdOnVisibleError: true,
      setError: vi.fn(), sessionMgrRef: { current: { loadSession: vi.fn() } as unknown as SessionManager },
      applyLoadedSessionSnapshot: vi.fn(), finalizeMessage: vi.fn(),
      fq: { dismissClarifyForSession: vi.fn(), makeOnClarifyRequest: () => vi.fn() },
    });
    const trigger = { entryId: 'failure-1', taskId: 'task-1', taskTitle: 'Research', kind: 'failure' as const };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      callbacks.onStreamStart?.(`retry-${attempt}`, true, trigger);
    }
    callbacks.onStreamStart?.('retry-19', true, trigger);
    const markers = getChatSessionSnapshot(conversationId)!.messages.filter((message) => message.role === 'task');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ taskTrigger: trigger, turnId: 'retry-19' });
  });

  it('recovers live progress from missed starts and keeps replay idempotent', async () => {
    const conversationId = 'personal-stream-test';
    const runId = 'personal-run-test';
    useChatSessionStore.getState().seedSessionIfEmpty(conversationId, [], false, true);
    let listener: Parameters<typeof subscribeRealtimeTopic>[1] | undefined;
    vi.mocked(subscribeRealtimeTopic).mockImplementation((_topic, next) => { listener = next; return vi.fn(); });
    const finalize = vi.fn();
    const callbacks = createAgentStreamMessagingCallbacks({
      chatId: conversationId, shouldApplyStreamUpdate: () => true, beforeAssistantDelta: () => {},
      reconcileHydratedAssistantText: true, setStreamingOnStreamStart: true,
      clearResumeRunIdOnBackgroundTerminal: true, clearResumeRunIdOnVisibleError: true,
      setError: vi.fn(), sessionMgrRef: { current: { loadSession: vi.fn() } as unknown as SessionManager },
      applyLoadedSessionSnapshot: vi.fn(), finalizeMessage: finalize,
      fq: { dismissClarifyForSession: vi.fn(), makeOnClarifyRequest: () => vi.fn() },
    });
    const sender = new MessageSender();
    const resumed = sender.resume(runId, conversationId, callbacks);
    let seq = 1;
    const emit = (event: string, payload: Record<string, unknown>) => listener!.onEvent({
      topic: `run:${runId}`, seq: seq++, event,
      data: { type: event, runId, conversationId, timestamp: Date.now(), payload },
    });
    emit('assistant_delta', { messageId: 'm1', offset: 0, delta: '我先核对数值。', textSurface: 'conversation' });
    const readView = () => buildAssistantTurnViewModel({
      message: getChatSessionSnapshot(conversationId)!.streamingMsg!, isStreaming: true, reasoningLevel: 'on',
    });
    expect(readView().answer.started).toBe(true);
    expect(readView().answerContent).toMatchObject([{ text: '我先核对数值。', presentation: 'pending' }]);
    expect(readView().workLog.items).toEqual([]);
    // Replayed offsets must not duplicate an already visible sentence.
    emit('assistant_delta', { messageId: 'm1', offset: 0, delta: '我先核对数值。', textSurface: 'conversation' });
    expect(readView().answerContent).toMatchObject([{ text: '我先核对数值。' }]);
    emit('assistant_message_end', { messageId: 'm1', presentation: 'narration' });
    expect(readView().workLog.items).toMatchObject([{ text: '我先核对数值。', presentation: 'narration' }]);
    emit('run_end', { status: 'success' });
    expect(await resumed).toBe(true);
    expect(finalize).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, beforeEach } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
import { messageRowKey } from '@/features/chat/messages/thinking-blocks';
import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import {
  getChatSessionSnapshot,
  isSessionAgentRunActive,
  isSessionSliceLive,
  shouldShowHistoryLoading,
  useChatSessionStore,
} from '@/features/chat/session/chat-session-store';

const sessionKey = 'agent:main:webchat:default:direct:abc';

const userMsg: Message = {
  role: 'user',
  content: [{ type: 'text', text: 'hi' }],
  timestamp: 1,
};

const idleSlice = {
  ...defaultSessionMeta(),
  historyStatus: 'ready' as const,
  messages: [userMsg],
  hasMore: false,
  streamingMsg: null,
  progress: null,
  taskPlan: null,
  sending: false,
  streaming: false,
};

describe('useChatSessionStore', () => {
  beforeEach(() => {
    useChatSessionStore.setState({
      focusedSessionKey: null,
      initLoading: true,
      loadingMore: false,
      shellError: null,
      sessions: {},
    });
  });

  it('initSessionSnapshot and getSessionSnapshot round-trip clones', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, {
      ...idleSlice,
      sending: true,
    });

    const snap = getChatSessionSnapshot(sessionKey);
    expect(snap?.messages[0]?.content[0]).toEqual({ type: 'text', text: 'hi' });
    expect(snap?.sending).toBe(true);
    snap!.messages[0].content[0] = { type: 'text', text: 'mutated' };
    expect(getChatSessionSnapshot(sessionKey)?.messages[0]?.content[0]).toEqual({
      type: 'text',
      text: 'hi',
    });
  });

  it('patchSessionMeta updates name without touching messages', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, idleSlice);
    useChatSessionStore.getState().patchSessionMeta(sessionKey, { name: 'My chat' });
    const snap = getChatSessionSnapshot(sessionKey);
    expect(snap?.name).toBe('My chat');
    expect(snap?.messages).toHaveLength(1);
  });

  it('tracks history knowledge per session instead of with a global loading key', () => {
    useChatSessionStore.getState().setSessionHistoryStatus(sessionKey, 'loading');
    expect(getChatSessionSnapshot(sessionKey)?.historyStatus).toBe('loading');

    useChatSessionStore.getState().setCommittedSnapshot(sessionKey, {
      messages: [],
      hasMore: false,
    });
    expect(getChatSessionSnapshot(sessionKey)?.historyStatus).toBe('ready');
  });

  it('only shows history loading when there is no ready cached transcript', () => {
    expect(shouldShowHistoryLoading(undefined)).toBe(true);
    expect(shouldShowHistoryLoading('unknown')).toBe(true);
    expect(shouldShowHistoryLoading('loading')).toBe(true);
    expect(shouldShowHistoryLoading('ready')).toBe(false);
  });

  it('mutateSessionStreaming updates bubble and streaming flag', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, {
      ...idleSlice,
      sending: true,
    });

    useChatSessionStore.getState().mutateSessionStreaming(sessionKey, (msg) => {
      msg.content.push({ type: 'text', text: 'hello' });
    });

    const snap = getChatSessionSnapshot(sessionKey);
    expect(snap?.streaming).toBe(true);
    expect(snap?.streamingMsg?.content.some((c) => c.type === 'text' && c.text === 'hello')).toBe(true);
  });

  it('appendAttachmentToCurrentAssistant updates the streaming assistant without creating a new bubble', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, {
      ...idleSlice,
      sending: true,
      streaming: true,
      streamingMsg: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        timestamp: 2,
      },
    });

    useChatSessionStore.getState().appendAttachmentToCurrentAssistant(sessionKey, {
      name: 'reply.mp3',
      mimeType: 'audio/mpeg',
      type: 'voice',
      uri: 'media://tts/reply.mp3',
    });

    const snap = getChatSessionSnapshot(sessionKey);
    expect(snap?.messages).toHaveLength(1);
    expect(snap?.streamingMsg?.attachments).toEqual([
      expect.objectContaining({ uri: 'media://tts/reply.mp3', type: 'voice' }),
    ]);
  });

  it('appendAttachmentToCurrentAssistant merges late TTS audio into the last committed assistant', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, {
      ...idleSlice,
      messages: [
        userMsg,
        { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 2 },
      ],
    });

    useChatSessionStore.getState().appendAttachmentToCurrentAssistant(sessionKey, {
      name: 'reply.mp3',
      mimeType: 'audio/mpeg',
      type: 'voice',
      uri: 'media://tts/reply.mp3',
    });
    useChatSessionStore.getState().appendAttachmentToCurrentAssistant(sessionKey, {
      name: 'reply.mp3',
      mimeType: 'audio/mpeg',
      type: 'voice',
      uri: 'media://tts/reply.mp3',
    });

    const snap = getChatSessionSnapshot(sessionKey);
    expect(snap?.messages).toHaveLength(2);
    expect(snap?.messages[1]?.attachments).toEqual([
      expect.objectContaining({ uri: 'media://tts/reply.mp3', type: 'voice' }),
    ]);
  });

  it('keeps optimistic Note refs when a partial realtime user row replaces it', () => {
    const optimistic: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'analyze it' }],
      contextRefs: [{
        kind: 'note',
        sourceId: 'note-1',
        version: '42',
        title: 'Launch plan',
      }],
      timestamp: 10,
    };
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, {
      ...idleSlice,
      messages: [optimistic],
      sending: true,
    });

    useChatSessionStore.getState().appendUserMessageIfMissing(sessionKey, {
      role: 'user',
      content: [{ type: 'text', text: 'analyze it' }],
      timestamp: 11,
    });

    expect(getChatSessionSnapshot(sessionKey)?.messages).toHaveLength(1);
    expect(getChatSessionSnapshot(sessionKey)?.messages[0]?.contextRefs).toEqual(optimistic.contextRefs);
  });

  it('setCommittedSnapshot preserves live slice messages', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, {
      ...idleSlice,
      sending: true,
      streaming: true,
    });

    useChatSessionStore.getState().setCommittedSnapshot(sessionKey, {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'stale' }], timestamp: 2 }],
      hasMore: true,
    });

    const snap = getChatSessionSnapshot(sessionKey);
    expect(snap?.messages[0]?.content[0]).toEqual({ type: 'text', text: 'hi' });
    expect(snap?.hasMore).toBe(true);
    expect(snap?.streaming).toBe(true);
  });

  it('reuses unchanged message rows during a background transcript refresh', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, idleSlice);
    const beforeMessages = useChatSessionStore.getState().sessions[sessionKey].messages;

    useChatSessionStore.getState().setCommittedSnapshot(sessionKey, {
      messages: [{ ...userMsg, content: userMsg.content.map((block) => ({ ...block })) }],
      hasMore: false,
    });

    const afterMessages = useChatSessionStore.getState().sessions[sessionKey].messages;
    expect(afterMessages).toBe(beforeMessages);
    expect(afterMessages[0]).toBe(beforeMessages[0]);
  });

  it('finalizeStreamingTurn clears streaming state and updates messages', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, {
      ...idleSlice,
      hasMore: true,
      streamingMsg: { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 2 },
      sending: true,
      streaming: true,
    });
    useChatSessionStore.getState().setSessionTaskPlan(sessionKey, {
      planId: `${sessionKey}:todo`,
      revision: 10,
      source: 'todo',
      scope: 'session',
      items: [{ id: 'last', title: 'Last task', status: 'in_progress' }],
    });

    const historicalRow = useChatSessionStore.getState().sessions[sessionKey].messages[0];
    useChatSessionStore.getState().finalizeStreamingTurn(sessionKey, {
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      timestamp: 2,
    });

    const snap = getChatSessionSnapshot(sessionKey);
    expect(snap?.messages).toHaveLength(2);
    expect(snap?.hasMore).toBe(true);
    expect(snap?.taskPlan).toBeNull();
    expect(isSessionSliceLive(snap)).toBe(false);
    expect(useChatSessionStore.getState().sessions[sessionKey].messages[0]).toBe(historicalRow);
  });

  it('keeps the newest canonical task plan revision', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, {
      ...idleSlice,
      sending: true,
      streaming: true,
    });
    const setTaskPlan = useChatSessionStore.getState().setSessionTaskPlan;
    setTaskPlan(sessionKey, {
      planId: `${sessionKey}:todo`,
      revision: 20,
      source: 'todo',
      scope: 'session',
      items: [{ id: 'last', title: 'Last task', status: 'completed' }],
    });
    setTaskPlan(sessionKey, {
      planId: `${sessionKey}:todo`,
      revision: 19,
      source: 'todo',
      scope: 'session',
      items: [{ id: 'last', title: 'Last task', status: 'in_progress' }],
    });

    expect(getChatSessionSnapshot(sessionKey)?.taskPlan).toMatchObject({
      revision: 20,
      items: [{ id: 'last', status: 'completed' }],
    });
  });

  it('keeps the live row identity when the persisted snapshot has a different timestamp', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, {
      ...idleSlice,
      sending: true,
    });
    useChatSessionStore.getState().mutateSessionStreaming(
      sessionKey,
      (message) => message.content.push({ type: 'text', text: 'final answer' }),
      100,
    );

    const liveMessage = getChatSessionSnapshot(sessionKey)?.streamingMsg;
    expect(liveMessage?.progressiveRender).toBe(true);
    expect(liveMessage?.renderKey).toBeTruthy();
    if (!liveMessage) throw new Error('expected a live assistant message');

    useChatSessionStore.getState().finalizeStreamingTurn(sessionKey, liveMessage);
    const localFinal = getChatSessionSnapshot(sessionKey)?.messages[1];
    if (!localFinal) throw new Error('expected a finalized assistant message');
    if (!localFinal.renderKey) throw new Error('expected a stable assistant render key');
    const rowKey = messageRowKey(localFinal, 1);
    useChatSessionStore.getState().completeProgressiveRender(sessionKey, localFinal.renderKey);
    const completedFinal = getChatSessionSnapshot(sessionKey)?.messages[1];
    expect(completedFinal?.progressiveRender).toBeUndefined();
    expect(completedFinal?.renderKey).toBe(localFinal.renderKey);

    useChatSessionStore.getState().setCommittedSnapshot(sessionKey, {
      messages: [
        userMsg,
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'final answer' }],
          timestamp: 999,
        },
      ],
      hasMore: false,
    });

    const persistedFinal = getChatSessionSnapshot(sessionKey)?.messages[1];
    if (!persistedFinal) throw new Error('expected a persisted assistant message');
    expect(persistedFinal.timestamp).toBe(999);
    expect(persistedFinal.renderKey).toBe(localFinal.renderKey);
    expect(persistedFinal.progressiveRender).toBeUndefined();
    expect(messageRowKey(persistedFinal, 1)).toBe(rowKey);
  });

  it('clearSession removes slice', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, idleSlice);
    useChatSessionStore.getState().clearSession(sessionKey);
    expect(getChatSessionSnapshot(sessionKey)).toBeUndefined();
  });

  it('isSessionSliceLive detects in-flight turns', () => {
    expect(isSessionSliceLive(undefined)).toBe(false);
    expect(isSessionSliceLive(idleSlice)).toBe(false);
    expect(isSessionSliceLive({ ...idleSlice, sending: true })).toBe(true);
  });
});

describe('isSessionAgentRunActive', () => {
  beforeEach(() => {
    useChatSessionStore.setState({ sessions: {} });
  });

  it('returns true for live store slice', () => {
    useChatSessionStore.getState().initSessionSnapshot(sessionKey, {
      ...idleSlice,
      sending: true,
    });
    expect(isSessionAgentRunActive(sessionKey)).toBe(true);
  });
});

describe('chatRunManager', () => {
  it('exposes singleton per-session senders', async () => {
    const { chatRunManager } = await import('@/features/chat/session/chat-run-manager');
    const a = chatRunManager;
    const { chatRunManager: b } = await import('@/features/chat/session/chat-run-manager');
    expect(a).toBe(b);
    expect(a.senderFor(sessionKey)).toBe(a.senderFor(sessionKey));
    expect(a.senderFor(`${sessionKey}:other`)).not.toBe(a.senderFor(sessionKey));
  });
});

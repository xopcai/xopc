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

const conversationId = 'agent:main:webchat:default:direct:abc';

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
      focusedConversationId: null,
      initLoading: true,
      loadingMore: false,
      shellError: null,
      sessions: {},
    });
  });

  it('initSessionSnapshot and getSessionSnapshot round-trip clones', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      sending: true,
    });

    const snap = getChatSessionSnapshot(conversationId);
    expect(snap?.messages[0]?.content[0]).toEqual({ type: 'text', text: 'hi' });
    expect(snap?.sending).toBe(true);
    snap!.messages[0].content[0] = { type: 'text', text: 'mutated' };
    expect(getChatSessionSnapshot(conversationId)?.messages[0]?.content[0]).toEqual({
      type: 'text',
      text: 'hi',
    });
  });

  it('patchSessionMeta updates name without touching messages', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, idleSlice);
    useChatSessionStore.getState().patchSessionMeta(conversationId, { name: 'My chat' });
    const snap = getChatSessionSnapshot(conversationId);
    expect(snap?.name).toBe('My chat');
    expect(snap?.messages).toHaveLength(1);
  });

  it('tracks history knowledge per session instead of with a global loading key', () => {
    useChatSessionStore.getState().setSessionHistoryStatus(conversationId, 'loading');
    expect(getChatSessionSnapshot(conversationId)?.historyStatus).toBe('loading');

    useChatSessionStore.getState().setCommittedSnapshot(conversationId, {
      messages: [],
      hasMore: false,
    });
    expect(getChatSessionSnapshot(conversationId)?.historyStatus).toBe('ready');
  });

  it('only shows history loading when there is no ready cached transcript', () => {
    expect(shouldShowHistoryLoading(undefined)).toBe(true);
    expect(shouldShowHistoryLoading('unknown')).toBe(true);
    expect(shouldShowHistoryLoading('loading')).toBe(true);
    expect(shouldShowHistoryLoading('ready')).toBe(false);
  });

  it('mutateSessionStreaming updates bubble and streaming flag', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      sending: true,
    });

    useChatSessionStore.getState().mutateSessionStreaming(conversationId, (msg) => {
      msg.content.push({ type: 'text', text: 'hello' });
    });

    const snap = getChatSessionSnapshot(conversationId);
    expect(snap?.streaming).toBe(true);
    expect(snap?.streamingMsg?.content.some((c) => c.type === 'text' && c.text === 'hello')).toBe(true);
  });

  it('appendAttachmentToCurrentAssistant updates the streaming assistant without creating a new bubble', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      sending: true,
      streaming: true,
      streamingMsg: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        timestamp: 2,
      },
    });

    useChatSessionStore.getState().appendAttachmentToCurrentAssistant(conversationId, {
      name: 'reply.mp3',
      mimeType: 'audio/mpeg',
      type: 'voice',
      uri: 'media://tts/reply.mp3',
    });

    const snap = getChatSessionSnapshot(conversationId);
    expect(snap?.messages).toHaveLength(1);
    expect(snap?.streamingMsg?.attachments).toEqual([
      expect.objectContaining({ uri: 'media://tts/reply.mp3', type: 'voice' }),
    ]);
  });

  it('appendAttachmentToCurrentAssistant merges late TTS audio into the last committed assistant', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      messages: [
        userMsg,
        { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 2 },
      ],
    });

    useChatSessionStore.getState().appendAttachmentToCurrentAssistant(conversationId, {
      name: 'reply.mp3',
      mimeType: 'audio/mpeg',
      type: 'voice',
      uri: 'media://tts/reply.mp3',
    });
    useChatSessionStore.getState().appendAttachmentToCurrentAssistant(conversationId, {
      name: 'reply.mp3',
      mimeType: 'audio/mpeg',
      type: 'voice',
      uri: 'media://tts/reply.mp3',
    });

    const snap = getChatSessionSnapshot(conversationId);
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
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      messages: [optimistic],
      sending: true,
    });

    useChatSessionStore.getState().appendUserMessageIfMissing(conversationId, {
      role: 'user',
      content: [{ type: 'text', text: 'analyze it' }],
      timestamp: 11,
    });

    expect(getChatSessionSnapshot(conversationId)?.messages).toHaveLength(1);
    expect(getChatSessionSnapshot(conversationId)?.messages[0]?.contextRefs).toEqual(optimistic.contextRefs);
  });

  it('keeps user attachments and folder refs when a committed snapshot omits display metadata', () => {
    const optimistic: Message = {
      role: 'user',
      turnId: 'turn-1',
      content: [{ type: 'text', text: 'inspect this folder' }],
      attachments: [{ name: 'diagram.png', mimeType: 'image/png', type: 'image' }],
      contextRefs: [{
        kind: 'file',
        fileKind: 'directory',
        sourceId: 'apps/mobile-expo',
        version: '42',
        title: 'mobile-expo',
      }],
      timestamp: 10,
    };
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      messages: [optimistic],
    });

    useChatSessionStore.getState().setCommittedSnapshot(conversationId, {
      messages: [{
        role: 'user',
        turnId: 'turn-1',
        content: [{ type: 'text', text: 'inspect this folder' }],
        timestamp: 11,
      }],
      hasMore: false,
    });

    const message = getChatSessionSnapshot(conversationId)?.messages[0];
    expect(message?.attachments).toEqual(optimistic.attachments);
    expect(message?.contextRefs).toEqual(optimistic.contextRefs);
  });

  it('setCommittedSnapshot preserves live slice messages', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      sending: true,
      streaming: true,
    });

    useChatSessionStore.getState().setCommittedSnapshot(conversationId, {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'stale' }], timestamp: 2 }],
      hasMore: true,
    });

    const snap = getChatSessionSnapshot(conversationId);
    expect(snap?.messages[0]?.content[0]).toEqual({ type: 'text', text: 'hi' });
    expect(snap?.hasMore).toBe(true);
    expect(snap?.streaming).toBe(true);
  });

  it('keeps a failed optimistic user message across an idle server refresh', () => {
    const failed: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'retry me' }],
      deliveryStatus: 'failed',
      clientSubmissionId: 'local-failed',
      timestamp: 10,
    };
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      messages: [userMsg, failed],
    });

    useChatSessionStore.getState().mergeCommittedFromServer(conversationId, [userMsg], false);

    expect(getChatSessionSnapshot(conversationId)?.messages).toEqual([
      expect.objectContaining({ content: userMsg.content }),
      expect.objectContaining({ clientSubmissionId: 'local-failed', deliveryStatus: 'failed' }),
    ]);
  });

  it('drops a failed optimistic row once the server contains its canonical message', () => {
    const failed: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'accepted after timeout' }],
      deliveryStatus: 'failed',
      clientSubmissionId: 'local-failed',
      timestamp: 10,
    };
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      messages: [userMsg, failed],
    });

    useChatSessionStore.getState().mergeCommittedFromServer(conversationId, [
      userMsg,
      { role: 'user', turnId: 'run-1', content: failed.content, timestamp: 11 },
    ], false);

    const messages = getChatSessionSnapshot(conversationId)?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ turnId: 'run-1' });
    expect(messages[1]).not.toHaveProperty('deliveryStatus');
  });

  it('does not confuse a repeated failed message with an older canonical turn', () => {
    const repeated: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'same text' }],
      timestamp: 10,
    };
    const failed: Message = {
      ...repeated,
      deliveryStatus: 'failed',
      clientSubmissionId: 'local-failed',
      timestamp: 20,
    };
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      messages: [repeated, failed],
    });

    useChatSessionStore.getState().mergeCommittedFromServer(conversationId, [repeated], false);

    expect(getChatSessionSnapshot(conversationId)?.messages).toHaveLength(2);
    expect(getChatSessionSnapshot(conversationId)?.messages[1]).toMatchObject({
      clientSubmissionId: 'local-failed',
      deliveryStatus: 'failed',
    });
  });

  it('reuses unchanged message rows during a background transcript refresh', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, idleSlice);
    const beforeMessages = useChatSessionStore.getState().sessions[conversationId].messages;

    useChatSessionStore.getState().setCommittedSnapshot(conversationId, {
      messages: [{ ...userMsg, content: userMsg.content.map((block) => ({ ...block })) }],
      hasMore: false,
    });

    const afterMessages = useChatSessionStore.getState().sessions[conversationId].messages;
    expect(afterMessages).toBe(beforeMessages);
    expect(afterMessages[0]).toBe(beforeMessages[0]);
  });

  it('finalizeStreamingTurn clears streaming state and updates messages', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      hasMore: true,
      streamingMsg: { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 2 },
      sending: true,
      streaming: true,
    });
    useChatSessionStore.getState().setSessionTaskPlan(conversationId, {
      planId: `${conversationId}:todo`,
      revision: 10,
      source: 'todo',
      scope: 'session',
      items: [{ id: 'last', title: 'Last task', status: 'in_progress' }],
    });

    const historicalRow = useChatSessionStore.getState().sessions[conversationId].messages[0];
    useChatSessionStore.getState().finalizeStreamingTurn(conversationId, {
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      timestamp: 2,
    });

    const snap = getChatSessionSnapshot(conversationId);
    expect(snap?.messages).toHaveLength(2);
    expect(snap?.hasMore).toBe(true);
    expect(snap?.taskPlan).toBeNull();
    expect(isSessionSliceLive(snap)).toBe(false);
    expect(useChatSessionStore.getState().sessions[conversationId].messages[0]).toBe(historicalRow);
  });

  it('merges adjacent assistant rows across backend continuation runs', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      messages: [{
        role: 'assistant', turnId: 'run-1', content: [{ type: 'text', text: 'first' }], timestamp: 1,
      }],
      streamingMsg: {
        role: 'assistant', turnId: 'run-2', content: [{ type: 'text', text: 'second' }], timestamp: 2,
      },
      sending: true,
      streaming: true,
    });

    useChatSessionStore.getState().finalizeStreamingTurn(conversationId, {
      role: 'assistant', turnId: 'run-2', content: [{ type: 'text', text: 'second' }], timestamp: 2,
    });

    const messages = getChatSessionSnapshot(conversationId)?.messages;
    expect(messages).toHaveLength(1);
    expect(messages?.[0]).toMatchObject({
      role: 'assistant',
      turnId: 'run-1',
      content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }],
    });
  });

  it('keeps assistant replies separate when a user row defines a new bubble boundary', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      messages: [
        { role: 'assistant', turnId: 'run-1', content: [{ type: 'text', text: 'first' }], timestamp: 1 },
        { role: 'user', turnId: 'run-2', content: [{ type: 'text', text: 'follow up' }], timestamp: 2 },
      ],
      streamingMsg: {
        role: 'assistant', turnId: 'run-2', content: [{ type: 'text', text: 'second' }], timestamp: 3,
      },
      sending: true,
      streaming: true,
    });

    useChatSessionStore.getState().finalizeStreamingTurn(conversationId, {
      role: 'assistant', turnId: 'run-2', content: [{ type: 'text', text: 'second' }], timestamp: 3,
    });

    expect(getChatSessionSnapshot(conversationId)?.messages.map((message) => message.role))
      .toEqual(['assistant', 'user', 'assistant']);
  });

  it('keeps the newest canonical task plan revision', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      sending: true,
      streaming: true,
    });
    const setTaskPlan = useChatSessionStore.getState().setSessionTaskPlan;
    setTaskPlan(conversationId, {
      planId: `${conversationId}:todo`,
      revision: 20,
      source: 'todo',
      scope: 'session',
      items: [{ id: 'last', title: 'Last task', status: 'completed' }],
    });
    setTaskPlan(conversationId, {
      planId: `${conversationId}:todo`,
      revision: 19,
      source: 'todo',
      scope: 'session',
      items: [{ id: 'last', title: 'Last task', status: 'in_progress' }],
    });

    expect(getChatSessionSnapshot(conversationId)?.taskPlan).toMatchObject({
      revision: 20,
      items: [{ id: 'last', status: 'completed' }],
    });
  });

  it('keeps the live row identity when the persisted snapshot has a different timestamp', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      sending: true,
    });
    useChatSessionStore.getState().mutateSessionStreaming(
      conversationId,
      (message) => message.content.push({ type: 'text', text: 'final answer' }),
      100,
    );

    const liveMessage = getChatSessionSnapshot(conversationId)?.streamingMsg;
    expect(liveMessage?.progressiveRender).toBe(true);
    expect(liveMessage?.renderKey).toBeTruthy();
    if (!liveMessage) throw new Error('expected a live assistant message');

    useChatSessionStore.getState().finalizeStreamingTurn(conversationId, liveMessage);
    const localFinal = getChatSessionSnapshot(conversationId)?.messages[1];
    if (!localFinal) throw new Error('expected a finalized assistant message');
    if (!localFinal.renderKey) throw new Error('expected a stable assistant render key');
    const rowKey = messageRowKey(localFinal, 1);
    useChatSessionStore.getState().completeProgressiveRender(conversationId, localFinal.renderKey);
    const completedFinal = getChatSessionSnapshot(conversationId)?.messages[1];
    expect(completedFinal?.progressiveRender).toBeUndefined();
    expect(completedFinal?.renderKey).toBe(localFinal.renderKey);

    useChatSessionStore.getState().setCommittedSnapshot(conversationId, {
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

    const persistedFinal = getChatSessionSnapshot(conversationId)?.messages[1];
    if (!persistedFinal) throw new Error('expected a persisted assistant message');
    expect(persistedFinal.timestamp).toBe(999);
    expect(persistedFinal.renderKey).toBe(localFinal.renderKey);
    expect(persistedFinal.progressiveRender).toBeUndefined();
    expect(messageRowKey(persistedFinal, 1)).toBe(rowKey);
  });

  it('clearSession removes slice', () => {
    useChatSessionStore.getState().initSessionSnapshot(conversationId, idleSlice);
    useChatSessionStore.getState().clearSession(conversationId);
    expect(getChatSessionSnapshot(conversationId)).toBeUndefined();
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
    useChatSessionStore.getState().initSessionSnapshot(conversationId, {
      ...idleSlice,
      sending: true,
    });
    expect(isSessionAgentRunActive(conversationId)).toBe(true);
  });
});

describe('chatRunManager', () => {
  it('exposes singleton per-session senders', async () => {
    const { chatRunManager } = await import('@/features/chat/session/chat-run-manager');
    const a = chatRunManager;
    const { chatRunManager: b } = await import('@/features/chat/session/chat-run-manager');
    expect(a).toBe(b);
    expect(a.senderFor(conversationId)).toBe(a.senderFor(conversationId));
    expect(a.senderFor(`${conversationId}:other`)).not.toBe(a.senderFor(conversationId));
  });
});

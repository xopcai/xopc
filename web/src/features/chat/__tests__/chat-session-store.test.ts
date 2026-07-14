import { describe, expect, it, beforeEach } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
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

    const historicalRow = useChatSessionStore.getState().sessions[sessionKey].messages[0];
    useChatSessionStore.getState().finalizeStreamingTurn(sessionKey, {
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      timestamp: 2,
    });

    const snap = getChatSessionSnapshot(sessionKey);
    expect(snap?.messages).toHaveLength(2);
    expect(snap?.hasMore).toBe(true);
    expect(isSessionSliceLive(snap)).toBe(false);
    expect(useChatSessionStore.getState().sessions[sessionKey].messages[0]).toBe(historicalRow);
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
  it('exposes singleton sender', async () => {
    const { chatRunManager } = await import('@/features/chat/session/chat-run-manager');
    const a = chatRunManager;
    const { chatRunManager: b } = await import('@/features/chat/session/chat-run-manager');
    expect(a).toBe(b);
    expect(a.sender).toBeDefined();
  });
});

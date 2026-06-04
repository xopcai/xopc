import { describe, expect, it, beforeEach } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { selectDisplayMessages } from '@/features/chat/session/chat-session-view';

const oldKey = 'agent:main:webchat:default:direct:old';
const newKey = 'agent:main:webchat:default:direct:new';

const oldMessages: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1 },
  { role: 'assistant', content: [{ type: 'text', text: 'streaming…' }], timestamp: 2 },
];

describe('new chat display isolation', () => {
  beforeEach(() => {
    useChatSessionStore.setState({
      focusedSessionKey: oldKey,
      sessions: {},
    });
    useChatSessionStore.getState().setCommittedSnapshot(oldKey, {
      messages: oldMessages,
      hasMore: false,
    });
    useChatSessionStore.getState().setSessionFlags(oldKey, { sending: true, streaming: true });
  });

  it('hides old messages on /chat/new (view key null)', () => {
    const slice = useChatSessionStore.getState().sessions[oldKey];
    expect(
      selectDisplayMessages({
        viewSessionKey: null,
        sessionKey: null,
        messages: slice?.messages ?? [],
        streamingMsg: null,
      }),
    ).toEqual([]);
  });

  it('hides old messages when route switched before focused key catches up', () => {
    useChatSessionStore.getState().setCommittedSnapshot(newKey, { messages: [], hasMore: false });
    const newSlice = useChatSessionStore.getState().sessions[newKey];

    expect(
      selectDisplayMessages({
        viewSessionKey: newKey,
        sessionKey: newKey,
        messages: newSlice?.messages ?? [],
        streamingMsg: null,
      }),
    ).toEqual([]);

    const oldSlice = useChatSessionStore.getState().sessions[oldKey];
    expect(
      selectDisplayMessages({
        viewSessionKey: newKey,
        sessionKey: oldKey,
        messages: oldSlice?.messages ?? [],
        streamingMsg: oldSlice?.streamingMsg ?? null,
      }),
    ).toEqual([]);
  });
});

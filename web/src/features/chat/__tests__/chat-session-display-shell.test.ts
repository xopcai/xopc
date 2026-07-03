import { describe, expect, it, beforeEach } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { selectDisplayMessages } from '@/features/chat/session/chat-session-view';

const sessionKey = 'agent:main:webchat:default:direct:abc';

describe('store-backed chat display', () => {
  beforeEach(() => {
    useChatSessionStore.setState({ sessions: {} });
  });

  it('selectDisplayMessages reads committed messages from store slice', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'a' }], timestamp: 1 },
    ];
    useChatSessionStore.getState().setCommittedSnapshot(sessionKey, { messages, hasMore: false });

    const slice = useChatSessionStore.getState().sessions[sessionKey];
    expect(
      selectDisplayMessages({
        viewSessionKey: sessionKey,
        sessionKey,
        messages: slice?.messages ?? [],
        streamingMsg: null,
      }),
    ).toEqual(messages);
  });
});

describe('chat shell and metadata state', () => {
  beforeEach(() => {
    useChatSessionStore.setState({
      focusedSessionKey: null,
      initLoading: true,
      loadingMore: false,
      shellError: null,
      sessions: {},
    });
  });

  it('tracks focused session key and shell flags', () => {
    const store = useChatSessionStore.getState();
    store.setFocusedSessionKey(sessionKey);
    store.setInitLoading(false);
    store.setShellError('oops');

    expect(useChatSessionStore.getState().focusedSessionKey).toBe(sessionKey);
    expect(useChatSessionStore.getState().initLoading).toBe(false);
    expect(useChatSessionStore.getState().shellError).toBe('oops');
  });

  it('setCommittedSnapshot seeds default metadata', () => {
    useChatSessionStore.getState().setCommittedSnapshot(sessionKey, { messages: [], hasMore: false });
    const slice = useChatSessionStore.getState().sessions[sessionKey];
    expect(slice?.model).toBe(defaultSessionMeta().model);
    expect(slice?.thinkingLevel).toBe(defaultSessionMeta().thinkingLevel);
  });
});

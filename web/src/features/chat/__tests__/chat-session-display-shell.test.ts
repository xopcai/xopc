import { describe, expect, it, beforeEach } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import {
  extractResumeTailForRun,
  selectDisplayMessages,
} from '@/features/chat/session/chat-session-view';

const conversationId = 'agent:main:webchat:default:direct:abc';

describe('store-backed chat display', () => {
  beforeEach(() => {
    useChatSessionStore.setState({ sessions: {} });
  });

  it('selectDisplayMessages reads committed messages from store slice', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'a' }], timestamp: 1 },
    ];
    useChatSessionStore.getState().setCommittedSnapshot(conversationId, { messages, hasMore: false });

    const slice = useChatSessionStore.getState().sessions[conversationId];
    expect(
      selectDisplayMessages({
        viewConversationId: conversationId,
        conversationId,
        messages: slice?.messages ?? [],
        streamingMsg: null,
      }),
    ).toBe(slice.messages);
    expect(slice.messages).toMatchObject(messages);
    expect(slice.messages[0].renderKey).toBeTruthy();
  });

  it('renders a continued assistant run in the existing live bubble', () => {
    const previous: Message = {
      role: 'assistant',
      turnId: 'run-1',
      renderKey: 'assistant-run-1',
      content: [{ type: 'tool_use', id: 'tool-1', name: 'search', status: 'done' }],
      timestamp: 1,
    };
    const streaming: Message = {
      role: 'assistant',
      turnId: 'run-2',
      renderKey: 'assistant-run-2',
      content: [{ type: 'text', text: 'Continuing the answer.' }],
      timestamp: 2,
    };

    expect(selectDisplayMessages({
      viewConversationId: conversationId,
      conversationId,
      messages: [previous],
      streamingMsg: streaming,
    })).toEqual([expect.objectContaining({
      role: 'assistant',
      turnId: 'run-1',
      renderKey: 'assistant-run-2',
      content: [...previous.content, ...streaming.content],
    })]);
  });

  it('does not merge a live assistant across a visible user boundary', () => {
    const messages: Message[] = [
      { role: 'assistant', turnId: 'run-1', content: [{ type: 'text', text: 'first' }] },
      { role: 'user', turnId: 'run-2', content: [{ type: 'text', text: 'follow up' }] },
    ];
    const streaming: Message = {
      role: 'assistant', turnId: 'run-2', content: [{ type: 'text', text: 'second' }],
    };

    expect(selectDisplayMessages({
      viewConversationId: conversationId,
      conversationId,
      messages,
      streamingMsg: streaming,
    })).toEqual([...messages, streaming]);
  });

  it('does not hydrate the previous turn assistant when a queued follow-up starts', () => {
    const previousAssistant: Message = {
      role: 'assistant',
      turnId: 'run-1',
      content: [{ type: 'text', text: 'first answer' }],
      timestamp: 2,
    };

    expect(extractResumeTailForRun([
      { role: 'user', turnId: 'run-1', content: [{ type: 'text', text: 'first' }], timestamp: 1 },
      previousAssistant,
    ], 'run-2')).toBeNull();
  });

  it('hydrates an assistant tail when it belongs to the resumed run', () => {
    const currentAssistant: Message = {
      role: 'assistant',
      turnId: 'run-2',
      content: [{ type: 'text', text: 'partial answer' }],
      timestamp: 3,
    };
    const prefix: Message[] = [
      { role: 'user', turnId: 'run-2', content: [{ type: 'text', text: 'second' }], timestamp: 2 },
    ];

    expect(extractResumeTailForRun([...prefix, currentAssistant], 'run-2')).toEqual({
      messagesWithoutTail: prefix,
      tail: currentAssistant,
    });
  });
});

describe('chat shell and metadata state', () => {
  beforeEach(() => {
    useChatSessionStore.setState({
      focusedConversationId: null,
      initLoading: true,
      loadingMore: false,
      shellError: null,
      sessions: {},
    });
  });

  it('tracks focused session key and shell flags', () => {
    const store = useChatSessionStore.getState();
    store.setFocusedConversationId(conversationId);
    store.setInitLoading(false);
    store.setShellError('oops');

    expect(useChatSessionStore.getState().focusedConversationId).toBe(conversationId);
    expect(useChatSessionStore.getState().initLoading).toBe(false);
    expect(useChatSessionStore.getState().shellError).toBe('oops');
  });

  it('setCommittedSnapshot seeds default metadata', () => {
    useChatSessionStore.getState().setCommittedSnapshot(conversationId, { messages: [], hasMore: false });
    const slice = useChatSessionStore.getState().sessions[conversationId];
    expect(slice?.model).toBe(defaultSessionMeta().model);
    expect(slice?.thinkingLevel).toBe(defaultSessionMeta().thinkingLevel);
  });
});

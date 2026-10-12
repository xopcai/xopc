// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { selectDisplayMessages } from '@/features/chat/session/chat-session-view';
import { setOptimisticUserMessageDelivery } from '@/features/chat/messages/optimistic-user-message';

vi.mock('@/features/chat/messages/message-bubble', () => ({
  MessageBubble: ({ message }: { message: Message }) => {
    const [expanded, setExpanded] = useState(false);
    return <button data-timestamp={message.timestamp} onClick={() => setExpanded(!expanded)}>
      {expanded ? 'expanded' : 'collapsed'}
    </button>;
  },
}));

import { MessageList } from '@/features/chat/messages/message-list';

const conversationId = 'history-test';
const message = (timestamp: number, role: Message['role'] = 'user'): Message => ({
  role, timestamp, content: [{ type: 'text', text: `message ${timestamp}` }],
});
const store = () => useChatSessionStore.getState();

function Harness() {
  const session = useChatSessionStore((s) => s.sessions[conversationId]);
  return <MessageList
    personal
    messages={selectDisplayMessages({ ...session, viewConversationId: conversationId, conversationId })}
    streaming={session.streaming}
    progress={null}
    reasoningLevel="stream"
    registerListContentRef={() => {}}
  />;
}

describe('MessageList history identity', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useChatSessionStore.setState({ sessions: {} });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function bubble(timestamp: number) {
    return container.querySelector<HTMLButtonElement>(`[data-timestamp="${timestamp}"]`)!;
  }

  it('retains DOM and expanded state through repeated history prepends and server refresh', () => {
    store().setCommittedSnapshot(conversationId, { messages: [message(30), message(40, 'assistant')], hasMore: true });
    act(() => root.render(<Harness />));
    const original = bubble(40);
    act(() => original.click());

    act(() => store().prependHistoryMessages(conversationId, [message(20)], true));
    const older = bubble(20);
    act(() => store().prependHistoryMessages(conversationId, [message(10)], false));
    expect(bubble(40)).toBe(original);
    expect(bubble(20)).toBe(older);
    expect(original.textContent).toBe('expanded');

    const previous = store().sessions[conversationId].messages;
    act(() => store().setCommittedSnapshot(conversationId, {
      messages: [message(10), message(20), message(30), message(40, 'assistant')], hasMore: false,
    }));
    expect(store().sessions[conversationId].messages).toBe(previous);
    expect(bubble(40)).toBe(original);
    expect(original.textContent).toBe('expanded');
  });

  it('retains a live assistant through history prepend and stream completion', () => {
    store().setCommittedSnapshot(conversationId, { messages: [message(30)], hasMore: true });
    store().mutateSessionStreaming(conversationId, (row) => {
      row.content.push({ type: 'text', text: 'answer' });
    }, 40);
    act(() => root.render(<Harness />));
    const live = bubble(40);
    act(() => live.click());
    act(() => store().prependHistoryMessages(conversationId, [message(10), message(20, 'assistant')], false));
    expect(bubble(40)).toBe(live);
    act(() => store().finalizeStreamingTurn(conversationId, store().sessions[conversationId].streamingMsg!));
    expect(bubble(40)).toBe(live);
    expect(live.textContent).toBe('expanded');
  });

  it('retains Personal AI user bubbles across send acceptance, realtime echo and tail refresh', () => {
    store().setCommittedSnapshot(conversationId, { messages: [message(10)], hasMore: false });
    store().updateSessionMessages(conversationId, rows => [...rows, {
      ...message(20), clientSubmissionId: 'send-1', deliveryStatus: 'sending',
    }]);
    store().setSessionFlags(conversationId, { sending: true });
    act(() => root.render(<Harness />));
    const old = bubble(10);
    const sent = bubble(20);
    act(() => sent.click());
    act(() => store().updateSessionMessages(conversationId, rows => setOptimisticUserMessageDelivery(rows, 'send-1', 'accepted')));
    act(() => store().appendUserMessageIfMissing(conversationId, { ...message(20), timestamp: 21, turnId: 'run-1' }));
    expect(bubble(21)).toBe(sent);
    act(() => store().clearStreamingState(conversationId));
    act(() => store().mergeCommittedFromServer(conversationId, [{ ...message(20), timestamp: 22, turnId: 'run-1' }], true));
    expect(bubble(22)).toBe(sent);
    expect(bubble(10)).toBe(old);
    expect(sent.textContent).toBe('expanded');
  });

  it('preserves the visible assistant when a history page joins its earlier fragment', () => {
    store().setCommittedSnapshot(conversationId, { messages: [message(40, 'assistant')], hasMore: true });
    act(() => root.render(<Harness />));
    const original = bubble(40);
    act(() => original.click());
    act(() => store().prependHistoryMessages(conversationId, [message(20), message(30, 'assistant')], false));
    expect(bubble(40)).toBe(original);
    expect(original.textContent).toBe('expanded');
    expect(store().sessions[conversationId].messages[1].content).toHaveLength(2);
  });

  it('assigns distinct identities even for matching or absent timestamps', () => {
    const missing: Message = { role: 'user', content: [] };
    store().setCommittedSnapshot(conversationId, {
      messages: [message(10), message(10), missing, missing], hasMore: false,
    });
    const keys = store().sessions[conversationId].messages.map((row) => row.renderKey);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(4);
    expect(missing.renderKey).toBeUndefined();
  });

  it('updates server content without remounting the same message', () => {
    store().setCommittedSnapshot(conversationId, { messages: [message(30)], hasMore: false });
    act(() => root.render(<Harness />));
    const original = bubble(30);
    act(() => original.click());
    act(() => store().setCommittedSnapshot(conversationId, {
      messages: [{ ...message(30), content: [{ type: 'text', text: 'edited' }] }], hasMore: false,
    }));
    expect(bubble(30)).toBe(original);
    expect(store().sessions[conversationId].messages[0].content).toEqual([{ type: 'text', text: 'edited' }]);
  });

  it('adds time separators only for the first message and long gaps', () => {
    const start = Date.now() - 2 * 60 * 60_000;
    store().setCommittedSnapshot(conversationId, {
      messages: [
        message(start),
        message(start + 60_000, 'assistant'),
        message(start + 31 * 60_000),
      ],
      hasMore: false,
    });

    act(() => root.render(<Harness />));

    expect(container.querySelectorAll('[data-chat-time-separator]')).toHaveLength(2);
  });

  it('hides a silent assistant marker while preserving real replies', () => {
    store().setCommittedSnapshot(conversationId, { messages: [
      message(10),
      { ...message(20, 'assistant'), content: [{ type: 'text', text: 'NO_REPLY' }] },
      message(30, 'assistant'),
    ], hasMore: false });
    act(() => root.render(<Harness />));
    expect(bubble(20)).toBeNull();
    expect(bubble(30)).not.toBeNull();
  });
});

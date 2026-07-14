// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';

type BubbleProps = {
  messageIndex?: number;
  suppressAssistantActions?: boolean;
  deleteRoundDisabled?: boolean;
};

const { propsByMessageIndex } = vi.hoisted(() => ({
  propsByMessageIndex: new Map<number, BubbleProps>(),
}));

vi.mock('@/features/chat/messages/message-bubble', () => ({
  MessageBubble: (props: BubbleProps) => {
    if (props.messageIndex !== undefined) {
      propsByMessageIndex.set(props.messageIndex, props);
    }
    return <div />;
  },
}));

import { MessageList } from '@/features/chat/messages/message-list';

const list: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'Earlier question' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] },
  { role: 'user', content: [{ type: 'text', text: 'Current question' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Current answer' }] },
];

describe('MessageList streaming row props', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    propsByMessageIndex.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('only changes action visibility and deletion state for the active stream round', () => {
    act(() => {
      root.render(
        <MessageList
          messages={list}
          streaming
          progress={null}
          reasoningLevel="stream"
          registerListContentRef={() => {}}
          deleteRoundDisabled
        />,
      );
    });

    expect(propsByMessageIndex.get(0)?.deleteRoundDisabled).toBe(false);
    expect(propsByMessageIndex.get(1)?.suppressAssistantActions).toBe(false);
    expect(propsByMessageIndex.get(2)?.deleteRoundDisabled).toBe(true);
    expect(propsByMessageIndex.get(3)?.suppressAssistantActions).toBe(true);
  });
});

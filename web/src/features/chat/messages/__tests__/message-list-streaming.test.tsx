// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';

type BubbleProps = {
  messageIndex?: number;
  isStreaming?: boolean;
  suppressAssistantActions?: boolean;
  deleteRoundDisabled?: boolean;
  followUpTrigger?: Message['taskTrigger'];
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
    expect(propsByMessageIndex.get(3)?.suppressAssistantActions).toBe(false);
  });

  it('hides actions under every assistant reply when requested', () => {
    act(() => root.render(<MessageList
      messages={list}
      streaming={false}
      progress={null}
      reasoningLevel="stream"
      registerListContentRef={() => {}}
      hideAssistantActions
    />));

    expect(propsByMessageIndex.get(1)?.suppressAssistantActions).toBe(true);
    expect(propsByMessageIndex.get(3)?.suppressAssistantActions).toBe(true);
  });

  it('renders ephemeral trailing content after transcript messages', () => {
    act(() => {
      root.render(
        <MessageList
          messages={list}
          streaming={false}
          progress={null}
          reasoningLevel="stream"
          registerListContentRef={() => {}}
          trailingContent={<div data-testid="trailing-content">Browser setup</div>}
        />,
      );
    });

    expect(container.querySelector('[data-testid="trailing-content"]')?.textContent).toBe('Browser setup');
  });

  it('treats the pending assistant row as live before the first stream event', () => {
    act(() => {
      root.render(
        <MessageList
          messages={[...list.slice(0, -1), { role: 'assistant', content: [], pendingResponseStatus: 'waiting' }]}
          streaming={false}
          sending={false}
          progress={null}
          reasoningLevel="stream"
          registerListContentRef={() => {}}
        />,
      );
    });
    expect(propsByMessageIndex.get(3)?.isStreaming).toBe(true);
    expect(propsByMessageIndex.get(3)?.suppressAssistantActions).toBe(false);
  });

  it('places a task update in the following assistant reply instead of a separate row', () => {
    const trigger: NonNullable<Message['taskTrigger']> = {
      entryId: 'entry-1', taskId: 'task-1', taskTitle: 'Research', kind: 'result',
    };
    act(() => root.render(<MessageList
      messages={[
        { role: 'assistant', content: [{ type: 'text', text: 'I will check.' }] },
        { role: 'task', turnId: 'run-1', content: [], taskTrigger: trigger },
        { role: 'assistant', turnId: 'run-1', content: [{ type: 'text', text: 'Here is the result.' }] },
      ]}
      streaming={false}
      progress={null}
      reasoningLevel="on"
      registerListContentRef={() => {}}
    />));
    expect(container.querySelector('[data-chat-message-index="1"]')).toBeNull();
    expect(propsByMessageIndex.get(2)?.followUpTrigger).toEqual(trigger);
  });
});

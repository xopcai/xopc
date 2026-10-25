// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../messages.types';

vi.mock('@/features/chat/rendering/connected-message-bubble', () => ({
  ConnectedMessageBubble: ({ message, messageIndex, onRetryUserMessageRound }: {
    message: Message; messageIndex: number; onRetryUserMessageRound?: (index: number) => void;
  }) => <button data-transcript-time={message.timestamp} onClick={() => onRetryUserMessageRound?.(messageIndex)}>Message</button>,
}));
import { MessageList } from '../message-list';

describe('task results in conversation timeline', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('interleaves results by time while retaining transcript action indices', () => {
    const retry = vi.fn();
    const list: Message[] = [10, 30].map(timestamp => ({ role: 'user', timestamp, content: [{ type: 'text', text: 'Request' }] }));
    act(() => root.render(<MessageList messages={list} timelineEntries={[{ id: 'run-1', timestamp: 20, content: 'Run result' }]}
      streaming={false} progress={null} reasoningLevel="off" registerListContentRef={() => {}} onRetryUserMessageRound={retry} />));
    const ordered = [...container.querySelectorAll('[data-transcript-time], [data-chat-timeline-entry]')];
    expect(ordered.map(node => node.getAttribute('data-transcript-time') ?? node.getAttribute('data-chat-timeline-entry'))).toEqual(['10', 'run-1', '30']);
    act(() => (ordered[2] as HTMLButtonElement).click());
    expect(retry).toHaveBeenCalledWith(1);
    expect(list).toHaveLength(2);
  });

  it('renders a result without showing empty conversation suggestions', () => {
    act(() => root.render(<MessageList messages={[]} timelineEntries={[{ id: 'run-1', timestamp: 20, content: 'Run result' }]}
      streaming={false} progress={null} reasoningLevel="off" registerListContentRef={() => {}} welcomeOverlay={<p>Welcome</p>} />));
    expect(container.textContent).toContain('Run result');
    expect(container.textContent).not.toContain('Welcome');
  });

  it('keeps an undated streaming reply after its user message instead of above past results', () => {
    const list: Message[] = [
      { role: 'user', timestamp: 30, content: [{ type: 'text', text: 'Repair the task' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Working on it' }] },
    ];
    act(() => root.render(<MessageList messages={list} timelineEntries={[{ id: 'failed-run', timestamp: 20, content: 'Failure' }]}
      streaming progress={null} reasoningLevel="off" registerListContentRef={() => {}} />));
    expect([...container.querySelectorAll('[data-chat-message-index], [data-chat-timeline-entry]')]
      .map(node => node.getAttribute('data-chat-message-index') ?? node.getAttribute('data-chat-timeline-entry')))
      .toEqual(['failed-run', '0', '1']);
  });
});

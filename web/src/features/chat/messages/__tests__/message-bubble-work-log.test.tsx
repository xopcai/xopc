// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/extensions/extension-provider', () => ({ useUiExtensions: () => [] }));

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import { useLocaleStore } from '@/stores/locale-store';

describe('MessageBubble assistant work log', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'zh' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const message = {
    role: 'assistant' as const,
    content: [
      { type: 'tool_use' as const, id: 'task-1', name: 'personal_task', status: 'done' as const },
      { type: 'text' as const, text: '已经安排好了。' },
    ],
  };

  it('keeps the answer while hiding tool activity in Personal AI chat', () => {
    act(() => root.render(<MemoryRouter><MessageBubble message={message} isStreaming={false} progress={null} showAssistantWorkLog={false} responseFeedbackEnabled={false} /></MemoryRouter>));

    expect(container.textContent).toContain('已经安排好了。');
    expect(container.textContent).not.toContain('执行过程');
    expect(container.textContent).not.toContain('personal task');
  });

  it('continues to show the work log in regular chats', () => {
    act(() => root.render(<MemoryRouter><MessageBubble message={message} isStreaming={false} progress={null} responseFeedbackEnabled={false} /></MemoryRouter>));

    expect(container.textContent).toContain('执行过程');
  });
});

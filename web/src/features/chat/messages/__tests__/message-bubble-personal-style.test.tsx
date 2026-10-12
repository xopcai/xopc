// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import type { Message } from '@/features/chat/messages/messages.types';
import * as workspaceApi from '@/features/workspace/workspace-api';
import { useLocaleStore } from '@/stores/locale-store';

describe('Personal AI message styling', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => root.unmount());
    container.remove();
  });

  function render(message: Message, personal: boolean, isStreaming: boolean) {
    act(() => root.render(
      <MemoryRouter>
        <MessageBubble message={message} personal={personal} isStreaming={isStreaming} progress={null} />
      </MemoryRouter>,
    ));
  }

  it('opens personal task result links using their producing run', async () => {
    const resolveFile = vi.spyOn(workspaceApi, 'resolveWorkspaceFileReference').mockResolvedValue({
      inputPath: 'report.html', displayName: 'report.html', scope: 'external', exists: true,
      absolutePath: '/worker/report.html', capabilities: ['preview'],
    });
    render({ role: 'assistant', content: [{ type: 'text', text: '[HTML](xopc://workspace/file?path=report.html)' }],
      taskResultDelivery: { taskRunId: 'producing-run' } as never }, true, false);
    await act(async () => { container.querySelector<HTMLAnchorElement>('a')?.click(); });
    expect(resolveFile).toHaveBeenCalledWith('report.html', expect.objectContaining({ taskRunId: 'producing-run' }));
  });

  it('uses consistent rounded corners for Personal AI and regular user bubbles', () => {
    const message: Message = { role: 'user', content: [{ type: 'text', text: 'Hello' }] };
    render(message, true, false);
    expect(container.querySelector('.chat-user-message')?.classList.contains('rounded-2xl')).toBe(true);
    expect(container.querySelector('.chat-user-message')?.classList.contains('rounded-tr-sm')).toBe(false);

    render(message, false, false);
    expect(container.querySelector('.chat-user-message')?.classList.contains('rounded-2xl')).toBe(true);
    expect(container.querySelector('.chat-user-message')?.classList.contains('rounded-tr-sm')).toBe(false);
  });

  it('shows the waiting bubble until an assistant answer starts', () => {
    render({ role: 'assistant', content: [], pendingResponseStatus: 'waiting' }, true, true);
    expect(container.querySelector('[role="status"].xopc-personal-thinking')).not.toBeNull();

    render({ role: 'assistant', content: [{ type: 'text', text: 'Hello back' }] }, true, true);
    expect(container.querySelector('.xopc-personal-thinking')).toBeNull();

    render({ role: 'assistant', content: [] }, false, true);
    expect(container.querySelector('.xopc-personal-thinking')).toBeNull();
  });

  it('shows a live first sentence and retains it after tool-call classification and history reload', () => {
    const opening: Message = { role: 'assistant', content: [{ type: 'text', text: '我先核对论文里的数值。', segmentId: 'first', presentation: 'pending' }] };
    render(opening, true, true);
    expect(container.querySelector('.assistant-markdown-content')?.textContent).toContain('我先核对论文里的数值。');
    expect(container.querySelector('.xopc-personal-thinking')).toBeNull();
    render({ ...opening, content: [{ type: 'text', text: '我先核对论文里的数值。', segmentId: 'first', presentation: 'narration' },
      { type: 'text', text: '这项结果检验的是轨道衰减。', presentation: 'answer' }] }, true, false);
    expect(container.textContent).toContain('我先核对论文里的数值。');
    expect(container.textContent).toContain('这项结果检验的是轨道衰减。');
    render(opening, false, true);
    expect(container.querySelector('.assistant-markdown-content')).toBeNull();
  });

  it('does not reveal a fragmented silent-reply marker in the Personal conversation', () => {
    for (const text of ['N', 'NO_', 'NO_REPLY']) {
      render({ role: 'assistant', content: [{ type: 'text', text, presentation: 'pending' }] }, true, true);
      expect(container.querySelector('.assistant-markdown-content')).toBeNull();
    }
    render({ role: 'assistant', content: [{ type: 'text', text: 'No problem.', presentation: 'pending' }] }, true, true);
    expect(container.querySelector('.assistant-markdown-content')?.textContent?.trim()).toBe('No problem.');
    render({ role: 'assistant', content: [{ type: 'text', text: 'NO_REPLY', presentation: 'answer' }] }, true, false);
    expect(container.querySelector('.assistant-markdown-content')).toBeNull();
  });
});

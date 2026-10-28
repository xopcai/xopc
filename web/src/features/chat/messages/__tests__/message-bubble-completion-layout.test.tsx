// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import type { Message, ReasoningLevel } from '@/features/chat/messages/messages.types';
import { useLocaleStore } from '@/stores/locale-store';
import { useDevViewStore } from '@/stores/dev-view-store';
import { ExtensionProvider } from '@/features/extensions/extension-provider';

describe('assistant reply completion layout', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    useDevViewStore.setState({ showRawToolData: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(message: Message, isStreaming: boolean, options: {
    personal?: boolean; reasoningLevel?: ReasoningLevel; rowKey?: string;
  } = {}) {
    act(() => root.render(
      <ExtensionProvider><MemoryRouter>
        <MessageBubble key={options.rowKey} message={message} isStreaming={isStreaming} progress={null}
          personal={options.personal} reasoningLevel={options.reasoningLevel} />
      </MemoryRouter></ExtensionProvider>,
    ));
  }

  it.each([true, false].flatMap(personal => (['off', 'on', 'stream'] as const)
    .map(reasoningLevel => ({ personal, reasoningLevel }))))('keeps process before answer through completion and history: %j', options => {
    const content: Message['content'] = [
      { type: 'text', text: 'Checking the restaurant.', presentation: 'narration' },
      { type: 'tool_use', id: 'lookup', name: 'read_file', status: 'done' },
      { type: 'text', text: 'Configuration is complete.', segmentId: 'final', presentation: 'pending' },
    ];
    const assertOrder = () => {
      const answer = container.querySelector('[data-chat-find-text]')!;
      const process = container.querySelector('[data-assistant-work-log]');
      expect(answer?.textContent).toContain('Configuration is complete.');
      if (process) expect(process.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const actions = container.querySelector('[data-assistant-message-actions]');
      if (actions) expect(answer.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(answer.closest('[data-assistant-work-log]')).toBeNull();
      return answer;
    };
    render({ role: 'assistant', content, timestamp: 1000 }, true, options);
    const liveAnswer = assertOrder();
    const completed: Message = { role: 'assistant', timestamp: 1000, completedAt: 8000,
      content: content.map(block => block.type === 'text' && block.segmentId === 'final'
        ? { ...block, presentation: 'answer' } : block) };
    render(completed, false, options);
    expect(assertOrder()).toBe(liveAnswer);
    render(completed, false, { ...options, rowKey: 'reloaded-history' });
    assertOrder();
  });

  it.each(['sending', 'waiting'] as const)('shows a text status while %s without a dot bubble', (pendingResponseStatus) => {
    render({ role: 'assistant', content: [], pendingResponseStatus }, true);
    const status = container.querySelector('[data-assistant-running] [role="status"]');
    expect(status?.getAttribute('data-status-phase')).toBe(pendingResponseStatus);
    expect(status?.textContent?.trim()).toBeTruthy();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('.xopc-personal-thinking-dots')).toBeNull();
  });

  it('removes the waiting label when answer text starts and reserves the completed action row', () => {
    const waiting: Message = { role: 'assistant', content: [], pendingResponseStatus: 'waiting' };
    render(waiting, true);
    expect(container.querySelector('[data-status-phase="waiting"]')?.textContent).toContain('waiting for a response');
    expect(container.querySelector('.xopc-personal-thinking-dots')).toBeNull();

    const answer: Message = { role: 'assistant', content: [{ type: 'text', text: 'The answer.' }] };
    render(answer, true);
    expect(container.textContent).not.toContain('waiting for a response');
    expect(container.querySelector('[data-assistant-actions-placeholder]')).not.toBeNull();
    expect(container.querySelector('[data-assistant-message-actions]')).toBeNull();

    render(answer, false);
    expect(container.querySelector('[data-assistant-actions-placeholder]')).toBeNull();
    expect(container.querySelector('[data-assistant-message-actions]')).not.toBeNull();
  });
});

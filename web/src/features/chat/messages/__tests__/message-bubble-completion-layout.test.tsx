// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import type { Message } from '@/features/chat/messages/messages.types';
import { useLocaleStore } from '@/stores/locale-store';

describe('assistant reply completion layout', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(message: Message, isStreaming: boolean) {
    act(() => root.render(
      <MemoryRouter>
        <MessageBubble message={message} isStreaming={isStreaming} progress={null} />
      </MemoryRouter>,
    ));
  }

  it('removes the waiting label when answer text starts and reserves the completed action row', () => {
    const waiting: Message = { role: 'assistant', content: [], pendingResponseStatus: 'waiting' };
    render(waiting, true);
    expect(container.textContent).toContain('waiting for a response');

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

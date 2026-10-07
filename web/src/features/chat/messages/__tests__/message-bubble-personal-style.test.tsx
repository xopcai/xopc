// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import type { Message } from '@/features/chat/messages/messages.types';
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

  it('tightens only the Personal AI user bubble corner', () => {
    const message: Message = { role: 'user', content: [{ type: 'text', text: 'Hello' }] };
    render(message, true, false);
    expect(container.querySelector('.chat-user-message')?.classList.contains('rounded-tr-sm')).toBe(true);

    render(message, false, false);
    expect(container.querySelector('.chat-user-message')?.classList.contains('rounded-tr-sm')).toBe(false);
  });

  it('shows the waiting outline until an assistant answer starts', () => {
    render({ role: 'assistant', content: [], pendingResponseStatus: 'waiting' }, true, true);
    expect(container.querySelector('[role="status"].xopc-personal-thinking')).not.toBeNull();

    render({ role: 'assistant', content: [{ type: 'text', text: 'Hello back' }] }, true, true);
    expect(container.querySelector('.xopc-personal-thinking')).toBeNull();

    render({ role: 'assistant', content: [] }, false, true);
    expect(container.querySelector('.xopc-personal-thinking')).toBeNull();
  });
});

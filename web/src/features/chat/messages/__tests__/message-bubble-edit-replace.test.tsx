// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import type { Message } from '@/features/chat/messages/messages.types';
import { useLocaleStore } from '@/stores/locale-store';

describe('MessageBubble user edit action', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const message: Message = {
    role: 'user',
    turnId: 'turn-1',
    content: [{ type: 'text', text: 'original' }],
  };

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

  it('passes the persisted message identity to the editor', () => {
    const onEditUserMessage = vi.fn();
    act(() => {
      root.render(
        <MemoryRouter>
          <MessageBubble
            message={message}
            messageIndex={2}
            isStreaming={false}
            progress={null}
            onEditUserMessage={onEditUserMessage}
          />
        </MemoryRouter>,
      );
    });

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Edit in composer"]')?.click());
    expect(onEditUserMessage).toHaveBeenCalledWith(message, 2);
  });

  it('disables replacement for non-latest user rows', () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <MessageBubble
            message={message}
            messageIndex={0}
            isStreaming={false}
            progress={null}
            userMessageCanEdit={false}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Edit in composer"]')?.disabled).toBe(true);
  });
});

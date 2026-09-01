// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import { useLocaleStore } from '@/stores/locale-store';

describe('MessageBubble fork action', () => {
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

  it('forks from a completed assistant turn', async () => {
    const onForkAssistantTurn = vi.fn(async () => {});
    act(() => {
      root.render(
        <MemoryRouter>
          <MessageBubble
            message={{
              role: 'assistant',
              content: [{ type: 'text', text: 'Completed answer' }],
              turnId: 'turn-42',
            }}
            isStreaming={false}
            progress={null}
            onForkAssistantTurn={onForkAssistantTurn}
            responseFeedbackEnabled={false}
          />
        </MemoryRouter>,
      );
    });

    const forkButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Fork conversation from here"]',
    );
    expect(forkButton).not.toBeNull();
    await act(async () => forkButton?.click());
    expect(onForkAssistantTurn).toHaveBeenCalledWith('turn-42');
  });

  it('does not offer forking without a persisted turn id', () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <MessageBubble
            message={{ role: 'assistant', content: [{ type: 'text', text: 'Legacy answer' }] }}
            isStreaming={false}
            progress={null}
            onForkAssistantTurn={vi.fn()}
            responseFeedbackEnabled={false}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('button[aria-label="Fork conversation from here"]')).toBeNull();
  });
});

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import { useLocaleStore } from '@/stores/locale-store';

describe('MessageBubble save as note action', () => {
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

  it('saves the assistant Markdown from a single footer action', async () => {
    const onSaveAssistantAsNote = vi.fn(async () => {});
    act(() => {
      root.render(
        <MemoryRouter>
          <MessageBubble
            message={{
              role: 'assistant',
              content: [{ type: 'text', text: '## Result\n\nKeep **this**.' }],
            }}
            isStreaming={false}
            progress={null}
            onSaveAssistantAsNote={onSaveAssistantAsNote}
            responseFeedbackEnabled={false}
          />
        </MemoryRouter>,
      );
    });

    const saveButton = container.querySelector<HTMLButtonElement>('button[aria-label="Save as note"]');
    expect(saveButton).not.toBeNull();

    await act(async () => saveButton?.click());

    expect(onSaveAssistantAsNote).toHaveBeenCalledOnce();
    expect(onSaveAssistantAsNote).toHaveBeenCalledWith('## Result\n\nKeep **this**.');
    expect(container.querySelector('button[aria-label="Saved as note"]')).not.toBeNull();
  });
});

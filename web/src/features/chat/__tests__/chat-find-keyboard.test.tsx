// @vitest-environment jsdom

import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatFindBar } from '@/features/chat/find/chat-find-bar';
import { useChatFind } from '@/features/chat/find/use-chat-find';

const labels = {
  input: 'Find in conversation',
  previous: 'Previous result',
  next: 'Next result',
  close: 'Close find',
  noResults: 'No results',
  resultCount: '{{current}} / {{total}} results',
  searching: 'Searching…',
  loadedOnly: 'Loaded messages only',
};

function Harness() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const find = useChatFind({
    conversationId: null,
    messages: [],
    displayOffset: 0,
    viewportRef,
    onRevealDisplayIndex: () => undefined,
  });
  return (
    <>
      <button type="button" data-before>Before</button>
      <ChatFindBar
        open={find.open}
        query={find.query}
        activeIndex={find.activeIndex}
        resultCount={find.resultCount}
        inputRef={find.inputRef}
        labels={labels}
        onQueryChange={find.setQuery}
        onPrevious={find.previous}
        onNext={find.next}
        onClose={find.close}
      />
      <div ref={viewportRef} />
    </>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('chat find keyboard', () => {
  it('opens with Cmd/Ctrl+F and restores focus on Escape', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Harness />));
      const before = container.querySelector<HTMLButtonElement>('[data-before]')!;
      before.focus();

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'f',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }));
      });
      expect(document.activeElement?.getAttribute('aria-label')).toBe(labels.input);

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }));
      });
      expect(document.activeElement).toBe(before);
      expect(container.querySelector('[data-chat-find-bar]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

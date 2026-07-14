// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
import {
  useChatScrollViewport,
  type UseChatScrollViewportResult,
} from '@/features/chat/scroll/use-chat-scroll-viewport';

const chatMessages: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'Question' }], timestamp: 1 },
];

describe('useChatScrollViewport', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let resizeCallback: ResizeObserverCallback | null;
  let resizeObserver: ResizeObserver | null;
  let viewport: UseChatScrollViewportResult | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resizeCallback = null;
    resizeObserver = null;
    viewport = null;

    class ResizeObserverMock implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
        resizeObserver = this;
      }

      disconnect() {}
      observe() {}
      unobserve() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('follows content growth before paint and respects the next real user scroll', () => {
    function Harness() {
      viewport = useChatScrollViewport({
        hasToken: true,
        showSessionLoading: false,
        sessionKey: 'session-1',
        sending: false,
        chatMessages,
        hasMore: false,
        loadingMore: false,
        loadMoreMessages: () => {},
      });
      return (
        <div ref={viewport.scrollRef} onScroll={viewport.onScroll}>
          <div ref={viewport.registerListContentRef} />
        </div>
      );
    }

    act(() => root.render(<Harness />));

    const scrollElement = container.firstElementChild as HTMLDivElement;
    let scrollHeight = 1000;
    const clientHeight = 400;
    let scrollTop = 600;
    Object.defineProperties(scrollElement, {
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight));
        },
      },
    });

    scrollHeight = 1080;
    act(() => resizeCallback?.([], resizeObserver!));
    expect(scrollTop).toBe(680);

    act(() => viewport?.scrollToBottom(false));
    act(() => {
      scrollTop = 400;
      scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(viewport?.atBottom).toBe(false);

    scrollHeight = 1160;
    act(() => resizeCallback?.([], resizeObserver!));
    expect(scrollTop).toBe(400);
  });
});

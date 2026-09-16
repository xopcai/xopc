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
  let observers: Map<Element, () => void>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resizeCallback = null;
    resizeObserver = null;
    viewport = null;
    observers = new Map();

    class ResizeObserverMock implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {
        resizeCallback = callback;
        resizeObserver = this;
      }

      disconnect() {}
      observe(target: Element) {
        observers.set(target, () => this.callback([], this));
      }
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

  function Harness() {
    viewport = useChatScrollViewport({
      hasToken: true,
      showSessionLoading: false,
      conversationId: 'session-1',
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


  it('follows content growth before paint and respects the next real user scroll', () => {

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

  it('keeps the button hidden for upward gestures when content fits and continues following growth', () => {
    act(() => root.render(<Harness />));
    const el = container.firstElementChild as HTMLDivElement;
    let height = 400;
    let top = 0;
    Object.defineProperties(el, {
      clientHeight: { get: () => 600 },
      scrollHeight: { get: () => height },
      scrollTop: {
        get: () => top,
        set: (value: number) => { top = Math.max(0, Math.min(value, height - 600)); },
      },
    });
    act(() => el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })));
    expect(viewport?.atBottom).toBe(true);
    act(() => {
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [{ clientY: 100 } as Touch] }));
      el.dispatchEvent(new TouchEvent('touchmove', { touches: [{ clientY: 150 } as Touch] }));
    });
    expect(viewport?.atBottom).toBe(true);
    height = 1000;
    act(() => resizeCallback?.([], resizeObserver!));
    expect(top).toBe(400);
    expect(viewport?.atBottom).toBe(true);
  });

  it('shows the button only after moving beyond the bottom threshold', () => {
    act(() => root.render(<Harness />));
    const el = container.firstElementChild as HTMLDivElement;
    Object.defineProperties(el, {
      clientHeight: { value: 400 },
      scrollHeight: { value: 1000 },
    });
    el.scrollTop = 600;
    act(() => el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })));
    expect(viewport?.atBottom).toBe(true);
    for (const [top, near] of [[580, true], [500, false], [600, true]] as const) {
      act(() => {
        el.scrollTop = top;
        el.dispatchEvent(new Event('scroll'));
      });
      expect(viewport?.atBottom).toBe(near);
    }
  });

  it.each(['content collapse', 'viewport expansion'])('hides the button after %s without a scroll event', (change) => {
    act(() => root.render(<Harness />));
    const el = container.firstElementChild as HTMLDivElement;
    let height = 1000;
    let clientHeight = 400;
    Object.defineProperties(el, {
      clientHeight: { get: () => clientHeight },
      scrollHeight: { get: () => height },
    });
    act(() => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    expect(viewport?.atBottom).toBe(false);
    if (change === 'content collapse') height = 400;
    else clientHeight = 1000;
    const resizedElement = change === 'content collapse' ? el.firstElementChild! : el;
    act(() => observers.get(resizedElement)?.());
    expect(viewport?.atBottom).toBe(true);
  });

});

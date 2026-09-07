import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ setState: vi.fn(), cleanups: [] as Array<() => void> }));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, lifecycle.setState],
  useCallback: (callback: unknown) => callback,
  useLayoutEffect: (effect: () => void) => effect(),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) lifecycle.cleanups.push(cleanup);
  },
}));

import { messageKey } from '../message-key';
import { useChatListScrollFollow } from '../use-chat-list-scroll-follow';

type ScrollEvent = Parameters<ReturnType<typeof useChatListScrollFollow>['onScroll']>[0];
function scroll(y: number, height = 1000): ScrollEvent {
  return { nativeEvent: {
    contentOffset: { x: 0, y },
    contentSize: { width: 400, height },
    layoutMeasurement: { width: 400, height: 500 },
  } } as ScrollEvent;
}

function setup() {
  const scrollToEnd = vi.fn();
  const onAtBottomChange = vi.fn();
  const listRef = { current: { scrollToEnd } } as unknown as Parameters<typeof useChatListScrollFollow>[0]['listRef'];
  const handlers = useChatListScrollFollow({
    listRef,
    messages: [{ id: 'answer', role: 'assistant', content: [] }],
    streaming: true,
    keyboardPadding: 0,
    sessionKey: 'session',
    onAtBottomChange,
    getMessageKey: messageKey,
  });
  vi.runAllTimers();
  scrollToEnd.mockClear();
  return { ...handlers, scrollToEnd, onAtBottomChange };
}

beforeEach(() => {
  lifecycle.setState.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => {
  lifecycle.cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('measured chat scroll follow', () => {
  it('coalesces native height changes and stays pinned through layout scroll events', () => {
    const chat = setup();
    chat.onContentSizeChange(400, 1200);
    chat.onScroll(scroll(500, 1200));
    chat.onContentSizeChange(400, 1200);
    vi.runAllTimers();
    expect(chat.scrollToEnd).toHaveBeenCalledExactlyOnceWith({ animated: false });
    expect(chat.onAtBottomChange).not.toHaveBeenCalled();
  });

  it('cancels pending follow and keeps history reading position as tokens arrive', () => {
    const chat = setup();
    chat.onContentSizeChange(400, 1200);
    chat.onScrollBeginDrag(scroll(500));
    chat.onScroll(scroll(350));
    chat.onScrollEndDrag(scroll(350));
    chat.onContentSizeChange(400, 1200);
    vi.runAllTimers();
    expect(chat.onAtBottomChange).toHaveBeenLastCalledWith(false);
    expect(chat.scrollToEnd).not.toHaveBeenCalled();
    chat.scrollToBottom();
    expect(chat.scrollToEnd).toHaveBeenCalledWith({ animated: true });
  });

  it('does not fight momentum and resumes following after reaching the bottom', () => {
    const chat = setup();
    chat.onScrollBeginDrag(scroll(300));
    chat.onScrollEndDrag(scroll(490));
    chat.onMomentumScrollBegin();
    chat.onContentSizeChange(400, 1200);
    vi.runAllTimers();
    expect(chat.scrollToEnd).not.toHaveBeenCalled();
    chat.onMomentumScrollEnd(scroll(500));
    vi.runAllTimers();
    expect(chat.scrollToEnd).toHaveBeenCalledExactlyOnceWith({ animated: false });
  });

  it('never shows the button for a short list, including pull-down bounce', () => {
    const chat = setup();
    chat.onScrollBeginDrag(scroll(0, 300));
    chat.onScroll(scroll(-250, 300));
    chat.onScrollEndDrag(scroll(-250, 300));
    expect(lifecycle.setState).not.toHaveBeenCalledWith(true);
    expect(chat.onAtBottomChange).not.toHaveBeenCalledWith(false);
  });

  it('shows only away from the bottom and hides when content shrinks to fit', () => {
    const chat = setup();
    chat.onScrollBeginDrag(scroll(500));
    chat.onScroll(scroll(490));
    expect(lifecycle.setState).not.toHaveBeenCalledWith(true);
    chat.onScroll(scroll(350));
    expect(lifecycle.setState).toHaveBeenLastCalledWith(true);
    chat.onContentSizeChange(400, 300);
    expect(lifecycle.setState).toHaveBeenLastCalledWith(false);
  });

  it('hides when the viewport grows or a native scroll reaches the bottom', () => {
    const chat = setup();
    chat.onScrollBeginDrag(scroll(300));
    chat.onScrollEndDrag(scroll(300));
    expect(lifecycle.setState).toHaveBeenLastCalledWith(true);
    chat.onScroll(scroll(500));
    expect(lifecycle.setState).toHaveBeenLastCalledWith(false);
    chat.onScrollBeginDrag(scroll(300));
    chat.onScrollEndDrag(scroll(300));
    expect(lifecycle.setState).toHaveBeenLastCalledWith(true);
    chat.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 1100 } } } as Parameters<typeof chat.onLayout>[0]);
    expect(lifecycle.setState).toHaveBeenLastCalledWith(false);
  });

  it('cancels a scheduled native scroll on unmount', () => {
    const chat = setup();
    chat.onContentSizeChange(400, 1200);
    lifecycle.cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.runAllTimers();
    expect(chat.scrollToEnd).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const keyboard = vi.hoisted(() => ({ height: { value: 0 }, progress: { value: 0 }, handlers: {} as Record<string, () => void> }));
vi.mock('react-native-keyboard-controller', () => ({
  useReanimatedKeyboardAnimation: () => keyboard,
  useKeyboardHandler: (handlers: typeof keyboard.handlers) => { keyboard.handlers = handlers; },
}));
vi.mock('react-native-reanimated', () => ({ useSharedValue: (value: unknown) => ({ value }) }));
vi.mock('react-native-worklets', () => ({ scheduleOnRN: (callback: () => void) => callback() }));

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

function setup({ loadingOlder = false }: { loadingOlder?: boolean } = {}) {
  const scrollToEnd = vi.fn();
  const scrollToOffset = vi.fn();
  const onAtBottomChange = vi.fn();
  const listRef = { current: { scrollToEnd, scrollToOffset } } as unknown as Parameters<typeof useChatListScrollFollow>[0]['listRef'];
  const handlers = useChatListScrollFollow({
    listRef,
    messages: [{ id: 'answer', role: 'assistant', content: [] }],
    loadingOlder,
    conversationId: 'session',
    onAtBottomChange,
    getMessageKey: messageKey,
  });
  vi.runAllTimers();
  scrollToEnd.mockClear();
  return { ...handlers, scrollToEnd, scrollToOffset, onAtBottomChange };
}

beforeEach(() => {
  keyboard.height.value = 0;
  keyboard.progress.value = 0;
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
  it('coalesces streamed content growth into one bottom follow per frame', () => {
    const chat = setup();
    chat.onContentSizeChange(400, 1200);
    chat.onScroll(scroll(500, 1200));
    chat.onContentSizeChange(400, 1220);
    chat.onContentSizeChange(400, 1240);
    vi.runAllTimers();
    expect(chat.scrollToEnd).toHaveBeenCalledExactlyOnceWith({ animated: false });
    expect(chat.onAtBottomChange).not.toHaveBeenCalled();
  });

  it('restores the bottom when native metrics arrive before a completion layout callback', () => {
    const chat = setup();
    chat.onContentSizeChange(400, 1200);
    vi.runAllTimers();
    chat.scrollToEnd.mockClear();
    chat.onScroll(scroll(400, 900));
    chat.onContentSizeChange(400, 900);
    vi.runAllTimers();
    expect(chat.scrollToEnd).toHaveBeenCalledExactlyOnceWith({ animated: false });
  });

  it('leaves prepend anchoring to FlashList while older history is loading', () => {
    const chat = setup({ loadingOlder: true });
    chat.onContentSizeChange(400, 1600);
    vi.runAllTimers();
    expect(chat.scrollToEnd).not.toHaveBeenCalled();
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
    expect(chat.scrollToEnd).toHaveBeenCalledWith({ animated: false });
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
    chat.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 500 } } } as Parameters<typeof chat.onLayout>[0]);
    lifecycle.cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.runAllTimers();
    expect(chat.scrollToEnd).not.toHaveBeenCalled();
  });
});

it('leaves keyboard frame movement to the native scroll owner', () => {
  const chat = setup();
  keyboard.height.value = -150;
  keyboard.progress.value = 0.5;
  chat.onLayout({ nativeEvent: { layout: { height: 450 } } } as Parameters<typeof chat.onLayout>[0]);
  vi.runAllTimers();
  expect(chat.scrollToEnd).not.toHaveBeenCalled();
  expect(chat.scrollToOffset).not.toHaveBeenCalled();
});

it('includes the native keyboard inset when returning to the latest message', () => {
  const chat = setup();
  keyboard.height.value = -300;
  keyboard.progress.value = 1;
  chat.onScroll(scroll(500));
  chat.scrollToBottom();
  expect(chat.scrollToOffset).toHaveBeenCalledWith({ offset: 800, animated: false });
  expect(chat.scrollToEnd).not.toHaveBeenCalled();
});

it('keeps the latest message pinned while dragging at the keyboard-adjusted bottom', () => {
  const chat = setup();
  keyboard.height.value = -300;
  keyboard.progress.value = 1;
  chat.onScrollBeginDrag(scroll(800));
  chat.onScrollEndDrag(scroll(800));
  vi.runAllTimers();
  expect(chat.onAtBottomChange).not.toHaveBeenCalledWith(false);
  expect(chat.scrollToOffset).toHaveBeenCalledWith({ offset: 800, animated: false });
});

it('preserves history reading when the keyboard is visible', () => {
  const chat = setup();
  keyboard.height.value = -300;
  keyboard.progress.value = 1;
  chat.onScrollBeginDrag(scroll(400));
  chat.onScrollEndDrag(scroll(350));
  vi.runAllTimers();
  expect(chat.onAtBottomChange).toHaveBeenCalledWith(false);
  expect(chat.scrollToOffset).not.toHaveBeenCalled();
});

it.each([0, 1])('blocks resize scrolls at keyboard start even when progress is %s', (progress) => {
  const chat = setup();
  keyboard.progress.value = progress;
  keyboard.handlers.onStart();
  chat.onLayout({ nativeEvent: { layout: { height: 450 } } } as Parameters<typeof chat.onLayout>[0]);
  vi.runAllTimers();
  expect(chat.scrollToEnd).not.toHaveBeenCalled();
  expect(chat.scrollToOffset).not.toHaveBeenCalled();
  keyboard.handlers.onEnd();
  vi.runAllTimers();
  expect(chat.scrollToEnd).not.toHaveBeenCalled();
});

it('cancels a queued resize follow when the keyboard begins before the next frame', () => {
  const chat = setup();
  chat.onLayout({ nativeEvent: { layout: { height: 450 } } } as Parameters<typeof chat.onLayout>[0]);
  keyboard.handlers.onStart();
  vi.runAllTimers();
  expect(chat.scrollToEnd).not.toHaveBeenCalled();
});

it('defers streamed content follow until a keyboard transition settles', () => {
  const chat = setup();
  chat.onScroll(scroll(500));
  keyboard.handlers.onStart();
  chat.onContentSizeChange(400, 1200);
  chat.onContentSizeChange(400, 1240);
  vi.runAllTimers();
  expect(chat.scrollToEnd).not.toHaveBeenCalled();
  keyboard.height.value = -300;
  keyboard.progress.value = 1;
  keyboard.handlers.onEnd();
  vi.runAllTimers();
  expect(chat.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 1040, animated: false });
});

it('does not replay deferred follow after the user starts reading history', () => {
  const chat = setup();
  keyboard.handlers.onStart();
  chat.onContentSizeChange(400, 1200);
  chat.onScrollBeginDrag(scroll(300, 1200));
  chat.onScrollEndDrag(scroll(250, 1200));
  keyboard.handlers.onEnd();
  vi.runAllTimers();
  expect(chat.scrollToEnd).not.toHaveBeenCalled();
  expect(chat.scrollToOffset).not.toHaveBeenCalled();
});

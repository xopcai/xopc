// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: { height: number }) => void>,
  props: {} as {
    onLayout: (event: { nativeEvent: { layout: { height: number } } }) => void;
    onContentSizeChange: (width: number, height: number) => void;
    onScrollBeginDrag: (event: { nativeEvent: object }) => void;
  },
  offset: { value: 0 },
  scroll: vi.fn(),
  react: () => {},
}));
vi.mock('react-native-keyboard-controller', () => ({
  KeyboardChatScrollView: (props: typeof state.props) => { state.props = props; return null; },
  useKeyboardHandler: (handlers: typeof state.handlers) => { state.handlers = handlers; },
}));
vi.mock('react-native-reanimated', () => ({
  default: { ScrollView: () => null },
  useAnimatedRef: () => useRef(() => {}).current,
  useScrollOffset: () => state.offset,
  useSharedValue: (value: unknown) => useRef({ value }).current,
  useAnimatedReaction: (prepare: () => unknown, react: (value: unknown) => void) => {
    state.react = () => react(prepare());
  },
  scrollTo: (_ref: unknown, _x: number, y: number) => { state.offset.value = y; state.scroll(y); },
}));
import { ChatKeyboardScrollView } from '../ChatKeyboardScrollView';

const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (element: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
const layout = (height: number) => state.props.onLayout({ nativeEvent: { layout: { height } } });
function frame(height: number, viewport: number) {
  state.handlers.onMove({ height });
  layout(viewport);
  state.react();
}
beforeEach(() => {
  root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(ChatKeyboardScrollView)));
  state.props.onContentSizeChange(400, 2400);
  layout(540);
  state.offset.value = 1860;
  state.scroll.mockClear();
});
afterEach(() => act(() => root.unmount()));

it('returns to the same live edge across repeated keyboard cycles and safe-area resizing', () => {
  for (let cycle = 0; cycle < 5; cycle++) {
    state.handlers.onStart({ height: 335 });
    frame(167, 557);
    expect(state.offset.value).toBe(2010);
    frame(335, 574);
    state.handlers.onEnd({ height: 335 });
    expect(state.offset.value).toBe(2161);
    state.handlers.onStart({ height: 0 });
    frame(167, 557);
    frame(0, 540);
    state.handlers.onEnd({ height: 0 });
    expect(state.offset.value).toBe(1860);
  }
});
it('accounts for the tab dock releasing space without cumulative scrolling', () => {
  state.handlers.onStart({ height: 335 });
  frame(335, 630);
  expect(state.offset.value).toBe(2105);
  state.handlers.onEnd({ height: 335 });
  state.handlers.onStart({ height: 0 });
  frame(0, 540);
  state.handlers.onEnd({ height: 0 });
  expect(state.offset.value).toBe(1860);
});
it('keeps a history reader in place during keyboard opening and closing', () => {
  state.offset.value = 500;
  state.handlers.onStart({ height: 335 });
  frame(335, 574);
  state.handlers.onEnd({ height: 335 });
  state.handlers.onStart({ height: 0 });
  frame(0, 540);
  expect(state.scroll).not.toHaveBeenCalled();
});
it('yields native keyboard follow when the user starts dragging', () => {
  state.handlers.onStart({ height: 335 });
  frame(335, 574);
  state.handlers.onEnd({ height: 335 });
  state.props.onScrollBeginDrag({ nativeEvent: {} });
  state.offset.value = 500;
  state.scroll.mockClear();
  state.handlers.onInteractive({ height: 150 });
  state.react();
  expect(state.scroll).not.toHaveBeenCalled();
});
it('follows the final viewport measurement even when it arrives after keyboard end', () => {
  state.handlers.onStart({ height: 335 });
  frame(335, 574);
  state.handlers.onEnd({ height: 335 });
  state.handlers.onStart({ height: 0 });
  frame(0, 574);
  state.handlers.onEnd({ height: 0 });
  layout(540);
  state.react();
  expect(state.offset.value).toBe(1860);
});

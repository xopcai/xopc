// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, useRef, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  finishes: [] as Array<(finished: boolean) => void>,
  back: undefined as undefined | (() => boolean),
  height: { value: 0 },
  handlers: {} as Record<string, (event: { height: number }) => void>,
  reducedMotion: false,
  blur: undefined as undefined | (() => void),
  styles: [] as Array<{ height: number; opacity: number }>,
}));
vi.mock('expo-router', () => ({ useFocusEffect: (effect: () => () => void) => { state.blur = effect(); } }));
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement('div', { 'data-scroll': true }, children),
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: {
    children: (state: { pressed: boolean }) => ReactNode; onPress: () => void; disabled: boolean; accessibilityLabel: string;
  }) => createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children({ pressed: false })),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useWindowDimensions: () => ({ height: 800, fontScale: 1 }),
  BackHandler: { addEventListener: (_name: string, callback: () => boolean) => {
    state.back = callback;
    return { remove: () => { state.back = undefined; } };
  } },
}));
vi.mock('react-native-paper', () => ({
  Icon: () => null,
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}));
vi.mock('react-native-keyboard-controller', () => ({
  useReanimatedKeyboardAnimation: () => ({ height: state.height }),
  useKeyboardHandler: (handlers: typeof state.handlers) => { state.handlers = handlers; },
}));
vi.mock('react-native-reanimated', () => ({
  default: { View: ({ children }: { children: ReactNode }) => createElement('div', null, children) },
  useSharedValue: (value: number) => useRef({ value }).current,
  useAnimatedStyle: (callback: () => { height: number; opacity: number }) => { const style = callback(); state.styles.push(style); return style; },
  withTiming: (value: number, _options: unknown, finish: (finished: boolean) => void) => {
    state.finishes.push(finish);
    return value;
  },
  cancelAnimation: () => {},
}));
vi.mock('react-native-worklets', () => ({ scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args) }));
vi.mock('../../../motion', () => ({
  motion: { duration: { standard: 220 }, easing: { enter: undefined, exit: undefined } },
  useReducedMotion: () => state.reducedMotion,
}));
vi.mock('../../../theme', async () => {
  const tokens = await import('../../../theme/tokens');
  return { ...tokens, useTheme: () => ({ colors: tokens.colors.light }) };
});
import { ComposerActionPanel } from '../composer-action-panel';

const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (container: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLElement;
let toggle: (visible: boolean) => void;
const action = vi.fn();
function Harness() {
  const [visible, setVisible] = useState(true);
  toggle = setVisible;
  return createElement(ComposerActionPanel, {
    visible,
    onClose: () => setVisible(false),
    items: [
      { key: 'photo', label: 'Photo', icon: 'image', onPress: action },
      { key: 'disabled', label: 'Disabled', icon: 'image', disabled: true, onPress: action },
    ],
  });
}
beforeEach(() => {
  action.mockClear();
  state.finishes = [];
  state.height.value = 0;
  state.reducedMotion = false;
  state.styles = [];
  container = document.createElement('div');
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});
afterEach(() => act(() => root.unmount()));

it('runs a selected action once, only after the close transition finishes', () => {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Photo"]')!.click());
  expect(action).not.toHaveBeenCalled();
  act(() => state.finishes.at(-1)!(true));
  expect(action).toHaveBeenCalledTimes(1);
  act(() => state.finishes.at(-1)!(true));
  expect(action).toHaveBeenCalledTimes(1);
});

it('does not dispatch disabled actions and consumes Back only while open', () => {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Disabled"]')!.click());
  expect(action).not.toHaveBeenCalled();
  act(() => { expect(state.back?.()).toBe(true); });
  expect(state.back).toBeUndefined();
});

it('cancels a queued action when reopening interrupts dismissal', () => {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Photo"]')!.click());
  const interruptedClose = state.finishes.at(-1)!;
  act(() => toggle(true));
  act(() => interruptedClose(false));
  expect(action).not.toHaveBeenCalled();
});

it('uses a single scroll container so page tiles cannot capture a competing vertical scroll', () => {
  expect(container.querySelectorAll('[data-scroll]')).toHaveLength(1);
});


it('closes when the keyboard opens even without a new input focus event', () => {
  act(() => state.handlers.onStart({ height: 320 }));
  expect(state.back).toBeUndefined();
  expect(state.styles.at(-1)?.opacity).toBe(0);
  expect(action).not.toHaveBeenCalled();
});

it('does not dismiss the panel when replacing an outgoing keyboard', () => {
  act(() => state.handlers.onStart({ height: 0 }));
  act(() => state.handlers.onEnd({ height: 0 }));
  expect(state.back).toBeDefined();
});

it('cancels a queued action if the user returns to typing during the close animation', () => {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Photo"]')!.click());
  act(() => state.handlers.onStart({ height: 320 }));
  act(() => state.finishes.at(-1)!(true));
  expect(action).not.toHaveBeenCalled();
});

it('closes on a cancelled keyboard dismissal that ends with a visible keyboard', () => {
  act(() => state.handlers.onEnd({ height: 280 }));
  expect(state.back).toBeUndefined();
});

it('never reserves negative panel space when the keyboard is taller than the panel', () => {
  state.height.value = -500;
  act(() => toggle(false));
  expect(state.styles.at(-1)?.height).toBe(0);
});


it('ignores a stale close completion after a newer action starts closing', () => {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Photo"]')!.click());
  const staleClose = state.finishes.at(-1)!;
  act(() => toggle(true));
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Photo"]')!.click());
  act(() => staleClose(true));
  expect(action).not.toHaveBeenCalled();
  act(() => state.finishes.at(-1)!(true));
  expect(action).toHaveBeenCalledOnce();
});

it('does not launch an action after leaving the chat while its panel is closing', () => {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Photo"]')!.click());
  act(() => state.blur?.());
  act(() => state.finishes.at(-1)!(true));
  expect(action).not.toHaveBeenCalled();
});

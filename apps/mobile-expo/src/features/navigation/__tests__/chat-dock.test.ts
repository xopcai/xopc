// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, useEffect, useRef, type ReactNode } from 'react';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  progress: { value: 0 },
  handlers: {} as Record<string, (event: { height: number }) => void>,
  style: (() => ({})) as () => { height?: number; opacity?: number; paddingBottom?: number },
  values: [] as Array<{ value: number }>,
  finish: undefined as undefined | ((finished: boolean) => void),
  tabProps: undefined as BottomTabBarProps | undefined,
}));
vi.mock('expo-router/js-tabs', () => ({ BottomTabBar: (props: BottomTabBarProps) => {
  state.tabProps = props;
  return createElement('nav', { 'data-testid': 'tabs' });
} }));
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Pressable: () => null, I18nManager: { isRTL: false },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock('react-native-paper', () => ({ Icon: () => null }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 24 }) }));
vi.mock('react-native-keyboard-controller', () => ({
  KeyboardController: { state: () => ({ height: 0 }) },
  useReanimatedKeyboardAnimation: () => ({ progress: state.progress }),
  useKeyboardHandler: (handlers: typeof state.handlers) => { state.handlers = handlers; },
  KeyboardStickyView: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));
vi.mock('react-native-reanimated', () => ({
  default: { View: ({ children, testID }: { children: ReactNode; testID?: string }) => createElement('div', { 'data-testid': testID }, children) },
  useSharedValue: (initial: number) => {
    const ref = useRef({ value: initial });
    if (!state.values.includes(ref.current)) state.values.push(ref.current);
    return ref.current;
  },
  useAnimatedStyle: (style: typeof state.style) => { state.style = style; return {}; },
  withTiming: (value: number, _options: unknown, finish?: (finished: boolean) => void) => { state.finish = finish; return value; },
  withSpring: (value: number) => value,
}));
vi.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: (value: boolean) => void, value: boolean) => fn(value) }));
vi.mock('../../../motion', () => ({ motion: { duration: { standard: 220 }, easing: {} }, useReducedMotion: () => false }));
vi.mock('../../../theme', async () => {
  const tokens = await import('../../../theme/tokens');
  return { ...tokens, ...(await import('../../../theme/layout')), useTheme: () => ({ colors: tokens.colors.light, elevation: tokens.elevations.light }) };
});
import { CapsuleTabBar, TAB_DOCK_HEIGHT } from '../CapsuleTabBar';
import { useChatChromeStore } from '../chat-chrome-store';
import { ChatComposerDock } from '../../chat/ChatComposerDock';
import { ChatTabDockProvider } from '../ChatTabDockContext';

const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (element: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function mount(name = '(chat)') {
  const props = { state: { index: 0, routes: [{ key: name, name }] }, descriptors: {} } as unknown as BottomTabBarProps;
  act(() => root.render(createElement(CapsuleTabBar, props)));
}
beforeEach(() => {
  useChatChromeStore.setState({ actionPanelOpen: false });
  state.progress.value = 0;
  state.values = [];
  state.tabProps = undefined;
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));
it('releases all dock space with the keyboard and restores it progressively', () => {
  mount();
  expect(state.style().height).toBe(TAB_DOCK_HEIGHT + 24);
  state.progress.value = 1;
  expect(state.style().height).toBe(0);
  state.progress.value = 0.5;
  expect(state.style().height).toBe((TAB_DOCK_HEIGHT + 24) / 2);
  state.progress.value = 0;
  act(() => state.handlers.onEnd({ height: 0 }));
  expect(state.style().height).toBe(TAB_DOCK_HEIGHT + 24);
});
it('hides for root chat accessories but not for another tab', () => {
  mount();
  act(() => useChatChromeStore.getState().setActionPanelOpen(true));
  expect(state.style().height).toBe(0);
  mount('library');
  expect(state.style().height).toBe(TAB_DOCK_HEIGHT + 24);
});
it('keeps tabs hidden throughout the accessory-to-keyboard handoff', () => {
  mount();
  act(() => useChatChromeStore.getState().setActionPanelOpen(true));
  act(() => state.handlers.onStart({ height: 300 }));
  act(() => useChatChromeStore.getState().setActionPanelOpen(false));
  state.values[0].value = 0.4;
  state.progress.value = 0.4;
  expect(state.style().height).toBe(0);
  state.progress.value = 1;
  act(() => state.handlers.onEnd({ height: 300 }));
  expect(state.style().height).toBe(0);
});
it('keeps tabs hidden throughout the keyboard-to-accessory handoff', () => {
  mount();
  state.progress.value = 1;
  act(() => useChatChromeStore.getState().setActionPanelOpen(true));
  state.values[0].value = 0.4;
  state.progress.value = 0.4;
  expect(state.style().height).toBe(0);
  act(() => state.handlers.onEnd({ height: 0 }));
  expect(state.style().height).toBe(0);
  state.values[0].value = 1;
  state.progress.value = 0;
  act(() => state.finish?.(true));
  expect(state.style().height).toBe(0);
});
it('assigns the root accessory safe area only while the keyboard is absent', () => {
  act(() => root.render(createElement(ChatComposerDock, { root: true, panelOpen: true, bottomInset: 24, children: null })));
  expect(state.style().paddingBottom).toBe(24);
  state.progress.value = 1;
  expect(state.style().paddingBottom).toBe(0);
});

function navigationProps(name = '(chat)'): BottomTabBarProps {
  return {
    state: { index: 0, routes: [{ key: name, name }] },
    navigation: { navigate: vi.fn(), emit: vi.fn() },
    descriptors: { [name]: { options: {
      tabBarLabel: 'Chat', tabBarBadge: 3,
      tabBarStyle: { marginHorizontal: 12, marginBottom: 24, backgroundColor: 'transparent' },
    } } },
  } as unknown as BottomTabBarProps;
}

it('places composer and tabs inside one surface, preserving navigator state and badges', () => {
  const props = navigationProps();
  act(() => root.render(createElement(ChatTabDockProvider, { ...props, children:
    createElement(ChatComposerDock, { root: true, panelOpen: false, bottomInset: 24,
      children: createElement('input', { 'data-testid': 'composer' }) }),
  })));
  const surface = container.querySelector('[data-testid="chat-bottom-region"]');
  expect(surface?.querySelector('[data-testid="composer"]')).not.toBeNull();
  expect(surface?.querySelectorAll('[data-testid="tabs"]').length).toBe(1);
  expect(state.tabProps?.navigation).toBe(props.navigation);
  expect(state.tabProps?.state).toBe(props.state);
  const options = state.tabProps?.descriptors['(chat)'].options;
  expect(options?.tabBarBadge).toBe(3);
  expect(options?.tabBarLabel).toBe('Chat');
  expect(options?.tabBarBackground).toBeUndefined();
  expect(options?.tabBarStyle).toEqual(expect.arrayContaining([expect.objectContaining({
    marginHorizontal: 0, marginBottom: 0, height: TAB_DOCK_HEIGHT + 24,
    paddingBottom: 28, borderRadius: 0, borderTopWidth: 0,
  })]));
});

it.each([{ rootChat: false, tab: '(chat)' }, { rootChat: true, tab: 'library' }])(
  'does not insert a second dock outside the active root chat: %j', ({ rootChat, tab }) => {
    act(() => root.render(createElement(ChatTabDockProvider, { ...navigationProps(tab), children:
      createElement(ChatComposerDock, { root: rootChat, panelOpen: false, bottomInset: 24, children: null }),
    })));
    expect(container.querySelector('[data-testid="tabs"]')).toBeNull();
  },
);

it('retains the composer instance and draft during keyboard and accessory transitions', () => {
  const mounted = vi.fn();
  function Composer() {
    useEffect(mounted, []);
    return createElement('input', { defaultValue: 'Unsent draft' });
  }
  const props = navigationProps();
  const render = (panelOpen: boolean) => act(() => root.render(createElement(ChatTabDockProvider, {
    ...props, children: createElement(ChatComposerDock, { root: true, panelOpen, bottomInset: 24,
      children: createElement(Composer) }),
  })));
  render(false);
  const input = container.querySelector('input');
  act(() => state.handlers.onStart({ height: 300 }));
  state.progress.value = 1;
  render(true);
  state.progress.value = 0;
  act(() => state.handlers.onEnd({ height: 0 }));
  render(false);
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(container.querySelector('input')).toBe(input);
  expect(input?.value).toBe('Unsent draft');
});

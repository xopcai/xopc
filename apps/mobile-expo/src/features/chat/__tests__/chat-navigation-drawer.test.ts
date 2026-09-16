// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, createRef, useEffect, useImperativeHandle, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DrawerLayoutProps, DrawerLayoutMethods } from 'react-native-gesture-handler/ReanimatedDrawerLayout';

const state = vi.hoisted(() => ({
  props: {} as DrawerLayoutProps,
  back: (() => false) as () => boolean,
  open: vi.fn(), close: vi.fn(), dismissKeyboard: vi.fn(), remove: vi.fn(),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }), useFocusEffect: (fn: () => () => void) => useEffect(fn, [fn]) }));
vi.mock('@shopify/flash-list', () => ({ FlashList: () => null }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
  useInfiniteQuery: () => ({
    data: undefined, hasNextPage: false, isFetchingNextPage: false, isLoading: false,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock('react-native', () => ({
  BackHandler: { addEventListener: (_: string, fn: () => boolean) => { state.back = fn; return { remove: state.remove }; } },
  Keyboard: { dismiss: state.dismissKeyboard },
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  ScrollView: () => null, Pressable: () => null,
  useWindowDimensions: () => ({ width: 390 }),
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}));
vi.mock('react-native-paper', () => ({ Icon: () => null, Text: () => null }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('../../../theme', async () => {
  const tokens = await import('../../../theme/tokens');
  return { ...tokens, useTheme: () => ({ colors: tokens.colors.light, elevation: tokens.elevations.light }) };
});
vi.mock('../../../i18n/messages', () => ({ useMessages: () => ({ drawer: {}, common: {}, sessions: { untitled: 'Untitled' } }) }));
vi.mock('../../../stores/gateway-store', () => ({ useGatewayStore: (selector: (state: { activeGatewayId: string }) => unknown) => selector({ activeGatewayId: 'gateway' }) }));
vi.mock('../../../query/projects', () => ({ fetchProjects: vi.fn() }));
vi.mock('../../../query/sessions', () => ({ fetchSessionsList: vi.fn() }));
vi.mock('../../../query/user-profile', () => ({ fetchUserProfileSummary: vi.fn() }));
vi.mock('react-native-gesture-handler/ReanimatedDrawerLayout', () => ({
  DrawerPosition: { LEFT: 0 }, DrawerType: { FRONT: 0 }, DrawerState: { DRAGGING: 1 },
  DrawerLockMode: { UNLOCKED: 0, LOCKED_CLOSED: 1 }, DrawerKeyboardDismissMode: { ON_DRAG: 1 },
  default: (props: DrawerLayoutProps & { ref: React.Ref<DrawerLayoutMethods> }) => {
    state.props = props;
    useImperativeHandle(props.ref, () => ({ openDrawer: state.open, closeDrawer: state.close }), []);
    return createElement('div', null, props.children as ReactNode);
  },
}));
import { ChatNavigationDrawer, type ChatNavigationDrawerHandle } from '../ChatNavigationDrawer';
const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (element: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
async function mount(swipeEnabled = true) {
  root = createRoot(document.createElement('div'));
  const ref = createRef<ChatNavigationDrawerHandle>();
  const onInteraction = vi.fn();
  await act(async () => root.render(createElement(ChatNavigationDrawer, {
    ref, swipeEnabled, onInteraction, currentConversationId: '',
    onSessionSelect: vi.fn(), onNewChat: vi.fn(), children: createElement('span', null, 'Chat'),
  })));
  return { ref, onInteraction };
}
afterEach(async () => { await act(async () => root.unmount()); vi.clearAllMocks(); });

it('opens from the header and dismisses keyboard and composer actions', async () => {
  const { ref, onInteraction } = await mount();
  act(() => ref.current?.open());
  expect(state.open).toHaveBeenCalledOnce();
  expect(state.dismissKeyboard).toHaveBeenCalledOnce();
  expect(onInteraction).toHaveBeenCalledOnce();
});
it('handles back during opening and releases back after closing', async () => {
  const { onInteraction } = await mount();
  expect(state.back()).toBe(false);
  act(() => state.props.onDrawerStateChanged?.(1, true));
  expect(onInteraction).toHaveBeenCalledOnce();
  expect(state.back()).toBe(true);
  expect(state.close).toHaveBeenCalledOnce();
  act(() => state.props.onDrawerClose?.());
  expect(state.back()).toBe(false);
});
it('disables opening gestures on pushed chat detail screens', async () => {
  await mount(false);
  expect(state.props.drawerLockMode).toBe(1);
});

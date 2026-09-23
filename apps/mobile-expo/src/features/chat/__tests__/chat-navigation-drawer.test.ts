// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, createRef, useEffect, useImperativeHandle, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DrawerLayoutProps, DrawerLayoutMethods } from 'react-native-gesture-handler/ReanimatedDrawerLayout';

const state = vi.hoisted(() => ({
  props: {} as DrawerLayoutProps,
  listProps: {} as {
    removeClippedSubviews?: boolean;
    renderItem?: (info: { item: unknown }) => React.ReactElement;
  },
  back: (() => false) as () => boolean,
  query: {
    data: undefined as undefined | { pages: Array<{ items: unknown[]; total: number }> },
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  },
  queryClient: { resetQueries: vi.fn(), invalidateQueries: vi.fn() },
  alert: vi.fn(),
  open: vi.fn(), close: vi.fn(), dismissKeyboard: vi.fn(), remove: vi.fn(),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }), useFocusEffect: (fn: () => () => void) => useEffect(fn, [fn]) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
  useInfiniteQuery: () => state.query,
  useQueryClient: () => state.queryClient,
}));
vi.mock('react-native', () => ({
  Alert: { alert: state.alert },
  BackHandler: { addEventListener: (_: string, fn: () => boolean) => { state.back = fn; return { remove: state.remove }; } },
  Keyboard: { dismiss: state.dismissKeyboard },
  FlatList: (props: typeof state.listProps) => { state.listProps = props; return null; },
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  ScrollView: () => null, Pressable: () => null,
  useWindowDimensions: () => ({ width: 390 }),
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}));
vi.mock('react-native-paper', () => ({ ActivityIndicator: () => null, Icon: () => null, Text: () => null }));
vi.mock('../../../components/AppToast', () => ({ AppToast: () => null }));
vi.mock('../../../components/ListItemMenu', () => ({ ListItemMenu: () => null }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('../../../theme', async () => {
  const tokens = await import('../../../theme/tokens');
  return { ...tokens, useTheme: () => ({ colors: tokens.colors.light, elevation: tokens.elevations.light }) };
});
vi.mock('../../../i18n/messages', () => ({ useMessages: () => ({
  drawer: { you: 'You' }, common: { close: 'Close', retry: 'Retry' }, sessions: { untitled: 'Untitled', loadFailed: 'Failed' },
  sessionActions: {
    pin: 'Pin', unpin: 'Unpin', archive: 'Archive', unarchive: 'Unarchive', delete: 'Delete',
    sessionPinned: 'Pinned', sessionUnpinned: 'Unpinned', sessionArchived: 'Archived',
    sessionUnarchived: 'Unarchived', sessionDeleted: 'Deleted', failedToPin: 'Pin failed',
    failedToUnpin: 'Unpin failed', failedToArchive: 'Archive failed',
    failedToUnarchive: 'Unarchive failed', failedToDelete: 'Delete failed',
  },
  deleteDialog: { title: 'Delete session', message: 'Delete {{name}}?', cancel: 'Cancel', delete: 'Delete' },
  listInteraction: { moreMenu: 'More actions' },
  sessionsPage: { groups: { today: 'Today', yesterday: 'Yesterday', thisWeek: 'This week', lastWeek: 'Last week', thisMonth: 'This month', earlier: 'Earlier' } },
}), t: (value: string, variables: Record<string, string>) => value.replace('{{name}}', variables.name) }));
vi.mock('../../../stores/gateway-store', () => ({ useGatewayStore: (selector: (state: { activeGatewayId: string }) => unknown) => selector({ activeGatewayId: 'gateway' }) }));
vi.mock('../../../stores/preferences-store', () => ({ usePreferencesStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'en' }) }));
vi.mock('../../../query/projects', () => ({ fetchProjects: vi.fn() }));
vi.mock('../../../query/sessions', () => ({
  archiveSession: vi.fn(), deleteSession: vi.fn(), fetchSessionsList: vi.fn(),
  pinSession: vi.fn(), unarchiveSession: vi.fn(), unpinSession: vi.fn(),
}));
vi.mock('../../../query/user-profile', () => ({ fetchUserProfileSummary: vi.fn() }));
vi.mock('react-native-gesture-handler/ReanimatedDrawerLayout', () => ({
  DrawerPosition: { LEFT: 0 }, DrawerType: { FRONT: 0 }, DrawerState: { DRAGGING: 1 },
  DrawerLockMode: { UNLOCKED: 0, LOCKED_CLOSED: 1 }, DrawerKeyboardDismissMode: { ON_DRAG: 1 },
  default: (props: DrawerLayoutProps & { ref: React.Ref<DrawerLayoutMethods> }) => {
    state.props = props;
    useImperativeHandle(props.ref, () => ({ openDrawer: state.open, closeDrawer: state.close }), []);
    return createElement('div', null, props.renderNavigationView({ value: 1 } as never), props.children as ReactNode);
  },
}));
import { ChatNavigationDrawer, type ChatNavigationDrawerHandle } from '../ChatNavigationDrawer';
import { deleteSession, pinSession } from '../../../query/sessions';
const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (element: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
async function mount(swipeEnabled = true) {
  root = createRoot(document.createElement('div'));
  const ref = createRef<ChatNavigationDrawerHandle>();
  const onInteraction = vi.fn();
  const onNewChat = vi.fn();
  await act(async () => root.render(createElement(ChatNavigationDrawer, {
    ref, swipeEnabled, onInteraction, currentConversationId: '',
    onSessionSelect: vi.fn(), onNewChat, children: createElement('span', null, 'Chat'),
  })));
  return { ref, onInteraction, onNewChat };
}
afterEach(async () => {
  await act(async () => root.unmount());
  state.query.data = undefined;
  vi.clearAllMocks();
});

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
it('keeps drawer rows mounted while the animated drawer transforms', async () => {
  await mount();
  expect(state.listProps.removeClippedSubviews).toBe(false);
});
it('offers pin, archive, and delete actions and refreshes after pinning', async () => {
  await mount();
  const row = state.listProps.renderItem?.({
    item: {
      type: 'session', key: 'session:alpha', isFirst: true, isLast: true,
      session: { key: 'alpha', title: 'Alpha', status: 'active', messageCount: 2, updatedAt: new Date().toISOString() },
    },
  }) as React.ReactElement<{ actions: Array<{ key: string }>; onActionPress: (action: { key: string }) => void }>;
  expect(row.props.actions.map(action => action.key)).toEqual(['pin', 'archive', 'delete']);
  await act(async () => {
    row.props.onActionPress(row.props.actions[0]);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(pinSession).toHaveBeenCalledWith('alpha');
  expect(state.queryClient.resetQueries).toHaveBeenCalledWith({ queryKey: ['sessions'] });
});
it('requires confirmation before deleting a drawer session', async () => {
  await mount();
  const row = state.listProps.renderItem?.({
    item: {
      type: 'session', key: 'session:alpha', isFirst: true, isLast: true,
      session: { key: 'alpha', title: 'Alpha', status: 'active', messageCount: 2, updatedAt: new Date().toISOString() },
    },
  }) as React.ReactElement<{ actions: Array<{ key: string }>; onActionPress: (action: { key: string }) => void }>;
  row.props.onActionPress(row.props.actions[2]);
  expect(deleteSession).not.toHaveBeenCalled();
  const buttons = state.alert.mock.calls[0]?.[2] as Array<{ onPress?: () => void }>;
  await act(async () => {
    buttons[1].onPress?.();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(deleteSession).toHaveBeenCalledWith('alpha');
});

import { useInfiniteQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import {
  BackHandler,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import ReanimatedDrawerLayout, {
  DrawerKeyboardDismissMode, DrawerLockMode, DrawerPosition, DrawerState, DrawerType,
  type DrawerLayoutMethods,
} from 'react-native-gesture-handler/ReanimatedDrawerLayout';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../../i18n/messages';
import { sessionDisplayName } from '../../lib/session-helpers';
import { useFlatListEndReached } from '../../lib/use-flat-list-end-reached';
import { queryKeys } from '../../query/keys';
import { fetchSessionsList, type SessionListItem, type SessionsPage } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { radii, spacing, typography, useTheme } from '../../theme';
import { buildSessionListRows, type SessionListRow } from '../sessions/session-time-groups';

const PAGE_SIZE = 20;

export type ChatNavigationDrawerHandle = { open: () => void };

export const ChatNavigationDrawer = memo(function ChatNavigationDrawer({
  ref,
  children,
  swipeEnabled,
  onInteraction,
  currentConversationId,
  onSessionSelect,
  onNewChat,
}: {
  ref?: Ref<ChatNavigationDrawerHandle>;
  children: ReactNode;
  swipeEnabled: boolean;
  onInteraction: () => void;
  currentConversationId: string;
  onSessionSelect: (conversationId: string) => void;
  onNewChat: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { colors, elevation } = useTheme();
  const m = useMessages();
  const copy = m.drawer;
  const language = usePreferencesStore(state => state.language);
  const activeGatewayId = useGatewayStore(state => state.activeGatewayId);
  const drawerWidth = Math.min(windowWidth * 0.94, 420);
  const drawerRef = useRef<DrawerLayoutMethods>(null);
  const drawerActive = useRef(false);
  const [drawerVisible, setDrawerVisible] = useState(false);

  const sessionsQuery = useInfiniteQuery({
    queryKey: queryKeys.drawerSessions(activeGatewayId ?? '', '', ''),
    queryFn: ({ pageParam, signal }) => fetchSessionsList({
      limit: PAGE_SIZE,
      offset: pageParam,
      search: '',
      channel: 'webchat',
      signal,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage: SessionsPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined,
    enabled: drawerVisible && Boolean(activeGatewayId),
    staleTime: 30_000,
  });

  const sessions = useMemo(() => {
    const byId = new Map<string, SessionListItem>();
    for (const page of sessionsQuery.data?.pages ?? []) {
      for (const session of page.items) byId.set(session.key, session);
    }
    return [...byId.values()];
  }, [sessionsQuery.data?.pages]);
  const sessionRows = useMemo(
    () => buildSessionListRows(
      sessions,
      m.sessionsPage.groups,
      language === 'zh' ? 'zh-CN' : 'en-US',
    ),
    [language, m.sessionsPage.groups, sessions],
  );
  const onDismiss = useCallback(() => drawerRef.current?.closeDrawer(), []);
  const prepareToOpen = useCallback(() => {
    Keyboard.dismiss();
    onInteraction();
    setDrawerVisible(true);
  }, [onInteraction]);

  useImperativeHandle(ref, () => ({
    open: () => {
      prepareToOpen();
      drawerRef.current?.openDrawer();
    },
  }), [prepareToOpen]);

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!drawerActive.current) return false;
      onDismiss();
      return true;
    });
    return () => {
      subscription.remove();
      onDismiss();
    };
  }, [onDismiss]));

  const chooseSession = useCallback((conversationId: string) => {
    onDismiss();
    onSessionSelect(conversationId);
  }, [onDismiss, onSessionSelect]);

  const startNewChat = useCallback(() => {
    onDismiss();
    onNewChat();
  }, [onDismiss, onNewChat]);

  const openDrawerRoute = useCallback((href: string) => {
    onDismiss();
    requestAnimationFrame(() => router.push(href as never));
  }, [onDismiss, router]);

  const loadMore = useCallback(() => {
    if (!sessionsQuery.hasNextPage || sessionsQuery.isFetchingNextPage) return;
    void sessionsQuery.fetchNextPage();
  }, [sessionsQuery.fetchNextPage, sessionsQuery.hasNextPage, sessionsQuery.isFetchingNextPage]);
  const { onEndReached, onMomentumScrollBegin } = useFlatListEndReached(loadMore);

  const renderSession = useCallback(({ item }: { item: SessionListRow }) => {
    if (item.type === 'section') {
      return (
        <Text style={[styles.timelineLabel, { color: colors.text.tertiary }]}>
          {item.title}
        </Text>
      );
    }
    const session = item.session;
    const current = session.key === currentConversationId;
    return (
      <Pressable
        style={({ pressed }) => [
          styles.sessionRow,
          current && { backgroundColor: colors.surface.active },
          pressed && { backgroundColor: colors.surface.pressed },
        ]}
        onPress={() => chooseSession(session.key)}
        accessibilityRole="button"
        accessibilityState={{ selected: current }}
      >
        <View style={styles.sessionCopy}>
          <Text style={[styles.sessionTitle, { color: colors.text.primary }]} numberOfLines={1}>
            {sessionDisplayName(session, m.sessions.untitled)}
          </Text>
        </View>
        {current ? <View style={[styles.currentDot, { backgroundColor: colors.accent.primary }]} /> : null}
      </Pressable>
    );
  }, [chooseSession, colors, currentConversationId, m.sessions.untitled]);

  const renderFooter = useCallback(() => sessionsQuery.isFetchingNextPage
    ? <View style={styles.listLoader}><ActivityIndicator size="small" /></View>
    : null, [sessionsQuery.isFetchingNextPage]);

  const renderEmpty = useCallback(() => {
    if (sessionsQuery.isLoading) {
      return <View style={styles.empty}><ActivityIndicator size="small" /></View>;
    }
    if (sessionsQuery.isError) {
      return (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.text.secondary }]}>{m.sessions.loadFailed}</Text>
          <Pressable accessibilityRole="button" onPress={() => { void sessionsQuery.refetch(); }}>
            <Text style={[styles.retryText, { color: colors.accent.primary }]}>{m.common.retry}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.empty}>
        <Icon source="message-outline" size={28} color={colors.text.tertiary} />
        <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>
          {copy.noSessions}
        </Text>
      </View>
    );
  }, [colors.accent.primary, colors.text.secondary, colors.text.tertiary,
    copy.noSessions, m.common.retry, m.sessions.loadFailed,
    sessionsQuery.isError, sessionsQuery.isLoading, sessionsQuery.refetch]);

  return (
    <ReanimatedDrawerLayout
      ref={drawerRef}
      drawerPosition={DrawerPosition.LEFT}
      drawerType={DrawerType.FRONT}
      drawerWidth={drawerWidth}
      drawerBackgroundColor={colors.surface.panel}
      overlayColor={colors.overlay.scrim}
      edgeWidth={spacing.xxl}
      minSwipeDistance={spacing.md}
      drawerLockMode={swipeEnabled ? DrawerLockMode.UNLOCKED : DrawerLockMode.LOCKED_CLOSED}
      keyboardDismissMode={DrawerKeyboardDismissMode.ON_DRAG}
      onDrawerStateChanged={(state, willShow) => {
        if (state === DrawerState.DRAGGING && willShow) prepareToOpen();
        if (willShow) drawerActive.current = true;
      }}
      onDrawerOpen={() => {
        drawerActive.current = true;
        setDrawerVisible(true);
      }}
      onDrawerClose={() => {
        drawerActive.current = false;
        setDrawerVisible(false);
      }}
      renderNavigationView={() => (
        <View
          testID="chat-navigation-drawer"
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              paddingTop: insets.top + spacing.sm,
              paddingBottom: insets.bottom + spacing.sm,
              backgroundColor: colors.surface.panel,
              borderRightColor: colors.border.subtle,
            },
          ]}
          onAccessibilityEscape={onDismiss}
        >
          <View style={styles.topBar}>
            <Pressable
              style={styles.topAction}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={m.common.close}
            >
              <Icon source="menu-open" size={24} color={colors.text.primary} />
            </Pressable>
            <View style={styles.topActionsRight}>
              <Pressable
                style={styles.topAction}
                onPress={() => openDrawerRoute('/sessions?search=1')}
                accessibilityRole="button"
                accessibilityLabel={copy.searchSessions}
              >
                <Icon source="magnify" size={25} color={colors.text.primary} />
              </Pressable>
            </View>
          </View>

          <View style={styles.sessionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{copy.historyTitle}</Text>
            <Text style={[styles.sessionCount, { color: colors.text.tertiary }]}>
              {sessionsQuery.data?.pages[0]?.total ?? 0}
            </Text>
          </View>

          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={sessionRows}
            renderItem={renderSession}
            keyExtractor={item => item.key}
            ListEmptyComponent={renderEmpty}
            ListFooterComponent={renderFooter}
            onEndReached={onEndReached}
            onMomentumScrollBegin={onMomentumScrollBegin}
            onEndReachedThreshold={0.35}
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            updateCellsBatchingPeriod={32}
            windowSize={7}
            removeClippedSubviews={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />

          <View style={[styles.footer, { borderTopColor: colors.border.subtle }]}>
            <Pressable
              style={({ pressed }) => [
                styles.newChat,
                elevation.raised,
                {
                  backgroundColor: pressed ? colors.surface.pressed : colors.surface.elevated,
                  borderColor: colors.border.default,
                },
              ]}
              onPress={startNewChat}
              accessibilityRole="button"
            >
              <Icon source="square-edit-outline" size={18} color={colors.accent.primary} />
              <Text style={[styles.newChatText, { color: colors.text.primary }]}>{copy.newChat}</Text>
            </Pressable>
          </View>
        </View>
      )}
    >
      {children}
    </ReanimatedDrawerLayout>
  );
});

const styles = StyleSheet.create({
  drawer: { height: '100%', borderRightWidth: StyleSheet.hairlineWidth },
  topBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md },
  topActionsRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  topAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.full },
  sessionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.content, marginTop: spacing.sm, marginBottom: spacing.xs },
  sectionTitle: { ...typography.heading, flex: 1 },
  sessionCount: { ...typography.caption },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  timelineLabel: { ...typography.caption, marginTop: spacing.md, marginBottom: spacing.xs, paddingHorizontal: spacing.sm },
  sessionRow: { minHeight: 50, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, marginVertical: spacing.xxs },
  sessionCopy: { flex: 1, minWidth: 0 },
  sessionTitle: { ...typography.ui, fontWeight: '500' },
  currentDot: { width: 6, height: 6, borderRadius: 3 },
  empty: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  emptyText: { ...typography.body, textAlign: 'center' },
  retryText: { ...typography.ui, fontWeight: '600' },
  listLoader: { paddingVertical: spacing.lg, alignItems: 'center' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, paddingHorizontal: spacing.lg, alignItems: 'center' },
  newChat: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, alignSelf: 'center' },
  newChatText: { ...typography.ui, fontWeight: '600' },
});

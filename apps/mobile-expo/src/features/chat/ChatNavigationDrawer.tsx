import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import {
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import ReanimatedDrawerLayout, {
  DrawerKeyboardDismissMode, DrawerLockMode, DrawerPosition, DrawerState, DrawerType,
  type DrawerLayoutMethods,
} from 'react-native-gesture-handler/ReanimatedDrawerLayout';
import { ActivityIndicator, Icon, Menu, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../../i18n/messages';
import { sessionDisplayName } from '../../lib/session-helpers';
import { useFlatListEndReached } from '../../lib/use-flat-list-end-reached';
import { queryKeys } from '../../query/keys';
import { fetchProjects } from '../../query/projects';
import { fetchSessionsList, type SessionListItem, type SessionsPage } from '../../query/sessions';
import { fetchUserProfileSummary } from '../../query/user-profile';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, typography, useTheme } from '../../theme';

const PAGE_SIZE = 20;
const UNASSIGNED_PROJECT = '__unassigned';

function profileInitials(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('').toUpperCase();
}

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
  const { width: windowWidth } = useWindowDimensions();
  const { colors, elevation } = useTheme();
  const m = useMessages();
  const copy = m.drawer;
  const activeGatewayId = useGatewayStore(state => state.activeGatewayId);
  const drawerWidth = Math.min(windowWidth * 0.88, 360);
  const drawerRef = useRef<DrawerLayoutMethods>(null);
  const drawerActive = useRef(false);
  const searchInputRef = useRef<TextInput>(null);
  const searchDraftRef = useRef('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  useEffect(() => () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
  }, []);

  const profileQuery = useQuery({
    queryKey: queryKeys.userProfile(activeGatewayId ?? ''),
    queryFn: fetchUserProfileSummary,
    enabled: drawerVisible && Boolean(activeGatewayId),
    staleTime: 5 * 60_000,
  });
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: fetchProjects,
    enabled: drawerVisible && Boolean(activeGatewayId),
    staleTime: 60_000,
  });
  const sessionsQuery = useInfiniteQuery({
    queryKey: queryKeys.drawerSessions(activeGatewayId ?? '', search, projectFilter),
    queryFn: ({ pageParam, signal }) => fetchSessionsList({
      limit: PAGE_SIZE,
      offset: pageParam,
      search,
      channel: 'webchat',
      projectId: projectFilter && projectFilter !== UNASSIGNED_PROJECT ? projectFilter : undefined,
      unassigned: projectFilter === UNASSIGNED_PROJECT,
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
  const projectNames = useMemo(
    () => new Map((projectsQuery.data ?? []).map(project => [project.id, project.name])),
    [projectsQuery.data],
  );
  const selectedProjectName = projectFilter === UNASSIGNED_PROJECT
    ? copy.noProject
    : projectNames.get(projectFilter) ?? copy.allProjects;
  const profileName = profileQuery.data?.callName
    || profileQuery.data?.suggestedCallName
    || copy.you;

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

  const updateSearch = useCallback((value: string) => {
    searchDraftRef.current = value;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearch(searchDraftRef.current.trim());
      searchTimerRef.current = null;
    }, 250);
  }, []);

  const submitSearch = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    setSearch(searchDraftRef.current.trim());
  }, []);

  const clearSearch = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    searchDraftRef.current = '';
    searchInputRef.current?.clear();
    setSearch('');
  }, []);

  const loadMore = useCallback(() => {
    if (!sessionsQuery.hasNextPage || sessionsQuery.isFetchingNextPage) return;
    void sessionsQuery.fetchNextPage();
  }, [sessionsQuery.fetchNextPage, sessionsQuery.hasNextPage, sessionsQuery.isFetchingNextPage]);
  const { onEndReached, onMomentumScrollBegin } = useFlatListEndReached(loadMore);

  const renderSession = useCallback(({ item }: { item: SessionListItem }) => {
    const current = item.key === currentConversationId;
    const projectName = item.projectId ? projectNames.get(item.projectId) : undefined;
    return (
      <Pressable
        style={({ pressed }) => [
          styles.sessionRow,
          current && { backgroundColor: colors.surface.active },
          pressed && { backgroundColor: colors.surface.pressed },
        ]}
        onPress={() => chooseSession(item.key)}
        accessibilityRole="button"
        accessibilityState={{ selected: current }}
      >
        <Icon source="message-outline" size={18} color={current ? colors.accent.primary : colors.text.tertiary} />
        <View style={styles.sessionCopy}>
          <Text style={[styles.sessionTitle, { color: colors.text.primary }]} numberOfLines={1}>
            {sessionDisplayName(item, m.sessions.untitled)}
          </Text>
          {projectName ? (
            <Text style={[styles.sessionMeta, { color: colors.text.tertiary }]} numberOfLines={1}>
              {projectName}
            </Text>
          ) : null}
        </View>
        {current ? <View style={[styles.currentDot, { backgroundColor: colors.accent.primary }]} /> : null}
      </Pressable>
    );
  }, [chooseSession, colors, currentConversationId, m.sessions.untitled, projectNames]);

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
        <Icon source={search || projectFilter ? 'message-search-outline' : 'message-outline'} size={28} color={colors.text.tertiary} />
        <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>
          {search || projectFilter ? copy.noSessionsFound : copy.noSessions}
        </Text>
      </View>
    );
  }, [colors.accent.primary, colors.text.secondary, colors.text.tertiary,
    copy.noSessions, copy.noSessionsFound, m.common.retry, m.sessions.loadFailed,
    projectFilter, search, sessionsQuery.isError, sessionsQuery.isLoading, sessionsQuery.refetch]);

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
        if (state === DrawerState.DRAGGING) prepareToOpen();
        if (willShow) drawerActive.current = true;
      }}
      onDrawerOpen={() => {
        drawerActive.current = true;
        setDrawerVisible(true);
      }}
      onDrawerClose={() => {
        drawerActive.current = false;
        setDrawerVisible(false);
        setProjectMenuOpen(false);
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
            <Text style={[styles.eyebrow, { color: colors.text.tertiary }]}>{copy.aboutYou}</Text>
            <Pressable
              style={styles.close}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={m.common.close}
            >
              <Icon source="close" size={21} color={colors.text.secondary} />
            </Pressable>
          </View>

          <View style={[styles.profileCard, { backgroundColor: colors.surface.grouped, borderColor: colors.border.subtle }]}>
            <View style={[styles.avatar, { backgroundColor: colors.accent.soft }]}>
              <Text style={[styles.avatarText, { color: colors.accent.primary }]}>{profileInitials(profileName)}</Text>
            </View>
            <View style={styles.profileCopy}>
              <Text style={[styles.profileName, { color: colors.text.primary }]} numberOfLines={1}>{profileName}</Text>
              <Text style={[styles.profileRole, { color: colors.text.secondary }]} numberOfLines={1}>
                {profileQuery.data?.role || copy.profileHint}
              </Text>
            </View>
          </View>

          <View style={styles.sessionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{copy.historyTitle}</Text>
            <Text style={[styles.sessionCount, { color: colors.text.tertiary }]}>
              {sessionsQuery.data?.pages[0]?.total ?? 0}
            </Text>
          </View>

          <View style={[styles.searchBox, { backgroundColor: colors.surface.input }]}>
            <Icon source="magnify" size={18} color={colors.text.tertiary} />
            <TextInput
              ref={searchInputRef}
              defaultValue=""
              onChangeText={updateSearch}
              onSubmitEditing={submitSearch}
              placeholder={copy.searchSessions}
              placeholderTextColor={colors.text.tertiary}
              style={[styles.searchInput, { color: colors.text.primary }]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {search ? (
              <Pressable onPress={clearSearch} accessibilityRole="button" accessibilityLabel={m.common.close} hitSlop={6}>
                <Icon source="close-circle" size={18} color={colors.text.tertiary} />
              </Pressable>
            ) : null}
          </View>

          <Menu
            visible={projectMenuOpen}
            onDismiss={() => setProjectMenuOpen(false)}
            contentStyle={[styles.projectMenu, { backgroundColor: colors.surface.elevated }]}
            anchor={(
              <Pressable
                style={[styles.projectFilter, { borderColor: colors.border.default }]}
                onPress={() => setProjectMenuOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`${copy.filterByProject}: ${selectedProjectName}`}
              >
                <Icon source="folder-outline" size={16} color={projectFilter ? colors.accent.primary : colors.text.secondary} />
                <Text style={[styles.projectFilterText, { color: projectFilter ? colors.accent.primary : colors.text.secondary }]} numberOfLines={1}>
                  {selectedProjectName}
                </Text>
                <Icon source="chevron-down" size={16} color={colors.text.tertiary} />
              </Pressable>
            )}
          >
            <Menu.Item
              title={copy.allProjects}
              leadingIcon={!projectFilter ? 'check' : 'folder-multiple-outline'}
              onPress={() => { setProjectFilter(''); setProjectMenuOpen(false); }}
            />
            <Menu.Item
              title={copy.noProject}
              leadingIcon={projectFilter === UNASSIGNED_PROJECT ? 'check' : 'folder-off-outline'}
              onPress={() => { setProjectFilter(UNASSIGNED_PROJECT); setProjectMenuOpen(false); }}
            />
            {(projectsQuery.data ?? []).filter(project => project.status !== 'archived').map(project => (
              <Menu.Item
                key={project.id}
                title={project.name}
                leadingIcon={projectFilter === project.id ? 'check' : 'folder-outline'}
                onPress={() => { setProjectFilter(project.id); setProjectMenuOpen(false); }}
              />
            ))}
          </Menu>

          <FlashList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={sessions}
            renderItem={renderSession}
            keyExtractor={item => item.key}
            ListEmptyComponent={renderEmpty}
            ListFooterComponent={renderFooter}
            onEndReached={onEndReached}
            onMomentumScrollBegin={onMomentumScrollBegin}
            onEndReachedThreshold={0.35}
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
  topBar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.content, paddingRight: spacing.sm },
  eyebrow: { ...typography.label, flex: 1, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  profileCard: { marginHorizontal: spacing.lg, padding: spacing.md, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...typography.ui, fontWeight: '700' },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { ...typography.body, fontWeight: '600' },
  profileRole: { ...typography.caption, marginTop: spacing.xxs },
  sessionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.content, marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionTitle: { ...typography.heading, flex: 1 },
  sessionCount: { ...typography.caption },
  searchBox: { minHeight: 42, marginHorizontal: spacing.lg, borderRadius: radii.md, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  searchInput: { ...typography.ui, flex: 1, minWidth: 0, paddingVertical: spacing.sm },
  projectFilter: { minHeight: 38, maxWidth: 220, marginTop: spacing.sm, marginBottom: spacing.xs, marginHorizontal: spacing.lg, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start' },
  projectFilterText: { ...typography.caption, flexShrink: 1, fontWeight: '600' },
  projectMenu: { maxHeight: 360, borderRadius: radii.lg },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.sm, paddingBottom: spacing.md },
  sessionRow: { minHeight: 54, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, marginVertical: spacing.xxs },
  sessionCopy: { flex: 1, minWidth: 0 },
  sessionTitle: { ...typography.ui, fontWeight: '500' },
  sessionMeta: { ...typography.caption, marginTop: spacing.xxs },
  currentDot: { width: 6, height: 6, borderRadius: 3 },
  empty: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  emptyText: { ...typography.body, textAlign: 'center' },
  retryText: { ...typography.ui, fontWeight: '600' },
  listLoader: { paddingVertical: spacing.lg, alignItems: 'center' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, paddingHorizontal: spacing.lg, alignItems: 'center' },
  newChat: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, alignSelf: 'center' },
  newChatText: { ...typography.ui, fontWeight: '600' },
});

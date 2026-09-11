import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast } from '../../components/AppToast';
import { BatchActionBar } from '../../components/BatchActionBar';
import { BatchDeleteConfirmDialog } from '../../components/BatchDeleteConfirmDialog';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { ListSkeleton } from '../../components/ListSkeleton';
import { LIST_DELETE_UNDO_MS } from '../../constants/list-interaction';
import { TOAST_BOTTOM_LIFT_ABOVE_BAR, TOAST_DURATION_SHORT } from '../../constants/toast';
import { useDelayedDelete } from '../../hooks/use-delayed-delete';
import { useListSelection } from '../../hooks/use-list-selection';
import { useMessages, t } from '../../i18n/messages';
import { sessionDisplayName } from '../../lib/session-helpers';
import { useFlatListEndReached } from '../../lib/use-flat-list-end-reached';
import { dismissOrRoot, openChat, useDismissOnHardwareBack } from '../../lib/navigation';
import { refreshSessionsList } from '../../query/infinite-list-sync';
import { queryKeys } from '../../query/keys';
import {
  archiveSession,
  createSession,
  deleteSession,
  fetchSessionsList,
  pinSession,
  renameSession,
  type SessionListItem,
  type SessionsPage,
  unarchiveSession,
  useGatewayConfigured,
} from '../../query/sessions';
import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding, radii, spacing, typography, useTheme } from '../../theme';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { prefetchSessionChatEntry } from '../chat/session-history-prefetch';

import { RenameDialog } from './RenameDialog';
import { SessionCard } from './SessionCard';
import { buildSessionListRows, type SessionListRow } from './session-time-groups';
import type { SwipeAction } from '../../components/SwipeableRow';

const PAGE_SIZE = 20;
const sessionRowKey = (item: SessionListRow) => item.key;
const sessionRowType = (item: SessionListRow) => item.type;

export function SessionsScreen() {
  const router = useRouter();
  useDismissOnHardwareBack(router);
  const queryClient = useQueryClient();
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const language = usePreferencesStore((state) => state.language);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const m = useMessages();
  const sm = m.sessionsPage;
  const sa = m.sessionActions;
  const li = m.listInteraction;
  const configured = useGatewayConfigured();
  const [snackMsg, setSnackMsg] = useState('');
  const [renameTarget, setRenameTarget] = useState<SessionListItem | null>(null);
  const [showBatchDelete, setShowBatchDelete] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [committedSearch, setCommittedSearch] = useState('');
  const listRef = useRef<FlashListRef<SessionListRow>>(null);
  const searchInputRef = useRef<TextInput>(null);
  const searchDraftRef = useRef('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyPrefetchesRef = useRef(new Map<string, Promise<void>>());
  const openingSessionKeyRef = useRef('');
  const openingResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (openingResetTimerRef.current) clearTimeout(openingResetTimerRef.current);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
  }, []);
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [committedSearch]);
  const {
    selectionMode,
    selectedIds,
    selectedCount,
    exitSelectionMode,
    startSelection,
    toggleSelected,
  } = useListSelection<string>();
  const {
    hiddenIds: pendingDeleteIds,
    undoId: pendingUndoId,
    scheduleDelete,
    undoDelete,
  } = useDelayedDelete<string>();

  const sessionsListQueryKey = useMemo(
    () => committedSearch ? queryKeys.sessions(committedSearch) : queryKeys.sessionsAll,
    [committedSearch],
  );
  const sessionsQuery = useInfiniteQuery({
    queryKey: sessionsListQueryKey,
    queryFn: ({ pageParam, signal }) => fetchSessionsList({
      limit: PAGE_SIZE,
      offset: pageParam,
      channel: null,
      search: committedSearch,
      signal,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage: SessionsPage) => lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined,
    enabled: configured,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const allSessions = useMemo(() => {
    const seen = new Set<string>();
    const sessions: SessionListItem[] = [];
    for (const page of sessionsQuery.data?.pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.key) || pendingDeleteIds.has(item.key)) continue;
        seen.add(item.key);
        sessions.push(item);
      }
    }
    return sessions;
  }, [pendingDeleteIds, sessionsQuery.data?.pages]);
  const sessionByKey = useMemo(
    () => new Map(allSessions.map((session) => [session.key, session])),
    [allSessions],
  );
  const listRows = useMemo(
    () => buildSessionListRows(
      allSessions,
      sm.groups,
      language === 'zh' ? 'zh-CN' : 'en-US',
    ),
    [allSessions, language, sm.groups],
  );

  const createSessionMutation = useMutation({
    mutationFn: () => createSession(),
    onSuccess: (sessionKey) => {
      router.push(`/chat/${sessionKey}`);
    },
    onError: (error) => {
      setSnackMsg(error instanceof Error ? error.message : m.notesPage.actionFailed);
    },
  });

  const refreshList = useCallback(async () => {
    await refreshSessionsList(queryClient);
  }, [queryClient]);

  const runBatchArchive = useCallback(async () => {
    const keys = [...selectedIds];
    const targets = keys
      .map((key) => sessionByKey.get(key))
      .filter((session): session is SessionListItem => Boolean(session));
    const allArchived = targets.length > 0 && targets.every((session) => session.status === 'archived');
    try {
      await Promise.all(targets.map(async (session) => {
        if (session.status === 'archived') {
          await unarchiveSession(session.key);
          return;
        }
        await archiveSession(session.key);
      }));
      await refreshList();
      setSnackMsg(allArchived ? sa.sessionUnarchived : sa.sessionArchived);
      exitSelectionMode();
    } catch (error) {
      setSnackMsg(
        error instanceof Error
          ? error.message
          : allArchived ? sa.failedToUnarchive : sa.failedToArchive,
      );
    }
  }, [exitSelectionMode, refreshList, sa, selectedIds, sessionByKey]);

  const runBatchPin = useCallback(async () => {
    const keys = [...selectedIds];
    await Promise.all(keys.map(async (key) => {
      const session = sessionByKey.get(key);
      if (!session || session.status === 'pinned') return;
      await pinSession(key);
    }));
    await refreshList();
    setSnackMsg(sa.sessionPinned);
    exitSelectionMode();
  }, [exitSelectionMode, refreshList, sa.sessionPinned, selectedIds, sessionByKey]);

  const renameMutation = useMutation({
    mutationFn: ({ key, name }: { key: string; name: string }) => renameSession(key, name),
    onSuccess: async () => {
      setRenameTarget(null);
      await refreshList();
      setSnackMsg(sa.sessionRenamed);
      exitSelectionMode();
    },
    onError: (error) => setSnackMsg(error instanceof Error ? error.message : sa.failedToRename),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (keys: string[]) => {
      await Promise.all(keys.map((key) => deleteSession(key)));
    },
    onSuccess: async (_data, keys) => {
      await refreshList();
      setSnackMsg(keys.length > 1 ? t(li.batchDeleted, { count: keys.length }) : sa.sessionDeleted);
      exitSelectionMode();
      setShowBatchDelete(false);
    },
    onError: (error) => setSnackMsg(error instanceof Error ? error.message : sa.failedToDelete),
  });

  const primeSessionHistory = useCallback((sessionKey: string): Promise<void> => {
    const existing = historyPrefetchesRef.current.get(sessionKey);
    if (existing) return existing;
    const pending = prefetchSessionChatEntry(queryClient, sessionKey, activeGatewayId)
      .finally(() => historyPrefetchesRef.current.delete(sessionKey));
    historyPrefetchesRef.current.set(sessionKey, pending);
    return pending;
  }, [activeGatewayId, queryClient]);

  const handleOpenSession = useCallback((session: SessionListItem) => {
    if (openingSessionKeyRef.current) return;
    openingSessionKeyRef.current = session.key;
    void primeSessionHistory(session.key).catch(() => undefined);
    openChat(router, session.key);
    if (openingResetTimerRef.current) clearTimeout(openingResetTimerRef.current);
    openingResetTimerRef.current = setTimeout(() => {
      openingSessionKeyRef.current = '';
      openingResetTimerRef.current = null;
    }, 600);
  }, [primeSessionHistory, router]);

  const handleSessionPress = useCallback((session: SessionListItem) => {
    if (selectionMode) {
      toggleSelected(session.key);
      return;
    }
    handleOpenSession(session);
  }, [handleOpenSession, selectionMode, toggleSelected]);

  const handleSessionLongPress = useCallback((session: SessionListItem) => {
    if (selectionMode) return;
    startSelection();
    toggleSelected(session.key);
  }, [selectionMode, startSelection, toggleSelected]);

  const handleSwipeAction = useCallback(async (session: SessionListItem, action: SwipeAction) => {
    try {
      if (action.key === 'archive') {
        if (session.status === 'archived') {
          await unarchiveSession(session.key);
          await refreshList();
          setSnackMsg(sa.sessionUnarchived);
        } else {
          await archiveSession(session.key);
          await refreshList();
          setSnackMsg(sa.sessionArchived);
        }
      } else if (action.key === 'delete') {
        scheduleDelete(
          session.key,
          async () => {
            await deleteSession(session.key);
            await refreshList();
          },
          (error) => setSnackMsg(error instanceof Error ? error.message : sa.failedToDelete),
        );
        setSnackMsg(sa.sessionDeleted);
      }
    } catch (error) {
      if (action.key === 'delete') {
        setSnackMsg(error instanceof Error ? error.message : sa.failedToDelete);
      } else if (session.status === 'archived') {
        setSnackMsg(error instanceof Error ? error.message : sa.failedToUnarchive);
      } else {
        setSnackMsg(error instanceof Error ? error.message : sa.failedToArchive);
      }
    }
  }, [refreshList, sa, scheduleDelete]);

  const handleBatchRename = useCallback(() => {
    if (selectedCount !== 1) return;
    const key = [...selectedIds][0];
    const session = sessionByKey.get(key);
    if (session) setRenameTarget(session);
  }, [selectedCount, selectedIds, sessionByKey]);

  const batchActions = useMemo(() => [
    {
      key: 'archive',
      icon: 'archive-arrow-down-outline',
      label: sa.archive,
      onPress: () => void runBatchArchive(),
      disabled: selectedCount === 0 || batchDeleteMutation.isPending,
    },
    {
      key: 'pin',
      icon: 'pin-outline',
      label: sa.pin,
      onPress: () => void runBatchPin(),
      disabled: selectedCount === 0 || batchDeleteMutation.isPending,
    },
    {
      key: 'rename',
      icon: 'pencil-outline',
      label: li.rename,
      onPress: handleBatchRename,
      disabled: selectedCount !== 1 || batchDeleteMutation.isPending,
    },
    {
      key: 'delete',
      icon: 'trash-can-outline',
      label: sa.delete,
      destructive: true,
      onPress: () => setShowBatchDelete(true),
      disabled: selectedCount === 0 || batchDeleteMutation.isPending,
      loading: batchDeleteMutation.isPending,
    },
  ], [
    batchDeleteMutation.isPending,
    handleBatchRename,
    li.rename,
    runBatchArchive,
    runBatchPin,
    sa.archive,
    sa.delete,
    sa.pin,
    selectedCount,
  ]);

  const handleLoadMore = useCallback(() => {
    if (!sessionsQuery.hasNextPage || sessionsQuery.isFetchingNextPage) return;
    void sessionsQuery.fetchNextPage();
  }, [sessionsQuery.fetchNextPage, sessionsQuery.hasNextPage, sessionsQuery.isFetchingNextPage]);

  const { onEndReached, onMomentumScrollBegin } = useFlatListEndReached(handleLoadMore);

  const listExtraData = useMemo(
    () => ({
      selectionMode,
      selectedIds,
    }),
    [selectedIds, selectionMode],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshList();
    } finally {
      setRefreshing(false);
    }
  }, [refreshList]);

  const handleSessionPressIn = useCallback((session: SessionListItem) => {
    void primeSessionHistory(session.key).catch(() => undefined);
  }, [primeSessionHistory]);

  const renderListRow = useCallback(({ item }: { item: SessionListRow }) => {
    if (item.type === 'section') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text.secondary }]}>{item.title}</Text>
        </View>
      );
    }
    return (
      <SessionCard
        session={item.session}
        onPress={handleSessionPress}
        onPressIn={selectionMode ? undefined : handleSessionPressIn}
        onLongPress={handleSessionLongPress}
        onSwipeAction={handleSwipeAction}
        selectionMode={selectionMode}
        selected={selectedIds.has(item.session.key)}
        isFirst={item.isFirst}
        isLast={item.isLast}
      />
    );
  }, [colors.text.secondary, handleSessionLongPress, handleSessionPress, handleSessionPressIn, handleSwipeAction, selectedIds, selectionMode]);

  const handleSearchChange = useCallback((value: string) => {
    searchDraftRef.current = value;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setCommittedSearch(searchDraftRef.current.trim());
      searchTimerRef.current = null;
    }, 250);
  }, []);

  const submitSearch = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    setCommittedSearch(searchDraftRef.current.trim());
  }, []);

  const closeSearch = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    searchDraftRef.current = '';
    searchInputRef.current?.clear();
    setCommittedSearch('');
    setSearchOpen(false);
  }, []);

  const openSearch = useCallback(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
      return;
    }
    setSearchOpen(true);
  }, [searchOpen]);

  const renderListFooter = useCallback(() => {
    if (sessionsQuery.isFetchingNextPage) {
      return <View style={styles.footerLoader}><ActivityIndicator size="small" /></View>;
    }
    return null;
  }, [sessionsQuery.isFetchingNextPage]);

  const listBottomPadding = selectionMode
    ? insets.bottom + 120
    : floatingBottomPadding(insets.bottom) + FLOATING_BOTTOM_OFFSET + 88;

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        title={selectionMode ? t(li.selectedCount, { count: selectedCount }) : sm.title}
        largeTitle={!selectionMode}
        onBack={selectionMode ? exitSelectionMode : () => dismissOrRoot(router)}
        onSearchPress={!selectionMode && configured ? openSearch : undefined}
        searchPlaceholder={m.sessions.searchPlaceholder}
        rightActions={selectionMode ? undefined : [
          {
            icon: 'square-edit-outline',
            accessibilityLabel: sm.newChat,
            onPress: () => {
              if (!createSessionMutation.isPending) createSessionMutation.mutate();
            },
          },
        ]}
      />

      {!selectionMode && searchOpen ? (
        <View style={styles.searchWrap}>
          <View style={[styles.searchBox, { backgroundColor: colors.surface.input }]}>
            <Icon source="magnify" size={19} color={colors.text.tertiary} />
            <TextInput
              ref={searchInputRef}
              defaultValue=""
              onChangeText={handleSearchChange}
              onSubmitEditing={submitSearch}
              placeholder={m.sessions.searchPlaceholder}
              placeholderTextColor={colors.text.tertiary}
              style={[styles.searchInput, { color: colors.text.primary }]}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {committedSearch && sessionsQuery.isFetching && !sessionsQuery.isFetchingNextPage ? (
              <ActivityIndicator size={16} />
            ) : null}
            <Pressable
              onPress={closeSearch}
              accessibilityRole="button"
              accessibilityLabel={m.common.close}
              hitSlop={4}
              style={styles.searchClose}
            >
              <Icon source="close-circle" size={20} color={colors.text.tertiary} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {!configured ? (
        <View style={styles.center}>
          <Icon source="cloud-off-outline" size={42} color={colors.text.tertiary} />
          <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{m.sessions.gatewayNotConfigured}</Text>
          <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{m.sessions.gatewayNotConfiguredHint}</Text>
        </View>
      ) : sessionsQuery.isLoading ? (
        <ListSkeleton count={8} withIcon={false} />
      ) : (
        <FlashList
          ref={listRef}
          data={listRows}
          keyExtractor={sessionRowKey}
          renderItem={renderListRow}
          getItemType={sessionRowType}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          onMomentumScrollBegin={onMomentumScrollBegin}
          ListFooterComponent={renderListFooter}
          extraData={listExtraData}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { void handleRefresh(); }}
            />
          }
          contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>
                {committedSearch ? m.sessions.noResults : sm.empty}
              </Text>
              <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>
                {committedSearch ? t(m.sessions.noResultsHint, { query: committedSearch }) : sm.emptyHint}
              </Text>
              {!committedSearch ? (
                <Button
                  mode="contained"
                  style={styles.emptyAction}
                  loading={createSessionMutation.isPending}
                  onPress={() => createSessionMutation.mutate()}
                >
                  {sm.newChat}
                </Button>
              ) : null}
            </View>
          }
        />
      )}

      {selectionMode ? <BatchActionBar items={batchActions} /> : null}

      <RenameDialog
        visible={Boolean(renameTarget)}
        currentName={renameTarget ? sessionDisplayName(renameTarget, m.sessions.untitled) : ''}
        loading={renameMutation.isPending}
        onDismiss={() => setRenameTarget(null)}
        onRename={(name) => {
          if (!renameTarget) return;
          renameMutation.mutate({ key: renameTarget.key, name });
        }}
      />

      <BatchDeleteConfirmDialog
        visible={showBatchDelete}
        count={selectedCount}
        onDismiss={() => setShowBatchDelete(false)}
        onConfirm={() => batchDeleteMutation.mutate([...selectedIds])}
        loading={batchDeleteMutation.isPending}
      />

      <AppToast
        visible={Boolean(snackMsg)}
        onDismiss={() => setSnackMsg('')}
        duration={pendingUndoId && snackMsg === sa.sessionDeleted ? LIST_DELETE_UNDO_MS : TOAST_DURATION_SHORT}
        action={pendingUndoId && snackMsg === sa.sessionDeleted ? { label: li.undo, onPress: () => undoDelete() } : undefined}
        bottomLift={!selectionMode ? TOAST_BOTTOM_LIFT_ABOVE_BAR : undefined}
      >
        {snackMsg}
      </AppToast>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  searchBox: {
    minHeight: 44,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
  },
  searchInput: { flex: 1, minHeight: 44, fontSize: 16, paddingVertical: 0 },
  searchClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: spacing.lg, flexGrow: 1 },
  sectionHeader: {
    minHeight: 40,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.content + spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionTitle: { ...typography.label, fontWeight: '700' },
  footerLoader: { paddingVertical: 16, alignItems: 'center' },
  emptyTitle: { ...typography.heading },
  emptyText: { ...typography.label, textAlign: 'center', maxWidth: 260 },
  emptyAction: { marginTop: spacing.sm },
});

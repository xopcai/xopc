import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast } from '../../components/AppToast';
import { BatchActionBar } from '../../components/BatchActionBar';
import { BatchDeleteConfirmDialog } from '../../components/BatchDeleteConfirmDialog';
import { FloatingHeader } from '../../components/FloatingHeader';
import { ListSkeleton } from '../../components/ListSkeleton';
import { LIST_DELETE_UNDO_MS } from '../../constants/list-interaction';
import { TOAST_BOTTOM_LIFT_ABOVE_BAR, TOAST_DURATION_SHORT } from '../../constants/toast';
import { useDelayedDelete } from '../../hooks/use-delayed-delete';
import { useListSelection } from '../../hooks/use-list-selection';
import { useMessages, t } from '../../i18n/messages';
import { sessionDisplayName } from '../../lib/session-helpers';
import { useFlatListEndReached } from '../../lib/use-flat-list-end-reached';
import { dismissOrHome, openNoteDetail, useDismissOnHardwareBack } from '../../lib/navigation';
import { refreshSessionsList } from '../../query/infinite-list-sync';
import { queryKeys } from '../../query/keys';
import {
  archiveSession,
  deleteSession,
  fetchSessionsList,
  pinSession,
  renameSession,
  type SessionListItem,
  type SessionsPage,
  unarchiveSession,
  useGatewayConfigured,
} from '../../query/sessions';
import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding, spacing, useTheme } from '../../theme';
import { createLocalDraftNote } from '../notes/notes-local';

import { RenameDialog } from './RenameDialog';
import { SessionCard } from './SessionCard';
import type { SwipeAction } from '../../components/SwipeableRow';

const PAGE_SIZE = 20;
export function SessionsScreen() {
  const router = useRouter();
  useDismissOnHardwareBack(router);
  const queryClient = useQueryClient();
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

  const sessionsQuery = useInfiniteQuery({
    queryKey: queryKeys.sessionsAll,
    queryFn: ({ pageParam }) => fetchSessionsList({ limit: PAGE_SIZE, offset: pageParam, channel: null }),
    initialPageParam: 0,
    getNextPageParam: (lastPage: SessionsPage) => lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined,
    enabled: configured,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const allSessions = useMemo(
    () => (sessionsQuery.data?.pages.flatMap((page) => page.items) ?? [])
      .filter((item) => !pendingDeleteIds.has(item.key)),
    [pendingDeleteIds, sessionsQuery.data?.pages],
  );

  const refreshList = useCallback(async () => {
    await refreshSessionsList(queryClient);
  }, [queryClient]);

  const handleCreateNote = useCallback(() => {
    const draft = createLocalDraftNote();
    openNoteDetail(router, draft.id);
  }, [router]);

  const runBatchArchive = useCallback(async () => {
    const keys = [...selectedIds];
    const targets = keys
      .map((key) => allSessions.find((item) => item.key === key))
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
  }, [allSessions, exitSelectionMode, refreshList, sa, selectedIds]);

  const runBatchPin = useCallback(async () => {
    const keys = [...selectedIds];
    await Promise.all(keys.map(async (key) => {
      const session = allSessions.find((item) => item.key === key);
      if (!session || session.status === 'pinned') return;
      await pinSession(key);
    }));
    await refreshList();
    setSnackMsg(sa.sessionPinned);
    exitSelectionMode();
  }, [allSessions, exitSelectionMode, refreshList, sa.sessionPinned, selectedIds]);

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

  const handleOpenSession = useCallback((session: SessionListItem) => {
    router.push(`/chat/${session.key}`);
  }, [router]);

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
    const session = allSessions.find((item) => item.key === key);
    if (session) setRenameTarget(session);
  }, [allSessions, selectedCount, selectedIds]);

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

  const handleRefresh = useCallback(() => {
    void refreshList();
  }, [refreshList]);

  const renderSession = useCallback(({ item }: { item: SessionListItem }) => (
    <SessionCard
      session={item}
      onPress={() => handleSessionPress(item)}
      onLongPress={() => handleSessionLongPress(item)}
      onSwipeAction={(action) => handleSwipeAction(item, action)}
      selectionMode={selectionMode}
      selected={selectedIds.has(item.key)}
    />
  ), [handleSessionPress, handleSessionLongPress, handleSwipeAction, selectedIds, selectionMode]);

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
      <FloatingHeader
        title={selectionMode ? t(li.selectedCount, { count: selectedCount }) : sm.title}
        onBack={selectionMode ? exitSelectionMode : () => dismissOrHome(router)}
      />

      {!configured ? (
        <View style={styles.center}>
          <Icon source="cloud-off-outline" size={42} color={colors.text.tertiary} />
          <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{m.sessions.gatewayNotConfigured}</Text>
          <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{m.sessions.gatewayNotConfiguredHint}</Text>
        </View>
      ) : sessionsQuery.isLoading ? (
        <ListSkeleton count={8} withIcon={false} />
      ) : (
        <FlatList
          data={allSessions}
          keyExtractor={(item) => item.key}
          renderItem={renderSession}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          onMomentumScrollBegin={onMomentumScrollBegin}
          ListFooterComponent={renderListFooter}
          extraData={{ selectionMode, selectedCount, selectedKey: [...selectedIds].join('|') }}
          refreshControl={
            <RefreshControl
              refreshing={sessionsQuery.isFetching && !sessionsQuery.isLoading && !sessionsQuery.isFetchingNextPage}
              onRefresh={handleRefresh}
            />
          }
          contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon source="message-processing-outline" size={42} color={colors.text.tertiary} />
              <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{sm.empty}</Text>
              <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{sm.emptyHint}</Text>
            </View>
          }
        />
      )}

      {selectionMode ? <BatchActionBar items={batchActions} /> : null}
      {!selectionMode ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.newNoteWrap,
            { paddingBottom: floatingBottomPadding(insets.bottom) + FLOATING_BOTTOM_OFFSET },
          ]}
        >
          <Pressable
            style={[
              styles.newNoteButton,
              {
                backgroundColor: colors.surface.panel,
                borderColor: colors.border.default,
              },
            ]}
            onPress={handleCreateNote}
            disabled={false}
            accessibilityRole="button"
            accessibilityLabel={m.homePage.quickNewNote}
            accessibilityState={{ disabled: false }}
          >
            <Icon source="note-plus-outline" size={26} color={colors.text.secondary} />
          </Pressable>
        </View>
      ) : null}

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
  list: { padding: spacing.lg, paddingTop: spacing.md, gap: spacing.sm, flexGrow: 1 },
  footerLoader: { paddingVertical: 16, alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  emptyText: { fontSize: 13, textAlign: 'center' },
  newNoteWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newNoteButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});

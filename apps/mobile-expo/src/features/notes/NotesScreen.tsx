import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast } from '../../components/AppToast';
import { FloatingHeader } from '../../components/FloatingHeader';
import { BatchActionBar } from '../../components/BatchActionBar';
import { BatchDeleteConfirmDialog } from '../../components/BatchDeleteConfirmDialog';
import { ListSkeleton } from '../../components/ListSkeleton';
import type { SwipeAction } from '../../components/SwipeableRow';
import { LIST_DELETE_UNDO_MS } from '../../constants/list-interaction';
import { TOAST_BOTTOM_LIFT_ABOVE_BAR, TOAST_DURATION_DEFAULT } from '../../constants/toast';
import { useDelayedDelete } from '../../hooks/use-delayed-delete';
import { useListSelection } from '../../hooks/use-list-selection';

import { useMessages, t } from '../../i18n/messages';
import { dismissOrHome, noteDetailRoute, useDismissOnHardwareBack } from '../../lib/navigation';
import { useFlatListEndReached } from '../../lib/use-flat-list-end-reached';
import {
  createBlankNote,
  deleteNote,
  fetchNotes,
  updateNote,
  type NoteIndexEntry,
  type NoteKind,
  type NoteStatus,
} from '../../query/notes';
import { queryKeys } from '../../query/keys';
import { refreshNotesList } from '../../query/infinite-list-sync';
import { useGatewayConfigured } from '../../query/sessions';
import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding, spacing, useTheme } from '../../theme';

import { useNoteTagsStore } from '../../stores/note-tags-store';
import { NoteTagPickerSheet } from './NoteTagPickerSheet';
import { collectTagsFromNotes, noteMatchesTagFilter, type NoteTagFilter } from './note-tag-utils';
import { NoteCard } from './NoteCard';

type StatusFilter = 'all' | NoteStatus;
type KindFilter = 'all' | NoteKind;

export type NotesScreenProps = {
  embedded?: boolean;
  onRequestHome?: () => void;
};

export function NotesScreen({ embedded = false, onRequestHome }: NotesScreenProps) {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string }>();
  useDismissOnHardwareBack(router, { enabled: !embedded });
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const configured = useGatewayConfigured();
  const m = useMessages();
  const pm = m.notesPage;
  const li = m.listInteraction;
  const insets = useSafeAreaInsets();
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
  const [showBatchDelete, setShowBatchDelete] = useState(false);
  const [batchTagPicker, setBatchTagPicker] = useState(false);

  const handleBack = useCallback(() => {
    if (onRequestHome) {
      onRequestHome();
      return;
    }
    dismissOrHome(router);
  }, [onRequestHome, router]);

  const initialKind = (params.kind as KindFilter) || 'all';
  const statusFilter: StatusFilter = 'all';
  const kindFilter: KindFilter = initialKind;
  const [tagFilter, setTagFilter] = useState<NoteTagFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [focusTagCreate, setFocusTagCreate] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  const noteTags = useNoteTagsStore((s) => s.tags);
  const addNoteTag = useNoteTagsStore((s) => s.addTag);
  const ensureNoteTags = useNoteTagsStore((s) => s.ensureTags);

  const notesListQueryKey = useMemo(
    () => [...queryKeys.notesAll, statusFilter, kindFilter, searchText.trim()] as const,
    [statusFilter, kindFilter, searchText],
  );

  const notesQuery = useInfiniteQuery({
    queryKey: notesListQueryKey,
    queryFn: ({ pageParam }) =>
      fetchNotes({
        status: statusFilter === 'all' ? undefined : statusFilter,
        kind: kindFilter === 'all' ? undefined : kindFilter,
        search: searchText.trim() || undefined,
        limit: 20,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined,
    enabled: configured,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const refreshList = useCallback(async () => {
    await refreshNotesList(queryClient, notesListQueryKey);
  }, [queryClient, notesListQueryKey]);

  const handleNotePress = useCallback((note: NoteIndexEntry) => {
    if (selectionMode) {
      toggleSelected(note.id);
      return;
    }
    router.push(`/items/${note.id}`);
  }, [router, selectionMode, toggleSelected]);

  const createNoteMutation = useMutation({
    mutationFn: createBlankNote,
    onSuccess: async (result) => {
      await refreshNotesList(queryClient, notesListQueryKey);
      router.push(noteDetailRoute(result.note.id));
    },
    onError: (err) => {
      setSnackMsg(err instanceof Error ? err.message : pm.actionFailed);
    },
  });

  const handleCreateNote = useCallback(() => {
    if (createNoteMutation.isPending) return;
    createNoteMutation.mutate();
  }, [createNoteMutation]);

  const handleNoteLongPress = useCallback((note: NoteIndexEntry) => {
    if (selectionMode) return;
    startSelection();
    toggleSelected(note.id);
  }, [selectionMode, startSelection, toggleSelected]);

  const handleSwipeAction = useCallback((note: NoteIndexEntry, action: SwipeAction) => {
    if (action.key === 'pin' || action.key === 'unpin') {
      void updateNote(note.id, { pinned: action.key === 'pin' })
        .then(refreshList)
        .then(() => setSnackMsg(pm.updated))
        .catch((err) => setSnackMsg(err instanceof Error ? err.message : pm.actionFailed));
      return;
    }

    if (action.key === 'archive') {
      void updateNote(note.id, { status: 'archived' })
        .then(refreshList)
        .then(() => setSnackMsg(pm.updated))
        .catch((err) => setSnackMsg(err instanceof Error ? err.message : pm.actionFailed));
      return;
    }

    if (action.key === 'delete') {
      scheduleDelete(
        note.id,
        async () => {
          await deleteNote(note.id);
          await refreshList();
        },
        (err) => setSnackMsg(err instanceof Error ? err.message : pm.actionFailed),
      );
      setSnackMsg(pm.deleted);
    }
  }, [pm.actionFailed, pm.deleted, pm.updated, refreshList, scheduleDelete]);

  const runBatchMutation = useCallback(
    async (runner: () => Promise<unknown>, successMsg: string) => {
      if (selectedCount === 0) return;
      try {
        await runner();
        await refreshList();
        setSnackMsg(successMsg);
        exitSelectionMode();
      } catch (err) {
        setSnackMsg(err instanceof Error ? err.message : pm.actionFailed);
      }
    },
    [exitSelectionMode, pm.actionFailed, refreshList, selectedCount],
  );

  const handleBatchArchive = useCallback(() => {
    void runBatchMutation(
      () => Promise.all([...selectedIds].map((id) => updateNote(id, { status: 'archived' }))),
      pm.updated,
    );
  }, [pm.updated, runBatchMutation, selectedIds]);

  const handleBatchPin = useCallback(
    (pinned: boolean) => {
      void runBatchMutation(
        () => Promise.all([...selectedIds].map((id) => updateNote(id, { pinned }))),
        pm.updated,
      );
    },
    [pm.updated, runBatchMutation, selectedIds],
  );

  const handleBatchDelete = useCallback(async () => {
    if (selectedCount === 0) return;
    try {
      await Promise.all([...selectedIds].map((id) => deleteNote(id)));
      await refreshList();
      setSnackMsg(pm.deleted);
      exitSelectionMode();
      setShowBatchDelete(false);
    } catch (err) {
      setSnackMsg(err instanceof Error ? err.message : pm.actionFailed);
    }
  }, [exitSelectionMode, pm.actionFailed, pm.deleted, refreshList, selectedCount, selectedIds]);

  const handleApplyBatchTags = useCallback(
    async (tags: string[]) => {
      if (selectedCount === 0) return;
      try {
        await Promise.all([...selectedIds].map((id) => updateNote(id, { tags })));
        await refreshList();
        setSnackMsg(pm.tagUpdated);
        exitSelectionMode();
        setBatchTagPicker(false);
      } catch (err) {
        setSnackMsg(err instanceof Error ? err.message : pm.actionFailed);
      }
    },
    [exitSelectionMode, pm.actionFailed, pm.tagUpdated, refreshList, selectedCount, selectedIds],
  );

  const notes = notesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    ensureNoteTags(collectTagsFromNotes(notes));
  }, [ensureNoteTags, notes]);

  const filteredNotes = useMemo(
    () => notes.filter((note) => (
      !pendingDeleteIds.has(note.id)
      && noteMatchesTagFilter(note, tagFilter)
    )),
    [notes, pendingDeleteIds, tagFilter],
  );

  const handleCreateTag = useCallback(
    (raw: string) => {
      const created = addNoteTag(raw);
      if (!created) return null;
      setTagFilter(created);
      return created;
    },
    [addNoteTag],
  );

  const handleCreateTagOnly = useCallback(
    (raw: string) => addNoteTag(raw),
    [addNoteTag],
  );

  const handleSelectTagFromPicker = useCallback((tag: string | null) => {
    setTagFilter(tag ?? 'all');
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!notesQuery.hasNextPage || notesQuery.isFetchingNextPage) return;
    void notesQuery.fetchNextPage();
  }, [notesQuery.fetchNextPage, notesQuery.hasNextPage, notesQuery.isFetchingNextPage]);

  const { onEndReached, onMomentumScrollBegin } = useFlatListEndReached(handleLoadMore);

  const onRefresh = useCallback(async () => {
    await refreshList();
  }, [refreshList]);

  const batchActions = useMemo(() => [
    {
      key: 'pin',
      icon: 'pin-outline',
      label: pm.pin,
      onPress: () => handleBatchPin(true),
      disabled: selectedCount === 0,
    },
    {
      key: 'unpin',
      icon: 'pin-off-outline',
      label: pm.unpin,
      onPress: () => handleBatchPin(false),
      disabled: selectedCount === 0,
    },
    {
      key: 'archive',
      icon: 'archive-arrow-down-outline',
      label: pm.archive,
      onPress: handleBatchArchive,
      disabled: selectedCount === 0,
    },
    {
      key: 'tags',
      icon: 'tag-multiple-outline',
      label: li.addTags,
      onPress: () => setBatchTagPicker(true),
      disabled: selectedCount === 0,
    },
    {
      key: 'delete',
      icon: 'trash-can-outline',
      label: pm.delete,
      destructive: true,
      onPress: () => setShowBatchDelete(true),
      disabled: selectedCount === 0,
    },
  ], [handleBatchArchive, handleBatchPin, li.addTags, pm.archive, pm.delete, pm.pin, pm.unpin, selectedCount]);

  const renderNote = useCallback(
    ({ item }: { item: NoteIndexEntry }) => (
      <NoteCard
        note={item}
        onPress={handleNotePress}
        onLongPress={handleNoteLongPress}
        onSwipeAction={handleSwipeAction}
        selectionMode={selectionMode}
        selected={selectedIds.has(item.id)}
      />
    ),
    [handleNoteLongPress, handleNotePress, handleSwipeAction, selectedIds, selectionMode],
  );

  const listBottomPadding = selectionMode
    ? insets.bottom + 120
    : floatingBottomPadding(insets.bottom) + FLOATING_BOTTOM_OFFSET + 88;

  if (!configured) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
        <FloatingHeader title={pm.title} onBack={embedded ? undefined : handleBack} />
        <View style={styles.center}>
          <Text style={{ opacity: 0.6 }}>{m.sessions.gatewayNotConfigured}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <FloatingHeader
        title={selectionMode ? t(li.selectedCount, { count: selectedCount }) : pm.title}
        variant={selectionMode ? 'compact' : 'large'}
        onBack={selectionMode ? exitSelectionMode : embedded ? undefined : handleBack}
        onSearchPress={!selectionMode ? () => setSearchOpen((value) => !value) : undefined}
        searchPlaceholder={searchText.trim() || m.common.search}
        rightActions={!selectionMode ? [
          {
            icon: 'note-plus-outline',
            accessibilityLabel: pm.quickCapturePlaceholder,
            onPress: handleCreateNote,
          },
          {
            icon: 'tag-outline',
            accessibilityLabel: pm.tagPickerTitle,
            onPress: () => {
              setFocusTagCreate(false);
              setShowTagPicker(true);
            },
          },
        ] : undefined}
      />

      {!selectionMode && searchOpen ? (
        <View style={styles.searchWrap}>
          <View style={[styles.searchBox, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
            <Icon source="magnify" size={18} color={colors.text.tertiary} />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder={m.common.search}
              placeholderTextColor={colors.text.tertiary}
              style={[styles.searchInput, { color: colors.text.primary }]}
              autoFocus
            />
          </View>
        </View>
      ) : null}

      <View style={styles.listArea}>
        {notesQuery.isLoading ? (
          <ListSkeleton count={8} />
        ) : (
          <FlatList
            data={filteredNotes}
            keyExtractor={(item) => item.id}
            renderItem={renderNote}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            onMomentumScrollBegin={onMomentumScrollBegin}
            ListFooterComponent={notesQuery.isFetchingNextPage ? <View style={styles.footerLoader}><ActivityIndicator size="small" /></View> : null}
            contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}
            extraData={{ selectionMode, selectedCount, selectedKey: [...selectedIds].join('|') }}
            refreshControl={
              <RefreshControl refreshing={notesQuery.isFetching && !notesQuery.isLoading && !notesQuery.isFetchingNextPage} onRefresh={onRefresh} />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={[styles.emptyIconWrap, { backgroundColor: colors.accent.selectionBg }]}>
                  <Icon source="note-text-outline" size={40} color={colors.accent.primary} />
                </View>
                <Text style={{ color: colors.text.secondary, marginTop: 12, fontSize: 16, fontWeight: '600' }}>
                  {searchText.trim() ? pm.searchNoResults : tagFilter === 'all' ? pm.empty : pm.tagEmptyFiltered}
                </Text>
                <Text style={{ color: colors.text.tertiary, fontSize: 13, textAlign: 'center', maxWidth: 240 }}>
                  {searchText.trim() ? pm.searchPlaceholder : tagFilter === 'all' ? pm.emptyHint : pm.tagEmptyFilteredHint}
                </Text>
              </View>
            }
          />
        )}
      </View>

      {selectionMode ? <BatchActionBar items={batchActions} /> : null}

      <BatchDeleteConfirmDialog
        visible={showBatchDelete}
        count={selectedCount}
        onDismiss={() => setShowBatchDelete(false)}
        onConfirm={() => void handleBatchDelete()}
      />

      <AppToast
        visible={Boolean(snackMsg)}
        onDismiss={() => setSnackMsg('')}
        duration={pendingUndoId && snackMsg === pm.deleted ? LIST_DELETE_UNDO_MS : TOAST_DURATION_DEFAULT}
        action={pendingUndoId && snackMsg === pm.deleted ? { label: li.undo, onPress: () => undoDelete() } : undefined}
        bottomLift={TOAST_BOTTOM_LIFT_ABOVE_BAR}
      >
        {snackMsg}
      </AppToast>

      <NoteTagPickerSheet
        visible={showTagPicker}
        tags={noteTags}
        selectedTag={tagFilter === 'all' ? null : tagFilter}
        onSelect={handleSelectTagFromPicker}
        onCreateTag={handleCreateTag}
        onDismiss={() => {
          setShowTagPicker(false);
          setFocusTagCreate(false);
        }}
        focusCreate={focusTagCreate}
      />

      <NoteTagPickerSheet
        visible={batchTagPicker}
        mode="multi"
        tags={noteTags}
        selectedTags={[]}
        onApplyTags={(tags) => void handleApplyBatchTags(tags)}
        onCreateTag={handleCreateTagOnly}
        onDismiss={() => setBatchTagPicker(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 18,
  },
  notesTitle: {
    flex: 1,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconPlaceholder: {
    width: 0,
    height: 34,
  },
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 12,
  },
  searchBox: {
    minHeight: 44,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Platform.select({ ios: 10, android: 6, default: 8 }),
  },
  listArea: { flex: 1, minHeight: 0 },
  list: { paddingTop: spacing.xs, paddingBottom: spacing.lg, gap: 0, flexGrow: 1 },
  footerLoader: { paddingVertical: 16, alignItems: 'center' },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerWrap: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 4,
  },
  intentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 6,
  },
  composerShell: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 2,
  },
  toolBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: 4,
    paddingVertical: Platform.select({ ios: 5, android: 4, default: 4 }),
    borderWidth: 0,
    maxHeight: 100,
  },
  sendCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBtn: {
    borderRadius: 18,
  },
});

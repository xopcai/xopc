import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast } from '../../components/AppToast';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
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
  type Note,
  type NoteIndexEntry,
  type NoteKind,
  type NoteStatus,
} from '../../query/notes';
import { queryKeys } from '../../query/keys';
import {
  noteToIndexEntry,
  removeNoteFromListCaches,
  upsertNoteInListCaches,
} from '../../query/note-list-cache';
import { refreshNotesList, resetNoteListPagination } from '../../query/infinite-list-sync';
import { useGatewayConfigured } from '../../query/sessions';
import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding, spacing, typography, useTheme } from '../../theme';

import { useNoteTagsStore } from '../../stores/note-tags-store';
import { NoteTagPickerSheet } from './NoteTagPickerSheet';
import { collectTagsFromNotes, noteMatchesTagFilter, type NoteTagFilter } from './note-tag-utils';
import { NoteCard } from './NoteCard';

type StatusFilter = 'all' | NoteStatus;
type KindFilter = 'all' | NoteKind;
type ScopeFilter = 'all' | 'inbox' | 'tasks' | 'archived';

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

  const initialScope: ScopeFilter = params.kind === 'task' ? 'tasks' : 'all';
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>(initialScope);
  const statusFilter: StatusFilter = scopeFilter === 'inbox'
    ? 'inbox'
    : scopeFilter === 'archived'
      ? 'archived'
      : 'all';
  const kindFilter: KindFilter = scopeFilter === 'tasks' ? 'task' : 'all';
  const [tagFilter, setTagFilter] = useState<NoteTagFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const searchInputRef = useRef<TextInput>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    router.push(noteDetailRoute(note.id));
  }, [router, selectionMode, toggleSelected]);

  const createNoteMutation = useMutation({
    mutationFn: createBlankNote,
    onSuccess: (result) => {
      upsertNoteInListCaches(queryClient, noteToIndexEntry(result.note as Note));
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
        .then((updated) => upsertNoteInListCaches(queryClient, noteToIndexEntry(updated)))
        .then(() => setSnackMsg(pm.updated))
        .catch((err) => setSnackMsg(err instanceof Error ? err.message : pm.actionFailed));
      return;
    }

    if (action.key === 'archive') {
      void updateNote(note.id, { status: 'archived' })
        .then((updated) => upsertNoteInListCaches(queryClient, noteToIndexEntry(updated)))
        .then(() => setSnackMsg(pm.updated))
        .catch((err) => setSnackMsg(err instanceof Error ? err.message : pm.actionFailed));
      return;
    }

    if (action.key === 'delete') {
      scheduleDelete(
        note.id,
        async () => {
          await deleteNote(note.id);
          removeNoteFromListCaches(queryClient, note.id);
          await resetNoteListPagination(queryClient);
        },
        (err) => setSnackMsg(err instanceof Error ? err.message : pm.actionFailed),
      );
      setSnackMsg(pm.deleted);
    }
  }, [pm.actionFailed, pm.deleted, pm.updated, queryClient, scheduleDelete]);

  const handleSearchToggle = useCallback(() => {
    if (searchOpen) {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
      searchInputRef.current?.clear();
      setSearchText('');
    }
    setSearchOpen(!searchOpen);
  }, [searchOpen]);

  const handleSearchChange = useCallback((value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      searchTimerRef.current = null;
      setSearchText(value.trim());
    }, 250);
  }, []);

  useEffect(() => () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
  }, []);

  const runBatchMutation = useCallback(
    async (runner: () => Promise<Note[]>, successMsg: string) => {
      if (selectedCount === 0) return;
      try {
        const updatedNotes = await runner();
        updatedNotes.forEach((updated) => upsertNoteInListCaches(queryClient, noteToIndexEntry(updated)));
        await resetNoteListPagination(queryClient);
        setSnackMsg(successMsg);
        exitSelectionMode();
      } catch (err) {
        setSnackMsg(err instanceof Error ? err.message : pm.actionFailed);
      }
    },
    [exitSelectionMode, pm.actionFailed, queryClient, selectedCount],
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
      selectedIds.forEach((id) => removeNoteFromListCaches(queryClient, id));
      await resetNoteListPagination(queryClient);
      setSnackMsg(pm.deleted);
      exitSelectionMode();
      setShowBatchDelete(false);
    } catch (err) {
      setSnackMsg(err instanceof Error ? err.message : pm.actionFailed);
    }
  }, [exitSelectionMode, pm.actionFailed, pm.deleted, queryClient, selectedCount, selectedIds]);

  const handleApplyBatchTags = useCallback(
    async (tags: string[]) => {
      if (selectedCount === 0) return;
      try {
        const updatedNotes = await Promise.all([...selectedIds].map((id) => updateNote(id, { tags })));
        updatedNotes.forEach((updated) => upsertNoteInListCaches(queryClient, noteToIndexEntry(updated)));
        setSnackMsg(pm.tagUpdated);
        exitSelectionMode();
        setBatchTagPicker(false);
      } catch (err) {
        setSnackMsg(err instanceof Error ? err.message : pm.actionFailed);
      }
    },
    [exitSelectionMode, pm.actionFailed, pm.tagUpdated, queryClient, selectedCount, selectedIds],
  );

  const notes = useMemo(
    () => notesQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [notesQuery.data?.pages],
  );

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

  const scopeOptions = useMemo<Array<{ key: ScopeFilter; label: string }>>(() => [
    { key: 'all', label: pm.filterAll },
    { key: 'inbox', label: pm.filterInbox },
    { key: 'tasks', label: pm.kindTodo },
    { key: 'archived', label: pm.filterArchived },
  ], [pm.filterAll, pm.filterArchived, pm.filterInbox, pm.kindTodo]);

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

  const listExtraData = useMemo(
    () => ({
      selectionMode,
      selectedKey: [...selectedIds].sort().join('|'),
    }),
    [selectedIds, selectionMode],
  );

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
    ({ item, index }: { item: NoteIndexEntry; index: number }) => (
      <NoteCard
        note={item}
        onPress={handleNotePress}
        onLongPress={handleNoteLongPress}
        onSwipeAction={handleSwipeAction}
        selectionMode={selectionMode}
        selected={selectedIds.has(item.id)}
        isFirst={index === 0}
        isLast={index === filteredNotes.length - 1}
      />
    ),
    [filteredNotes.length, handleNoteLongPress, handleNotePress, handleSwipeAction, selectedIds, selectionMode],
  );

  const listBottomPadding = selectionMode
    ? insets.bottom + 120
    : floatingBottomPadding(insets.bottom) + FLOATING_BOTTOM_OFFSET + 88;

  if (!configured) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
        <NativeScreenHeader title={pm.title} onBack={embedded ? undefined : handleBack} />
        <View style={styles.center}>
          <Text style={{ opacity: 0.6 }}>{m.sessions.gatewayNotConfigured}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        title={selectionMode ? t(li.selectedCount, { count: selectedCount }) : pm.title}
        onBack={selectionMode ? exitSelectionMode : embedded ? undefined : handleBack}
        onSearchPress={!selectionMode ? handleSearchToggle : undefined}
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
              ref={searchInputRef}
              defaultValue=""
              onChangeText={handleSearchChange}
              placeholder={m.common.search}
              placeholderTextColor={colors.text.tertiary}
              style={[styles.searchInput, { color: colors.text.primary }]}
              autoFocus
            />
          </View>
        </View>
      ) : null}

      {!selectionMode ? (
        <ScrollView
          horizontal
          style={styles.filterScroll}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {scopeOptions.map((option) => {
            const active = scopeFilter === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => setScopeFilter(option.key)}
                style={({ pressed }) => [
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.accent.selectionBg : colors.surface.panel,
                    borderColor: active ? colors.accent.primary : colors.border.subtle,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.filterChipText, { color: active ? colors.accent.primary : colors.text.secondary }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
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
            extraData={listExtraData}
            refreshControl={
              <RefreshControl refreshing={notesQuery.isFetching && !notesQuery.isLoading && !notesQuery.isFetchingNextPage} onRefresh={onRefresh} />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={[styles.emptyIconWrap, { backgroundColor: colors.accent.selectionBg }]}>
                  <Icon source="note-text-outline" size={40} color={colors.accent.primary} />
                </View>
                <Text style={{ color: colors.text.secondary, marginTop: spacing.md, ...typography.heading }}>
                  {searchText.trim() ? pm.searchNoResults : tagFilter === 'all' && scopeFilter === 'all' ? pm.empty : pm.tagEmptyFiltered}
                </Text>
                <Text style={{ color: colors.text.tertiary, textAlign: 'center', maxWidth: 240, ...typography.label }}>
                  {searchText.trim() ? pm.searchPlaceholder : tagFilter === 'all' && scopeFilter === 'all' ? pm.emptyHint : pm.tagEmptyFilteredHint}
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
  filters: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filterChip: {
    minHeight: 34,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 17,
    paddingHorizontal: spacing.md,
  },
  filterChipText: {
    ...typography.label,
    fontWeight: '600',
  },
  listArea: { flex: 1, minHeight: 0 },
  list: { paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: 0, flexGrow: 1 },
  footerLoader: { paddingVertical: 16, alignItems: 'center' },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

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
import { ActivityIndicator, Chip, Icon, Text } from 'react-native-paper';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
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

import { AttachmentFileError, pickAttachmentFromSource } from '../chat/attachment-file-io';
import {
  beginRecording,
  finishRecording,
  inferRecordingMimeType,
  requestMicPermission,
  type ExpoRecording,
} from '../chat/voiceRecording';
import { useMessages, t } from '../../i18n/messages';
import { dismissOrHome, useDismissOnHardwareBack } from '../../lib/navigation';
import { useFlatListEndReached } from '../../lib/use-flat-list-end-reached';
import {
  deleteNote,
  fetchNotes,
  captureNote,
  updateNote,
  type NoteIndexEntry,
  type NoteKind,
  type NoteStatus,
} from '../../query/notes';
import { queryKeys } from '../../query/keys';
import { refreshNotesList } from '../../query/infinite-list-sync';
import { useGatewayConfigured } from '../../query/sessions';
import { useTheme, FLOATING_BOTTOM_OFFSET, floatingBottomPadding } from '../../theme';

import { useNoteTagsStore } from '../../stores/note-tags-store';
import { NoteTagPickerSheet } from './NoteTagPickerSheet';
import { NoteTagTabs } from './NoteTagTabs';
import { collectTagsFromNotes, noteMatchesTagFilter, type NoteTagFilter } from './note-tag-utils';
import { NoteCard } from './NoteCard';
import {
  captureNoteWithComposerAttachment,
  captureNoteWithVoice,
  prepareVoiceCapturePayload,
} from './capture-note-media';
import { flushPendingNotes, queueMediaCapture, queueNote } from './notes-sync';
import { captureIntentBadgeKey, parseCaptureIntent } from './capture-parser';
import type { ComposerAttachment } from '../chat/composer.types';

type CapturePayload =
  | { type: 'text'; text: string }
  | { type: 'attachment'; attachment: ComposerAttachment }
  | { type: 'voice'; uri: string; durationMillis: number; mimeType: string };

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
  const { colors, isDark } = useTheme();
  const configured = useGatewayConfigured();
  const m = useMessages();
  const pm = m.notesPage;
  const cm = m.chat;
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>(initialKind);
  const [tagFilter, setTagFilter] = useState<NoteTagFilter>('all');
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [focusTagCreate, setFocusTagCreate] = useState(false);
  const [captureText, setCaptureText] = useState('');
  const [snackMsg, setSnackMsg] = useState('');
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef<ExpoRecording | null>(null);
  const noteTags = useNoteTagsStore((s) => s.tags);
  const addNoteTag = useNoteTagsStore((s) => s.addTag);
  const ensureNoteTags = useNoteTagsStore((s) => s.ensureTags);

  const notesListQueryKey = useMemo(
    () => [...queryKeys.notesAll, statusFilter, kindFilter] as const,
    [statusFilter, kindFilter],
  );

  const notesQuery = useInfiniteQuery({
    queryKey: notesListQueryKey,
    queryFn: ({ pageParam }) =>
      fetchNotes({
        status: statusFilter === 'all' ? undefined : statusFilter,
        kind: kindFilter === 'all' ? undefined : kindFilter,
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

  const captureMutation = useMutation({
    mutationFn: async (payload: CapturePayload) => {
      if (payload.type === 'text') {
        const intent = parseCaptureIntent(payload.text);
        return captureNote({ text: payload.text, kind: intent.kind });
      }
      if (payload.type === 'attachment') {
        return captureNoteWithComposerAttachment(payload.attachment, captureText);
      }
      return captureNoteWithVoice(payload);
    },
    onSuccess: async () => {
      setCaptureText('');
      await refreshList();
    },
    onError: async (err, payload) => {
      if (payload.type === 'text') {
        queueNote(payload.text);
        setSnackMsg(pm.savedOffline);
        return;
      }
      try {
        if (payload.type === 'attachment') {
          queueMediaCapture({ type: 'attachment', attachment: payload.attachment, text: captureText });
        } else {
          const queued = await prepareVoiceCapturePayload(payload);
          queueMediaCapture({ type: 'voice', ...queued });
        }
        setCaptureText('');
        setSnackMsg(pm.savedOffline);
      } catch {
        setSnackMsg(err instanceof Error ? err.message : pm.actionFailed);
      }
    },
  });

  const handleCapture = useCallback(() => {
    const text = captureText.trim();
    if (!text) return;
    captureMutation.mutate({ type: 'text', text });
  }, [captureText, captureMutation]);

  const handleVoiceStart = useCallback(async () => {
    const granted = await requestMicPermission();
    if (!granted) { setSnackMsg(pm.micDenied); return; }
    setRecording(true);
    try {
      recordingRef.current = await beginRecording(() => {});
    } catch {
      setRecording(false);
      setSnackMsg(pm.actionFailed);
    }
  }, [pm]);

  const handleVoiceEnd = useCallback(async () => {
    setRecording(false);
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    try {
      const { uri, durationMillis } = await finishRecording(rec);
      if (!uri || durationMillis < 500) { return; }
      const mimeType = inferRecordingMimeType(uri);
      captureMutation.mutate({ type: 'voice', uri, durationMillis, mimeType });
    } catch {
      setSnackMsg(pm.actionFailed);
    }
  }, [captureMutation, pm]);


  const handlePickImage = useCallback(async (source: 'camera' | 'photos') => {
    try {
      const attachment = await pickAttachmentFromSource(source);
      if (!attachment) return;
      captureMutation.mutate({ type: 'attachment', attachment });
    } catch (err) {
      if (err instanceof AttachmentFileError && err.code === 'permission_denied') {
        setSnackMsg(source === 'camera' ? cm.attachmentCameraPermissionDenied : cm.attachmentPermissionDenied);
      }
    }
  }, [captureMutation, cm.attachmentCameraPermissionDenied, cm.attachmentPermissionDenied]);

  const handleNotePress = useCallback((note: NoteIndexEntry) => {
    if (selectionMode) {
      toggleSelected(note.id);
      return;
    }
    router.push(`/items/${note.id}`);
  }, [router, selectionMode, toggleSelected]);

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
    () => notes.filter((note) => !pendingDeleteIds.has(note.id) && noteMatchesTagFilter(note, tagFilter)),
    [notes, pendingDeleteIds, tagFilter],
  );

  const handleOpenCreateTag = useCallback(() => {
    setFocusTagCreate(true);
    setShowTagPicker(true);
  }, []);

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
    if (tag) setTagFilter(tag);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!notesQuery.hasNextPage || notesQuery.isFetchingNextPage) return;
    void notesQuery.fetchNextPage();
  }, [notesQuery.fetchNextPage, notesQuery.hasNextPage, notesQuery.isFetchingNextPage]);

  const { onEndReached, onMomentumScrollBegin } = useFlatListEndReached(handleLoadMore);

  const onRefresh = useCallback(async () => {
    await flushPendingNotes();
    await refreshList();
  }, [refreshList]);

  const statusFilters: { key: StatusFilter; label: string }[] = useMemo(() => [
    { key: 'all', label: pm.filterAll },
    { key: 'inbox', label: pm.filterInbox },
    { key: 'processed', label: pm.filterProcessed },
    { key: 'archived', label: pm.filterArchived },
  ], [pm]);

  const kindFilters: { key: KindFilter; label: string }[] = useMemo(() => [
    { key: 'all', label: pm.kindAll },
    { key: 'thought', label: pm.kindThought },
    { key: 'todo', label: pm.kindTodo },
    { key: 'voice', label: pm.kindVoice },
    { key: 'media', label: pm.kindMedia },
  ], [pm]);

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
    : insets.bottom + 80;

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
        onBack={selectionMode ? exitSelectionMode : embedded ? undefined : handleBack}
      />

      {!selectionMode ? (
        <NoteTagTabs
          tags={noteTags}
          activeTag={tagFilter}
          onSelect={setTagFilter}
          onAddPress={handleOpenCreateTag}
        />
      ) : null}

      {/* Filters — single row, horizontally scrollable */}
      {!selectionMode ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
          style={styles.filterStrip}
        >
          {statusFilters.map((f) => (
            <Chip key={f.key} selected={statusFilter === f.key} onPress={() => setStatusFilter(f.key)} compact mode="outlined">
              {f.label}
            </Chip>
          ))}
          {kindFilters.map((f) => (
            <Chip key={f.key} selected={kindFilter === f.key} onPress={() => setKindFilter(f.key)} compact mode="outlined">
              {f.label}
            </Chip>
          ))}
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
                  {tagFilter === 'all' ? pm.empty : pm.tagEmptyFiltered}
                </Text>
                <Text style={{ color: colors.text.tertiary, fontSize: 13, textAlign: 'center', maxWidth: 240 }}>
                  {tagFilter === 'all' ? pm.emptyHint : pm.tagEmptyFilteredHint}
                </Text>
              </View>
            }
          />
        )}
      </View>

      {/* Bottom composer — multiline with smart intent detection */}
      {selectionMode ? (
        <BatchActionBar items={batchActions} />
      ) : (
        <KeyboardStickyView
          offset={{ closed: 0, opened: 0 }}
          style={{ marginBottom: FLOATING_BOTTOM_OFFSET }}
        >
          <View style={[styles.composerWrap, { paddingBottom: floatingBottomPadding(insets.bottom) }]}>
          {/* Intent badge */}
          {captureText.trim().length > 0 && (() => {
            const intent = parseCaptureIntent(captureText);
            const badgeKey = captureIntentBadgeKey(intent);
            if (!badgeKey) return null;
            return (
              <View style={[styles.intentBadge, { backgroundColor: colors.accent.selectionBg }]}>
                <Icon source={intent.kind === 'todo' ? 'checkbox-marked-outline' : 'link'} size={14} color={colors.accent.primary} />
                <Text style={{ fontSize: 11, color: colors.accent.primary }}>
                  {pm[badgeKey]}
                </Text>
              </View>
            );
          })()}
          <View
            style={[
              styles.composerShell,
              {
                backgroundColor: isDark ? colors.surface.input : colors.surface.panel,
                borderColor: colors.border.default,
              },
            ]}
          >
            <View style={styles.composerRow}>
              <Pressable style={[styles.toolBtn, { backgroundColor: colors.surface.input }]} onPress={() => void handlePickImage('photos')}>
                <Icon source="image-outline" size={20} color={colors.text.tertiary} />
              </Pressable>
              <Pressable style={[styles.toolBtn, { backgroundColor: colors.surface.input }]} onPress={() => void handlePickImage('camera')}>
                <Icon source="camera-outline" size={20} color={colors.text.tertiary} />
              </Pressable>
              <TextInput
                style={[styles.composerInput, { color: colors.text.primary }]}
                placeholder={pm.quickCapturePlaceholder}
                placeholderTextColor={colors.text.tertiary}
                value={captureText}
                onChangeText={setCaptureText}
                onSubmitEditing={handleCapture}
                returnKeyType="send"
                multiline
                blurOnSubmit
                textAlignVertical="center"
              />
              {captureText.trim() ? (
                <Pressable
                  style={[styles.sendCircle, { backgroundColor: colors.text.primary }]}
                  onPress={handleCapture}
                  disabled={captureMutation.isPending}
                  hitSlop={8}
                >
                  <Icon source="arrow-up" size={20} color={colors.text.inverse} />
                </Pressable>
              ) : (
                <Pressable
                  style={[
                    styles.toolBtn,
                    { backgroundColor: colors.surface.input },
	                    recording && { backgroundColor: colors.semantic.errorBold },
	                  ]}
                  onPressIn={() => void handleVoiceStart()}
                  onPressOut={() => void handleVoiceEnd()}
                  hitSlop={8}
                >
	                  <Icon source="microphone" size={20} color={recording ? colors.accent.onPrimary : colors.text.tertiary} />
                </Pressable>
              )}
            </View>
          </View>
        </View>
        </KeyboardStickyView>
      )}

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
  filterStrip: {
    flexGrow: 0,
    marginBottom: 6,
  },
  filterScroll: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
  },
  listArea: { flex: 1, minHeight: 0 },
  list: { padding: 16, paddingTop: 8, gap: 10, flexGrow: 1 },
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

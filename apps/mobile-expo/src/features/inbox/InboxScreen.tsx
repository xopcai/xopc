import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BatchActionBar } from '../../components/BatchActionBar';
import { BatchDeleteConfirmDialog } from '../../components/BatchDeleteConfirmDialog';
import { AppToast } from '../../components/AppToast';
import { FloatingHeader } from '../../components/FloatingHeader';
import { ListSkeleton } from '../../components/ListSkeleton';
import { ListSelectionCheckbox } from '../../components/ListSelectionCheckbox';
import { SwipeableRow, type SwipeAction } from '../../components/SwipeableRow';
import { LIST_DELAY_LONG_PRESS, LIST_DELETE_UNDO_MS } from '../../constants/list-interaction';
import { TOAST_BOTTOM_LIFT_ABOVE_BAR, TOAST_DURATION_SHORT } from '../../constants/toast';
import { dismissOrHome } from '../../lib/navigation';
import { useFlatListEndReached } from '../../lib/use-flat-list-end-reached';
import { useDelayedDelete } from '../../hooks/use-delayed-delete';
import { useListSelection } from '../../hooks/use-list-selection';
import { useMessages, t } from '../../i18n/messages';
import { AttachmentFileError, pickAttachmentFromSource, type AttachmentPickSource } from '../chat/attachment-file-io';
import type { ComposerAttachment } from '../chat/composer.types';
import { deleteNote, fetchNotes, captureNote, updateNote, type NoteIndexEntry } from '../../query/notes';
import { queryKeys } from '../../query/keys';
import { useGatewayConfigured } from '../../query/sessions';
import { invalidateHomeFeed } from '../../query/workspace-sync';
import { NOTE_KIND_ICONS } from '../notes/note-list-display';
import { radii, spacing, typography, useTheme, FLOATING_BOTTOM_OFFSET, floatingBottomPadding } from '../../theme';
import {
  captureNoteWithComposerAttachment,
  captureNoteWithVoice,
  prepareVoiceCapturePayload,
} from '../notes/capture-note-media';
import { parseCaptureIntent } from '../notes/capture-parser';
import { flushPendingNotes, queueMediaCapture, queueNote } from '../notes/notes-sync';
import { QuickCaptureComposer } from '../notes/QuickCaptureComposer';
import { InboxItemContent } from './InboxItemContent';

type CapturePayload =
  | { type: 'text'; text: string }
  | { type: 'attachment'; attachment: ComposerAttachment }
  | { type: 'voice'; uri: string; durationMillis: number; mimeType: string };

const PAGE_SIZE = 20;
const INBOX_ITEM_HEIGHT = 78;

export function InboxScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const m = useMessages();
  const im = m.inboxPage;
  const pm = m.notesPage;
  const cm = m.chat;
  const li = m.listInteraction;
  const configured = useGatewayConfigured();
  const [captureText, setCaptureText] = useState('');
  const [snackMsg, setSnackMsg] = useState('');
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

  const inboxQuery = useInfiniteQuery({
    queryKey: queryKeys.notes('inbox'),
    queryFn: ({ pageParam }) => fetchNotes({ status: 'inbox', limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined,
    enabled: configured,
  });

  const items = useMemo(
    () => (inboxQuery.data?.pages.flatMap((page) => page.items) ?? [])
      .filter((item) => !pendingDeleteIds.has(item.id)),
    [inboxQuery.data?.pages, pendingDeleteIds],
  );

  const invalidateInbox = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.notes('inbox') });
    invalidateHomeFeed(queryClient);
  }, [queryClient]);

  const handleLoadMore = useCallback(() => {
    if (!inboxQuery.hasNextPage || inboxQuery.isFetchingNextPage) return;
    void inboxQuery.fetchNextPage();
  }, [inboxQuery.fetchNextPage, inboxQuery.hasNextPage, inboxQuery.isFetchingNextPage]);

  const { onEndReached, onMomentumScrollBegin } = useFlatListEndReached(handleLoadMore);

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
      await invalidateInbox();
    },
    onError: async (err, payload) => {
      try {
        if (payload.type === 'text') {
          queueNote(payload.text);
        } else if (payload.type === 'attachment') {
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

  const archiveIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => updateNote(id, { status: 'archived' })));
    await invalidateInbox();
  }, [invalidateInbox]);

  const deleteIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => deleteNote(id)));
    await invalidateInbox();
  }, [invalidateInbox]);

  const archiveMutation = useMutation({
    mutationFn: archiveIds,
    onSuccess: (_data, ids) => {
      if (ids.length > 1) {
        setSnackMsg(t(im.batchArchived, { count: ids.length }));
      } else {
        setSnackMsg(im.archived);
      }
      exitSelectionMode();
    },
    onError: (err) => setSnackMsg(err instanceof Error ? err.message : pm.actionFailed),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteIds,
    onSuccess: (_data, ids) => {
      setSnackMsg(ids.length > 1 ? t(im.batchDeleted, { count: ids.length }) : pm.deleted);
      exitSelectionMode();
      setShowBatchDelete(false);
    },
    onError: (err) => setSnackMsg(err instanceof Error ? err.message : pm.actionFailed),
  });

  const handleCapture = useCallback(() => {
    const text = captureText.trim();
    if (!text) return;
    captureMutation.mutate({ type: 'text', text });
  }, [captureMutation, captureText]);

  const handleAttachmentSource = useCallback(async (source: AttachmentPickSource) => {
    try {
      const attachment = await pickAttachmentFromSource(source);
      if (!attachment) return;
      captureMutation.mutate({ type: 'attachment', attachment });
    } catch (error) {
      if (error instanceof AttachmentFileError && error.code === 'permission_denied') {
        setSnackMsg(source === 'camera' ? cm.attachmentCameraPermissionDenied : cm.attachmentPermissionDenied);
        return;
      }
      setSnackMsg(pm.actionFailed);
    }
  }, [captureMutation, cm.attachmentCameraPermissionDenied, cm.attachmentPermissionDenied, pm.actionFailed]);

  const handleVoiceCapture = useCallback((payload: { uri: string; durationMillis: number; mimeType: string }) => {
    captureMutation.mutate({ type: 'voice', ...payload });
  }, [captureMutation]);

  const handleItemPress = useCallback((item: NoteIndexEntry) => {
    if (selectionMode) {
      toggleSelected(item.id);
      return;
    }
    router.push(`/items/${item.id}`);
  }, [router, selectionMode, toggleSelected]);

  const handleItemLongPress = useCallback((item: NoteIndexEntry) => {
    if (selectionMode) return;
    startSelection();
    toggleSelected(item.id);
  }, [selectionMode, startSelection, toggleSelected]);

  const handleSwipeAction = useCallback((item: NoteIndexEntry, action: SwipeAction) => {
    if (action.key === 'archive') {
      archiveMutation.mutate([item.id]);
      return;
    }

    if (action.key === 'delete') {
      scheduleDelete(
        item.id,
        async () => {
          await deleteNote(item.id);
          await invalidateInbox();
        },
        (err) => setSnackMsg(err instanceof Error ? err.message : pm.actionFailed),
      );
      setSnackMsg(pm.deleted);
    }
  }, [archiveMutation, invalidateInbox, pm.actionFailed, pm.deleted, scheduleDelete]);

  const batchActions = useMemo(() => [
    {
      key: 'archive',
      icon: 'archive-arrow-down-outline',
      label: pm.archive,
      onPress: () => archiveMutation.mutate([...selectedIds]),
      disabled: selectedCount === 0 || archiveMutation.isPending || deleteMutation.isPending,
      loading: archiveMutation.isPending,
    },
    {
      key: 'delete',
      icon: 'trash-can-outline',
      label: pm.delete,
      destructive: true,
      onPress: () => setShowBatchDelete(true),
      disabled: selectedCount === 0 || archiveMutation.isPending || deleteMutation.isPending,
      loading: deleteMutation.isPending,
    },
  ], [archiveMutation, deleteMutation, pm.archive, pm.delete, selectedCount, selectedIds]);

  const renderItem = useCallback(({ item }: { item: NoteIndexEntry }) => {
    const selected = selectedIds.has(item.id);
    const row = (
      <Pressable
        style={({ pressed }) => [
          styles.itemCard,
          !selected && (Platform.OS === 'web' ? styles.itemCardRaisedWeb : styles.itemCardRaisedNative),
          {
            backgroundColor: selected
              ? colors.accent.selectionBg
              : pressed
                ? colors.surface.hover
                : colors.surface.panel,
            borderColor: selected ? colors.accent.primary : colors.border.default,
          },
          pressed && !selected && (Platform.OS === 'web' ? styles.itemCardPressedWeb : styles.itemCardPressedNative),
        ]}
        onPress={() => handleItemPress(item)}
        onLongPress={() => handleItemLongPress(item)}
        delayLongPress={LIST_DELAY_LONG_PRESS}
        accessibilityState={selectionMode ? { selected } : undefined}
      >
        {selectionMode ? (
          <ListSelectionCheckbox selected={selected} />
        ) : (
          <View
            style={[
              styles.itemIcon,
              {
                backgroundColor: selected ? colors.surface.panel : colors.accent.soft,
                borderColor: selected ? colors.accent.primary : colors.border.subtle,
              },
            ]}
          >
            <Icon source={NOTE_KIND_ICONS[item.kind] ?? 'lightbulb-outline'} size={20} color={colors.accent.primary} />
          </View>
        )}
        <InboxItemContent note={item} />
      </Pressable>
    );

    if (selectionMode) return row;

    const actions: SwipeAction[] = [
      { key: 'archive', icon: 'archive-arrow-down-outline', color: 'blue', label: pm.archive },
      { key: 'delete', icon: 'trash-can-outline', color: 'red', label: pm.delete, destructive: true },
    ];

    return (
      <SwipeableRow actions={actions} onActionPress={(action) => handleSwipeAction(item, action)}>
        {row}
      </SwipeableRow>
    );
  }, [
    colors.accent.primary,
    colors.accent.selectionBg,
    colors.accent.soft,
    colors.border.default,
    colors.border.subtle,
    colors.surface.hover,
    colors.surface.panel,
    handleItemLongPress,
    handleItemPress,
    handleSwipeAction,
    pm.archive,
    pm.delete,
    selectedIds,
    selectionMode,
  ]);

  const listBottomPadding = selectionMode
    ? insets.bottom + 120
    : insets.bottom + 80;

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <FloatingHeader
        title={selectionMode ? t(li.selectedCount, { count: selectedCount }) : im.title}
        onBack={selectionMode ? exitSelectionMode : () => dismissOrHome(router)}
      />

      {inboxQuery.isLoading ? (
        <ListSkeleton count={8} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          onMomentumScrollBegin={onMomentumScrollBegin}
          extraData={{ selectionMode, selectedCount, selectedKey: [...selectedIds].join('|') }}
          contentContainerStyle={[styles.listContent, { paddingBottom: listBottomPadding }]}
          refreshControl={
            <RefreshControl
              refreshing={inboxQuery.isFetching && !inboxQuery.isLoading && !inboxQuery.isFetchingNextPage}
              onRefresh={async () => {
                await flushPendingNotes();
                await inboxQuery.refetch();
              }}
            />
          }
          ListFooterComponent={inboxQuery.isFetchingNextPage ? <View style={styles.footerLoader}><Text style={{ color: colors.text.tertiary }}>{m.common.loading}</Text></View> : null}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Icon source="tray" size={42} color={colors.text.tertiary} />
              <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{im.emptyTitle}</Text>
              <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{im.emptyHint}</Text>
            </View>
          }
        />
      )}

      {selectionMode ? (
        <BatchActionBar items={batchActions} />
      ) : (
        <KeyboardStickyView
          offset={{ closed: 0, opened: 0 }}
          style={{ marginBottom: FLOATING_BOTTOM_OFFSET }}
        >
          <View style={[styles.bottomBar, { paddingBottom: floatingBottomPadding(insets.bottom) }]}>
            <QuickCaptureComposer
              value={captureText}
              onChangeText={setCaptureText}
              onSubmit={handleCapture}
              onVoiceCapture={handleVoiceCapture}
              onAttachmentSource={(source) => void handleAttachmentSource(source)}
              placeholder={im.capturePlaceholder}
              submitting={captureMutation.isPending}
            />
          </View>
        </KeyboardStickyView>
      )}

      <BatchDeleteConfirmDialog
        visible={showBatchDelete}
        count={selectedCount}
        onDismiss={() => setShowBatchDelete(false)}
        onConfirm={() => deleteMutation.mutate([...selectedIds])}
        loading={deleteMutation.isPending}
      />

      <AppToast
        visible={!!snackMsg}
        onDismiss={() => setSnackMsg('')}
        duration={pendingUndoId && snackMsg === pm.deleted ? LIST_DELETE_UNDO_MS : TOAST_DURATION_SHORT}
        action={pendingUndoId && snackMsg === pm.deleted ? { label: li.undo, onPress: () => undoDelete() } : undefined}
        bottomLift={TOAST_BOTTOM_LIFT_ABOVE_BAR}
      >
        {snackMsg}
      </AppToast>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bottomBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  listContent: { padding: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  itemCard: {
    height: INBOX_ITEM_HEIGHT,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  itemCardRaisedNative: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  itemCardRaisedWeb: {
    boxShadow: '0 3px 10px rgba(17, 19, 24, 0.08)',
  },
  itemCardPressedNative: {
    shadowOpacity: 0.03,
    transform: [{ translateY: 1 }],
  },
  itemCardPressedWeb: {
    boxShadow: '0 1px 4px rgba(17, 19, 24, 0.06)',
    transform: [{ translateY: 1 }],
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 110,
    paddingHorizontal: 36,
    gap: 8,
  },
  emptyTitle: { ...typography.heading },
  emptyText: { ...typography.label, textAlign: 'center' },
  footerLoader: { alignItems: 'center', paddingVertical: 14 },
});

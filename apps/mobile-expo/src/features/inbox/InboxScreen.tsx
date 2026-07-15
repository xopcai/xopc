import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
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
} from '../notes/capture-note-media';
import { parseCaptureIntent } from '../notes/capture-parser';
import { QuickCaptureComposer } from '../notes/QuickCaptureComposer';
import {
  buildInboxOrganizePatch,
  buildInboxOrganizeSuggestions,
  type InboxOrganizeSuggestion,
} from './ai-organize';
import { AiOrganizeSheet } from './AiOrganizeSheet';
import { InboxItemContent } from './InboxItemContent';
import { WorkspaceSyncStatusCard } from './WorkspaceSyncStatusCard';

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
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [applyingSuggestionId, setApplyingSuggestionId] = useState<string>();
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
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const organizeSuggestions = useMemo(() => buildInboxOrganizeSuggestions(items), [items]);

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
    onError: (err) => {
      setSnackMsg(err instanceof Error ? err.message : pm.actionFailed);
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

  const applyOrganizeSuggestion = useCallback(async (suggestion: InboxOrganizeSuggestion) => {
    if (applyingSuggestionId) return;
    setApplyingSuggestionId(suggestion.id);
    try {
      await Promise.all(suggestion.itemIds.map((id) => {
        const item = itemsById.get(id);
        if (!item) return Promise.resolve();
        return updateNote(id, buildInboxOrganizePatch(item, suggestion.id));
      }));
      await invalidateInbox();
      setOrganizeOpen(false);
      setSnackMsg(t(im.aiOrganizeApplied, { count: suggestion.count }));
    } catch (err) {
      setSnackMsg(err instanceof Error ? err.message : pm.actionFailed);
    } finally {
      setApplyingSuggestionId(undefined);
    }
  }, [applyingSuggestionId, im.aiOrganizeApplied, invalidateInbox, itemsById, pm.actionFailed]);

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
    if (action.key === 'work') {
      router.push({
        pathname: '/work/create',
        params: { noteId: item.id, title: item.title ?? item.snippet ?? '' },
      });
      return;
    }
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
  }, [archiveMutation, invalidateInbox, pm.actionFailed, pm.deleted, router, scheduleDelete]);

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

  const renderItem = useCallback(({ item, index }: { item: NoteIndexEntry; index: number }) => {
    const selected = selectedIds.has(item.id);
    const isFirst = index === 0;
    const isLast = index === items.length - 1;
    const row = (
      <Pressable
        style={({ pressed }) => [
          styles.itemCard,
          {
            backgroundColor: selected
              ? colors.accent.selectionBg
              : pressed
                ? colors.surface.pressed
                : colors.surface.panel,
            borderColor: selected ? colors.accent.primary : colors.border.subtle,
            borderTopWidth: isFirst || selected ? StyleSheet.hairlineWidth : 0,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderTopLeftRadius: isFirst || selected ? radii.lg : 0,
            borderTopRightRadius: isFirst || selected ? radii.lg : 0,
            borderBottomLeftRadius: isLast || selected ? radii.lg : 0,
            borderBottomRightRadius: isLast || selected ? radii.lg : 0,
          },
          selected && styles.itemCardSelected,
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
      { key: 'work', icon: 'checkbox-marked-circle-outline', color: 'blue', label: m.workPage.create },
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
    items.length,
    m.workPage.create,
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
        variant={selectionMode ? 'compact' : 'large'}
        onBack={selectionMode ? exitSelectionMode : () => dismissOrHome(router)}
        rightActions={selectionMode ? undefined : [
          {
            icon: 'auto-fix',
            onPress: () => setOrganizeOpen(true),
            accessibilityLabel: im.aiOrganizeTitle,
          },
        ]}
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
              onRefresh={() => {
                void inboxQuery.refetch();
              }}
            />
          }
          ListFooterComponent={inboxQuery.isFetchingNextPage ? <View style={styles.footerLoader}><Text style={{ color: colors.text.tertiary }}>{m.common.loading}</Text></View> : null}
          ListHeaderComponent={
            <WorkspaceSyncStatusCard
              onChanged={invalidateInbox}
              onToast={setSnackMsg}
            />
          }
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

      <AiOrganizeSheet
        visible={organizeOpen}
        suggestions={organizeSuggestions}
        itemsById={itemsById}
        applyingId={applyingSuggestionId}
        onDismiss={() => setOrganizeOpen(false)}
        onApply={(suggestion) => {
          void applyOrganizeSuggestion(suggestion);
        }}
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
  listContent: { paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: 0 },
  itemCard: {
    marginHorizontal: spacing.content,
    height: INBOX_ITEM_HEIGHT,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    overflow: 'hidden',
  },
  itemCardSelected: {
    borderWidth: StyleSheet.hairlineWidth,
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

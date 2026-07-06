import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Snackbar, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { TOAST_DURATION_SHORT } from '../../constants/toast';
import { t, useMessages } from '../../i18n/messages';
import { dismissOrHome, noteDetailRoute, useDismissOnHardwareBack } from '../../lib/navigation';
import { useTheme } from '../../theme';

import { NoteDetailHeader } from '../notes/NoteDetailHeader';
import { NoteViewActionBar, type NoteViewActionBarItem } from '../notes/NoteViewActionBar';
import { NoteTagPickerSheet } from '../notes/NoteTagPickerSheet';
import { NoteEditorBridge, type NoteEditorBridgeHandle } from '../notes/editor/NoteEditorBridge';
import { countNoteCharacters } from '../notes/note-title';
import { getNotePrimaryTag, getTagColors } from '../notes/note-tag-utils';
import { useVoiceCaptureInteraction } from '../notes/use-voice-capture-interaction';
import { DEFAULT_EDITOR_RUNTIME_STATE } from '../notes/editor/editor-contract';
import type {
  EditorCommand,
  EditorCommandInput,
  EditorRuntimeState,
  EditorSelectionContext,
  NoteEditorLabels,
} from '../notes/editor/editor-protocol';
import { useNoteTagsStore } from '../../stores/note-tags-store';
import { useNoteEditSession } from './useNoteEditSession';
import { useNoteEditorAttachments } from './useNoteEditorAttachments';
import { useNotePageActions } from './useNotePageActions';

function firstRouteParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

export function PageScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string | string[] }>();
  const id = firstRouteParam(idParam);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const m = useMessages();
  const pm = m.notesPage;
  const noteTags = useNoteTagsStore((s) => s.tags);
  const addNoteTag = useNoteTagsStore((s) => s.addTag);
  const ensureNoteTags = useNoteTagsStore((s) => s.ensureTags);
  const hydrateNoteTags = useNoteTagsStore((s) => s.hydrate);

  const [snackMsg, setSnackMsg] = useState('');
  const [moreVisible, setMoreVisible] = useState(false);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [editorRuntimeState, setEditorRuntimeState] = useState<EditorRuntimeState>(DEFAULT_EDITOR_RUNTIME_STATE);
  const [editorCommand, setEditorCommand] = useState<EditorCommand | null>(null);
  const [, setSelection] = useState<EditorSelectionContext | null>(null);

  const editorCommandIdRef = useRef(0);
  const editorRef = useRef<NoteEditorBridgeHandle | null>(null);

  useEffect(() => {
    hydrateNoteTags();
  }, [hydrateNoteTags]);

  const handleMissingNote = useCallback(() => {
    router.replace('/notes');
  }, [router]);

  const handleDraftPromoted = useCallback((remoteId: string) => {
    router.replace(noteDetailRoute(remoteId));
  }, [router]);

  const {
    note,
    noteQuery,
    markdown,
    editorMarkdown,
    title,
    tags,
    saveState,
    markdownRef,
    titleRef,
    flushSave,
    updateMarkdown,
    updateTitle,
    updateTags,
    attachmentDisplaySeed,
  } = useNoteEditSession({
    id,
    queryClient,
    setSnackMsg,
    ensureNoteTags,
    messages: {
      missing: pm.missing,
      savedOffline: pm.savedOffline,
      untitledNote: pm.untitledNote,
    },
    onMissingNote: handleMissingNote,
    onDraftPromoted: handleDraftPromoted,
  });

  const {
    attachmentSrcMap,
    handleCreateVoiceAttachment,
    handleRequestAttachment,
  } = useNoteEditorAttachments({
    id,
    setSnackMsg,
    displaySeed: attachmentDisplaySeed,
    messages: {
      actionFailed: pm.actionFailed,
      added: pm.editorAttachmentAdded,
      permissionDenied: pm.editorAttachmentPermissionDenied,
      cameraDenied: pm.editorCameraDenied,
    },
  });

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => () => {
      void flushSave();
    }, [flushSave]),
  );

  const sendEditorCommand = useCallback((next: EditorCommandInput) => {
    editorCommandIdRef.current += 1;
    setEditorCommand({ id: editorCommandIdRef.current, ...next } as EditorCommand);
  }, []);

  const voice = useVoiceCaptureInteraction({
    value: markdownRef.current,
    onChangeText: updateMarkdown,
    onVoiceCapture: (payload) => {
      void (async () => {
        const attachment = await handleCreateVoiceAttachment(payload);
        if (!attachment) return;
        sendEditorCommand({ type: 'insertPreparedAttachment', attachment });
      })();
    },
    disabled: !id || !note,
    enabled: Boolean(id && note),
  });

  const flushEditorToDraft = useCallback(async () => {
    await editorRef.current?.flushMarkdown();
  }, []);

  const handleBack = useCallback(() => {
    Keyboard.dismiss();
    void (async () => {
      await flushEditorToDraft();
      await flushSave();
      dismissOrHome(router);
    })();
  }, [flushEditorToDraft, flushSave, router]);

  useDismissOnHardwareBack(router, { onBack: handleBack });

  const {
    actionLoading,
    handleOpenNoteChat,
    handleShare,
    handleSyncNow,
    handleTogglePinned,
  } = useNotePageActions({
    id,
    note,
    queryClient,
    markdownRef,
    titleRef,
    flushEditorToDraft,
    flushSave,
    setSnackMsg,
    dismissMore: () => setMoreVisible(false),
    messages: {
      actionFailed: pm.actionFailed,
      editorSendToChatPrefix: pm.editorSendToChatPrefix,
      noteChatImagePlaceholder: pm.noteChatImagePlaceholder,
      noteChatTitleLabel: pm.noteChatTitleLabel,
      noteChatVoiceTranscript: pm.noteChatVoiceTranscript,
      pin: pm.pin,
      saved: pm.saved,
      shareNotesCopied: pm.shareNotesCopied,
      shareNotesTitle: pm.shareNotesTitle,
      unpin: pm.unpin,
      untitledNote: pm.untitledNote,
      updated: pm.updated,
    },
  });

  const handleCreateTag = useCallback((raw: string) => addNoteTag(raw), [addNoteTag]);

  const handleSelectPrimaryTag = useCallback((tag: string | null) => {
    const nextTags = tag ? [tag] : [];
    updateTags(nextTags);
    setTagPickerVisible(false);
  }, [updateTags]);

  const labels = useMemo<NoteEditorLabels>(() => ({
    placeholder: pm.editorPlaceholderText,
    apply: m.common.apply,
    image: pm.editorInsertImage,
    link: pm.editorInsertLink,
    undo: pm.editorUndo,
    redo: pm.editorRedo,
    todo: pm.editorBlockTodo,
    linkUrlPlaceholder: pm.editorLinkUrlPlaceholder,
    removeLink: pm.editorRemoveLink,
    imageFromLibrary: pm.editorImageLibrary,
    imageCamera: pm.editorImageCamera,
    imageDocument: pm.editorImageDocument,
    audio: pm.editorInsertAudio,
  }), [m.common.apply, pm]);

  const showLoading = noteQuery.isLoading && !note;
  const showError = noteQuery.isError && !note;
  const showViewActions = Boolean(note && id && !keyboardVisible && !editorFocused);
  const primaryTag = useMemo(() => getNotePrimaryTag({ tags }), [tags]);
  const primaryTagPalette = useMemo(() => getTagColors(primaryTag, noteTags, colors), [colors, noteTags, primaryTag]);
  const wordCount = useMemo(() => countNoteCharacters(markdown), [markdown]);

  const rightActions = useMemo(() => {
    return [
      {
        icon: 'undo',
        label: pm.editorUndo,
        disabled: !editorRuntimeState.canUndo,
        onPress: () => sendEditorCommand({ type: 'undo' }),
      },
      {
        icon: 'redo',
        label: pm.editorRedo,
        disabled: !editorRuntimeState.canRedo,
        onPress: () => sendEditorCommand({ type: 'redo' }),
      },
    ];
  }, [editorRuntimeState.canRedo, editorRuntimeState.canUndo, pm.editorRedo, pm.editorUndo, sendEditorCommand]);

  const viewActionItems = useMemo<NoteViewActionBarItem[]>(() => [
    {
      key: 'share',
      icon: 'share-variant-outline',
      label: pm.viewShare,
      onPress: () => void handleShare(),
    },
    {
      key: 'pin',
      icon: note?.pinned ? 'star' : 'star-outline',
      label: note?.pinned ? pm.unpin : pm.pin,
      active: Boolean(note?.pinned),
      loading: actionLoading === 'pin',
      onPress: () => void handleTogglePinned(),
    },
    {
      key: 'chat',
      icon: 'chat-processing-outline',
      label: pm.openChat,
      loading: actionLoading === 'openChat',
      onPress: () => void handleOpenNoteChat(),
    },
    {
      key: 'more',
      icon: 'dots-grid',
      label: pm.viewMore,
      onPress: () => setMoreVisible(true),
    },
  ], [actionLoading, handleOpenNoteChat, handleShare, handleTogglePinned, note?.pinned, pm.openChat, pm.pin, pm.unpin, pm.viewMore, pm.viewShare]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NoteDetailHeader
        onBack={handleBack}
        backLabel={m.common.back}
        rightActions={note ? rightActions : undefined}
      />

      {showLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent.primary} />
          <Text style={{ color: colors.text.tertiary }}>{m.common.loading}</Text>
        </View>
      ) : showError ? (
        <View style={styles.center}>
          <Icon source="cloud-alert-outline" size={42} color={colors.text.tertiary} />
          <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>
            {noteQuery.error instanceof Error ? noteQuery.error.message : pm.actionFailed}
          </Text>
          <Button mode="contained-tonal" onPress={() => void noteQuery.refetch()}>{m.common.retry}</Button>
        </View>
      ) : note && id ? (
        <View style={styles.editorWrap}>
          <View style={[styles.titleWrap, styles.titleWrapCompact, { borderBottomColor: colors.border.subtle }]}>
            <View style={styles.titleInputFrame}>
              <TextInput
                value={title}
                onChangeText={updateTitle}
                onFocus={() => {
                  setEditorFocused(false);
                }}
                editable
                placeholder={pm.untitledNote}
                placeholderTextColor={colors.text.tertiary}
                accessibilityLabel={pm.noteTitle}
                style={[styles.titleInput, { color: colors.text.primary }]}
              />
            </View>
            <View style={styles.metaRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.categoryChip,
                  { backgroundColor: primaryTagPalette.bg, opacity: pressed ? 0.72 : 1 },
                ]}
                onPress={() => {
                  setTagPickerVisible(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={pm.tagPickerTitle}
              >
                <Icon source="folder-outline" size={14} color={primaryTagPalette.fg} />
                <Text numberOfLines={1} style={[styles.categoryChipText, { color: primaryTagPalette.fg }]}>
                  {primaryTag ?? pm.defaultTag}
                </Text>
                <Icon source="chevron-down" size={14} color={primaryTagPalette.fg} />
              </Pressable>
            </View>
          </View>
          <NoteEditorBridge
            ref={editorRef}
            noteId={id}
            markdown={editorMarkdown}
            attachmentSrcMap={attachmentSrcMap}
            topCommand={editorCommand}
            labels={labels}
            onChangeMarkdown={updateMarkdown}
            onSelectionChange={setSelection}
            onRequestAttachment={handleRequestAttachment}
            onFocusChange={setEditorFocused}
            onRuntimeStateChange={setEditorRuntimeState}
            voiceFeedback={voice.feedback}
            voicePanHandlers={voice.panHandlers}
            voiceActive={voice.active}
            voiceDisabled={!id || !note || voice.transcribing}
          />
        </View>
      ) : null}

      {showViewActions ? (
        <View style={styles.wordCountWrap} pointerEvents="none">
          <Text style={[styles.wordCountText, { color: colors.text.tertiary }]}>
            {t(pm.charCount, { count: wordCount })}
          </Text>
        </View>
      ) : null}

      {saveState === 'failed' ? (
        <Pressable
          style={[
            styles.retryBar,
            showViewActions ? styles.retryBarAboveActions : null,
            { backgroundColor: colors.surface.panel, borderColor: colors.border.default },
          ]}
          onPress={() => void flushSave()}
          accessibilityRole="button"
          accessibilityLabel={pm.saveFailed}
        >
          <Icon source="cloud-alert-outline" size={18} color={colors.semantic.error} />
          <Text style={[styles.retryText, { color: colors.text.primary }]}>{pm.saveFailed}</Text>
        </Pressable>
      ) : null}

      {showViewActions ? (
        <NoteViewActionBar
          items={viewActionItems}
        />
      ) : null}

      <BottomSheetModal
        visible={moreVisible}
        onDismiss={() => setMoreVisible(false)}
        title={pm.viewMore}
        maxHeight="40%"
      >
        <View style={styles.moreActions}>
          <Pressable
            style={({ pressed }) => [styles.moreAction, pressed && styles.moreActionPressed]}
            onPress={() => void handleSyncNow()}
            accessibilityRole="button"
            accessibilityLabel={pm.syncNow}
          >
            <Icon source="cloud-sync-outline" size={22} color={colors.text.secondary} />
            <Text style={[styles.moreActionLabel, { color: colors.text.primary }]}>{pm.syncNow}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.moreAction, pressed && styles.moreActionPressed]}
            onPress={() => void handleShare()}
            accessibilityRole="button"
            accessibilityLabel={pm.viewShare}
          >
            <Icon source="share-variant-outline" size={22} color={colors.text.secondary} />
            <Text style={[styles.moreActionLabel, { color: colors.text.primary }]}>{pm.viewShare}</Text>
          </Pressable>
        </View>
      </BottomSheetModal>

      <NoteTagPickerSheet
        visible={tagPickerVisible}
        tags={noteTags}
        selectedTag={primaryTag}
        onSelect={handleSelectPrimaryTag}
        onCreateTag={handleCreateTag}
        onDismiss={() => setTagPickerVisible(false)}
      />

      <Snackbar
        visible={Boolean(snackMsg)}
        duration={TOAST_DURATION_SHORT}
        onDismiss={() => setSnackMsg('')}
      >
        {snackMsg}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  editorWrap: {
    flex: 1,
    minHeight: 0,
  },
  titleWrap: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleWrapCompact: {
    paddingBottom: 4,
  },
  titleInputFrame: {
    position: 'relative',
  },
  titleInput: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '700',
    paddingVertical: 4,
  },
  titleText: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '700',
    paddingVertical: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
  },
  categoryChip: {
    minHeight: 30,
    maxWidth: '76%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 15,
    paddingHorizontal: 10,
  },
  categoryChipText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  wordCountWrap: {
    position: 'absolute',
    right: 22,
    bottom: 94,
    zIndex: 12,
  },
  wordCountText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
  },
  retryBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  retryBarAboveActions: {
    bottom: 104,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '600',
  },
  moreActions: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 8,
  },
  moreAction: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  moreActionPressed: {
    opacity: 0.72,
  },
  moreActionLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
});

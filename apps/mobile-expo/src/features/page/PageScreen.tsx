import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Snackbar, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { TOAST_DURATION_SHORT } from '../../constants/toast';
import { t, useMessages } from '../../i18n/messages';
import { dismissOrHome, useDismissOnHardwareBack } from '../../lib/navigation';
import { useTheme } from '../../theme';

import { NoteDetailHeader } from '../notes/NoteDetailHeader';
import { NoteViewActionBar, type NoteViewActionBarItem } from '../notes/NoteViewActionBar';
import { NoteTagPickerSheet } from '../notes/NoteTagPickerSheet';
import {
  NoteEditorBridge,
  type NoteEditorAiAction,
  type NoteEditorBridgeHandle,
} from '../notes/editor/NoteEditorBridge';
import { countNoteCharacters } from '../notes/note-title';
import { useVoiceCaptureInteraction } from '../notes/use-voice-capture-interaction';
import { applyMarkdownPatchResult } from '../notes/markdown/markdown-patch';
import type {
  EditorCommand,
  EditorCommandInput,
  NoteEditorLabels,
} from '../notes/editor/editor-protocol';
import { useNoteTagsStore } from '../../stores/note-tags-store';
import { requestNoteAiEdit } from '../../query/notes';
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
  const navigation = useNavigation();
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
  const [editorCommand, setEditorCommand] = useState<EditorCommand | null>(null);
  const [aiLoadingKey, setAiLoadingKey] = useState<string | null>(null);

  const editorCommandIdRef = useRef(0);
  const editorRef = useRef<NoteEditorBridgeHandle | null>(null);
  const allowNextRemoveRef = useRef(false);
  const savingBeforeLeaveRef = useRef(false);

  useEffect(() => {
    hydrateNoteTags();
  }, [hydrateNoteTags]);

  const handleMissingNote = useCallback(() => {
    router.replace('/notes');
  }, [router]);

  const {
    note,
    noteQuery,
    markdown,
    title,
    tags,
    saveState,
    editorReady,
    markdownRef,
    titleRef,
    flushSave,
    applyDraft,
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
    const draft = await editorRef.current?.flushDraft();
    if (draft) applyDraft(draft);
  }, [applyDraft]);

  const saveEditorBeforeLeave = useCallback(async () => {
    await flushEditorToDraft();
    await flushSave();
  }, [flushEditorToDraft, flushSave]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      void saveEditorBeforeLeave();
    });
    return () => sub.remove();
  }, [saveEditorBeforeLeave]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (allowNextRemoveRef.current) {
        allowNextRemoveRef.current = false;
        return;
      }
      if (!id || !note) return;
      event.preventDefault();
      if (savingBeforeLeaveRef.current) return;
      savingBeforeLeaveRef.current = true;
      Keyboard.dismiss();
      void (async () => {
        try {
          await saveEditorBeforeLeave();
          allowNextRemoveRef.current = true;
          navigation.dispatch(event.data.action);
        } finally {
          savingBeforeLeaveRef.current = false;
        }
      })();
    });
    return unsubscribe;
  }, [id, navigation, note, saveEditorBeforeLeave]);

  const handleBack = useCallback(() => {
    if (savingBeforeLeaveRef.current) return;
    savingBeforeLeaveRef.current = true;
    Keyboard.dismiss();
    void (async () => {
      try {
        await saveEditorBeforeLeave();
        allowNextRemoveRef.current = true;
        dismissOrHome(router);
      } finally {
        savingBeforeLeaveRef.current = false;
      }
    })();
  }, [router, saveEditorBeforeLeave]);

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
    textStyle: pm.editorTextStyle,
    bold: pm.editorBold,
    italic: pm.editorItalic,
    heading: pm.editorHeading,
    bulletList: pm.editorBulletList,
    image: pm.editorInsertImage,
    link: pm.editorInsertLink,
    ai: pm.editorAI,
    quote: pm.editorQuote,
    code: pm.editorCode,
    divider: pm.editorDivider,
    undo: pm.editorUndo,
    redo: pm.editorRedo,
    todo: pm.editorBlockTodo,
    linkUrlPlaceholder: pm.editorLinkUrlPlaceholder,
    removeLink: pm.editorRemoveLink,
    more: pm.viewMore,
    imageFromLibrary: pm.editorImageLibrary,
    imageCamera: pm.editorImageCamera,
    imageDocument: pm.editorImageDocument,
    audio: pm.editorInsertAudio,
  }), [m.common.apply, pm]);

  const aiActions = useMemo<NoteEditorAiAction[]>(() => [
    {
      key: 'continue',
      label: pm.editorAIContinue,
      instruction: pm.editorAIContinueInstruction,
    },
    {
      key: 'rewrite',
      label: pm.editorAIRewrite,
      instruction: pm.editorAIRewriteInstruction,
    },
    {
      key: 'summarize',
      label: pm.editorAISummarize,
      instruction: pm.editorAISummarizeInstruction,
    },
    {
      key: 'fixGrammar',
      label: pm.editorAIFixGrammar,
      instruction: pm.editorAIFixGrammarInstruction,
    },
    {
      key: 'improve',
      label: pm.editorAIImprove,
      instruction: pm.editorAIImproveInstruction,
    },
  ], [pm]);

  const handleRequestAiAction = useCallback(async (action: NoteEditorAiAction) => {
    if (!id || !note || aiLoadingKey) return;
    setAiLoadingKey(action.key);
    try {
      await flushEditorToDraft();
      const currentMarkdown = markdownRef.current;
      const result = await requestNoteAiEdit(id, {
        instruction: action.instruction,
        markdown: currentMarkdown,
        context: {
          type: 'note',
          range: { start: 0, end: currentMarkdown.length },
          markdown: currentMarkdown,
        },
      });
      const patchResult = applyMarkdownPatchResult(currentMarkdown, result.patch.operations);
      const titleChanged = patchResult.metadata.title !== undefined && patchResult.metadata.title !== titleRef.current;
      const tagsChanged = patchResult.metadata.tags !== undefined;
      if (patchResult.markdown === currentMarkdown && !titleChanged && !tagsChanged) {
        setSnackMsg(pm.editorAINoChanges);
        return;
      }

      const summary = result.patch.summary || result.message || action.label;
      Alert.alert(pm.editorAIApplyTitle, summary, [
        { text: m.common.cancel, style: 'cancel' },
        {
          text: m.common.apply,
          onPress: () => {
            if (patchResult.markdown !== currentMarkdown) {
              updateMarkdown(patchResult.markdown);
            }
            if (patchResult.metadata.title !== undefined) {
              updateTitle(patchResult.metadata.title ?? '');
            }
            if (patchResult.metadata.tags !== undefined) {
              updateTags(patchResult.metadata.tags);
            }
            setSnackMsg(pm.editorAIApplied);
          },
        },
      ]);
    } catch (error) {
      setSnackMsg(error instanceof Error ? error.message : pm.actionFailed);
    } finally {
      setAiLoadingKey(null);
    }
  }, [
    aiLoadingKey,
    flushEditorToDraft,
    id,
    m.common.apply,
    m.common.cancel,
    markdownRef,
    note,
    pm.actionFailed,
    pm.editorAIApplyTitle,
    pm.editorAIApplied,
    pm.editorAINoChanges,
    titleRef,
    updateMarkdown,
    updateTags,
    updateTitle,
  ]);

  const showLoading = noteQuery.isLoading && !note;
  const showError = noteQuery.isError && !note;
  const showMissing = !showLoading && !showError && (!id || !note);
  const showViewActions = Boolean(note && id && !keyboardVisible);
  const wordCount = useMemo(() => countNoteCharacters(markdown), [markdown]);

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
      ) : showMissing ? (
        <View style={styles.center}>
          <Icon source="note-alert-outline" size={42} color={colors.text.tertiary} />
          <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>
            {pm.missing}
          </Text>
          <Button mode="contained-tonal" onPress={handleBack}>{m.common.back}</Button>
        </View>
      ) : note && id ? (
        <View style={styles.editorWrap}>
          {editorReady ? (
            <NoteEditorBridge
              key={id}
              ref={editorRef}
              noteId={id}
              title={title}
              titlePlaceholder={pm.untitledNote}
              markdown={markdown}
              mode="edit"
              attachmentSrcMap={attachmentSrcMap}
              topCommand={editorCommand}
              labels={labels}
              onChangeTitle={updateTitle}
              onChangeMarkdown={updateMarkdown}
              onRequestAttachment={handleRequestAttachment}
              aiActions={aiActions}
              aiLoadingKey={aiLoadingKey}
              onRequestAiAction={handleRequestAiAction}
              voiceFeedback={voice.feedback}
              voicePanHandlers={voice.panHandlers}
              voicePressHandler={voice.onPress}
              voiceActive={voice.active}
              voiceDisabled={!id || !note || voice.transcribing}
            />
          ) : (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent.primary} />
            </View>
          )}
        </View>
      ) : null}

      {showViewActions ? (
        <View style={styles.wordCountWrap} pointerEvents="none">
          <Text style={[styles.wordCountText, { color: colors.text.tertiary }]}>
            {t(pm.charCount, { count: wordCount })}
          </Text>
        </View>
      ) : null}

      {saveState === 'failed' || saveState === 'pending' ? (
        <Pressable
          style={[
            styles.retryBar,
            showViewActions ? styles.retryBarAboveActions : null,
            { backgroundColor: colors.surface.panel, borderColor: colors.border.default },
          ]}
          onPress={() => {
            if (saveState === 'pending') void handleSyncNow();
            else void flushSave();
          }}
          accessibilityRole="button"
          accessibilityLabel={saveState === 'pending' ? pm.syncPending : pm.saveFailed}
        >
          <Icon
            source={saveState === 'pending' ? 'cloud-clock-outline' : 'cloud-alert-outline'}
            size={18}
            color={saveState === 'pending' ? colors.accent.primary : colors.semantic.error}
          />
          <Text style={[styles.retryText, { color: colors.text.primary }]}>
            {saveState === 'pending' ? pm.syncPending : pm.saveFailed}
          </Text>
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
            onPress={() => {
              setMoreVisible(false);
              setTagPickerVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={pm.tagPickerTitle}
          >
            <Icon source="folder-outline" size={22} color={colors.text.secondary} />
            <Text style={[styles.moreActionLabel, { color: colors.text.primary }]}>{pm.tagPickerTitle}</Text>
          </Pressable>
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
        selectedTag={tags?.[0] ?? null}
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
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 8,
  },
  titleWrapCompact: {
    paddingBottom: 4,
  },
  titleInputFrame: {
    position: 'relative',
  },
  titleInput: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    paddingVertical: 2,
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

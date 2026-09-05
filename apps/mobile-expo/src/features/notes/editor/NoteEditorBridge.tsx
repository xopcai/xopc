import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { InteractionManager, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '../../../components/BottomSheetModal';
import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding, radii, spacing, useTheme } from '../../../theme';
import NoteEditorDomAdapter, { type NoteEditorAdapterCommand } from '../web-editor/NoteEditorDomAdapter';
import { DEFAULT_EDITOR_RUNTIME_STATE } from './editor-contract';
import {
  isLikelyEditorLinkUrl,
  normalizeEditorLinkUrl,
  sanitizeEditorLinkText,
} from './editor-link';
import type {
  EditorAttachmentPickSource,
  EditorCommand,
  EditorCommandInput,
  EditorAttachmentPickResult,
  NoteEditorHandle,
  NoteEditorDraft,
  EditorRuntimeState,
  EditorSelectionContext,
  NoteEditorLabels,
  NoteEditorMode,
  NoteEditorTheme,
} from './editor-protocol';

type ToolbarAction = {
  key: string;
  label: string;
  icon: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export type NoteEditorAiAction = {
  key: string;
  label: string;
  instruction: string;
};

export type NoteEditorBridgeHandle = NoteEditorHandle;

const TOOL_BUTTON_SIZE = 44;
const EDITOR_FLUSH_TIMEOUT_MS = 1500;

type PendingDraftFlush = {
  resolve: (draft: NoteEditorDraft) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type EditorSheet = 'image' | 'link' | 'heading' | 'ai' | 'more';

type SheetPresentation = {
  active: EditorSheet | null;
  pending: EditorSheet | null;
};

function afterNativeInteractions(): Promise<void> {
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
}

function waitForNativePresentation(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function dismissKeyboardAndWait(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      subscription.remove();
      clearTimeout(timeout);
      resolve();
    };
    const subscription = Keyboard.addListener('keyboardDidHide', finish);
    const timeout = setTimeout(finish, 180);
    Keyboard.dismiss();
  });
}

function useKeyboardBottomInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      const height = event.endCoordinates.height;
      setInset(Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setInset(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return inset;
}

function sameEditorState(a: EditorRuntimeState, b: EditorRuntimeState): boolean {
  return a.ready === b.ready
    && a.focused === b.focused
    && a.focusTarget === b.focusTarget
    && a.emptySelection === b.emptySelection
    && a.canUndo === b.canUndo
    && a.canRedo === b.canRedo
    && a.bold === b.bold
    && a.italic === b.italic
    && a.headingLevel === b.headingLevel
    && a.bulletList === b.bulletList
    && a.taskList === b.taskList
    && a.blockquote === b.blockquote
    && a.codeBlock === b.codeBlock
    && a.link === b.link
    && a.image === b.image;
}

export interface NoteEditorBridgeProps {
  noteId: string;
  title: string;
  titlePlaceholder: string;
  markdown: string;
  mode: NoteEditorMode;
  attachmentSrcMap?: Record<string, string>;
  topCommand?: EditorCommand | null;
  onTopCommandConsumed?: (id: number) => void;
  labels: NoteEditorLabels;
  onChangeTitle: (title: string) => void;
  onChangeMarkdown: (markdown: string) => void;
  onSelectionChange?: (context: EditorSelectionContext) => void;
  onRequestAttachment: (source: EditorAttachmentPickSource) => Promise<EditorAttachmentPickResult>;
  onRequestEdit?: () => void;
  onRuntimeStateChange?: (state: EditorRuntimeState) => void;
  aiActions?: NoteEditorAiAction[];
  aiLoadingKey?: string | null;
  onRequestAiAction?: (action: NoteEditorAiAction) => void;
}

export const NoteEditorBridge = memo(forwardRef<NoteEditorBridgeHandle, NoteEditorBridgeProps>(function NoteEditorBridge({
  noteId,
  title,
  titlePlaceholder,
  markdown,
  mode,
  attachmentSrcMap,
  topCommand,
  onTopCommandConsumed,
  labels,
  onChangeTitle,
  onChangeMarkdown,
  onSelectionChange,
  onRequestAttachment,
  onRequestEdit,
  onRuntimeStateChange,
  aiActions = [],
  aiLoadingKey,
  onRequestAiAction,
}, ref) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardBottomInset = useKeyboardBottomInset();
  const linkUrlInputRef = useRef<TextInput | null>(null);
  const commandIdRef = useRef(0);
  const flushRequestIdRef = useRef(0);
  const pendingFlushesRef = useRef(new Map<number, PendingDraftFlush>());
  const latestMarkdownRef = useRef(markdown);
  const latestTitleRef = useRef(title);
  const [command, setCommand] = useState<NoteEditorAdapterCommand | null>(null);
  const [editorState, setEditorState] = useState<EditorRuntimeState>(DEFAULT_EDITOR_RUNTIME_STATE);
  const editorStateRef = useRef<EditorRuntimeState>(DEFAULT_EDITOR_RUNTIME_STATE);
  const pendingEditorStateRef = useRef<EditorRuntimeState | null>(null);
  const editorStateFrameRef = useRef<number | null>(null);
  const [sheetPresentation, setSheetPresentation] = useState<SheetPresentation>({ active: null, pending: null });
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const canApplyLink = isLikelyEditorLinkUrl(normalizeEditorLinkUrl(linkUrl));
  const [nativeActionActive, setNativeActionActive] = useState(false);
  const sheetRequestIdRef = useRef(0);
  const activeSheet = sheetPresentation.active;
  const presentation = activeSheet ? 'open' : (sheetPresentation.pending || nativeActionActive) ? 'opening' : 'none';
  const nativeModalVisible = presentation !== 'none';
  const keyboardOverlayInset = keyboardBottomInset;
  const toolbarBottomPadding = keyboardBottomInset > 0 ? floatingBottomPadding(0) : floatingBottomPadding(insets.bottom);
  const editorBottomInset = keyboardOverlayInset
    + FLOATING_BOTTOM_OFFSET
    + toolbarBottomPadding
    + TOOL_BUTTON_SIZE
    + (spacing.xs * 2)
    + spacing.lg;
  const editorTheme = useMemo<NoteEditorTheme>(() => ({
    background: colors.surface.base,
    panel: colors.surface.panel,
    input: colors.surface.input,
    text: colors.text.primary,
    textSecondary: colors.text.secondary,
    textTertiary: colors.text.tertiary,
    border: colors.border.default,
    accent: colors.accent.primary,
    accentSoft: colors.accent.selectionBg,
    danger: colors.semantic.error,
  }), [colors]);
  const domProps = useMemo(() => ({
    scrollEnabled: true,
    containerStyle: styles.domContainer,
    style: styles.dom,
  }), []);

  const handleChange = useCallback(async (nextMarkdown: string) => {
    latestMarkdownRef.current = nextMarkdown;
    onChangeMarkdown(nextMarkdown);
  }, [onChangeMarkdown]);

  const handleTitleChange = useCallback(async (nextTitle: string) => {
    latestTitleRef.current = nextTitle;
    onChangeTitle(nextTitle);
  }, [onChangeTitle]);

  const handleSelectionChange = useMemo(() => onSelectionChange ? async (context: EditorSelectionContext) => {
    onSelectionChange(context);
  } : undefined, [onSelectionChange]);

  const handleStateChange = useCallback((state: EditorRuntimeState) => {
    if (
      sameEditorState(editorStateRef.current, state)
      || (pendingEditorStateRef.current && sameEditorState(pendingEditorStateRef.current, state))
    ) {
      return;
    }
    pendingEditorStateRef.current = state;
    if (editorStateFrameRef.current != null) return;
    editorStateFrameRef.current = requestAnimationFrame(() => {
      editorStateFrameRef.current = null;
      const next = pendingEditorStateRef.current;
      pendingEditorStateRef.current = null;
      if (!next || sameEditorState(editorStateRef.current, next)) return;
      editorStateRef.current = next;
      setEditorState(next);
      onRuntimeStateChange?.(next);
    });
  }, [onRuntimeStateChange]);

  useEffect(() => () => {
    if (editorStateFrameRef.current != null) {
      cancelAnimationFrame(editorStateFrameRef.current);
      editorStateFrameRef.current = null;
    }
    pendingFlushesRef.current.forEach(({ resolve, timeout }) => {
      clearTimeout(timeout);
      resolve({ title: latestTitleRef.current, markdown: latestMarkdownRef.current });
    });
    pendingFlushesRef.current.clear();
  }, []);

  useEffect(() => {
    latestMarkdownRef.current = markdown;
  }, [markdown]);

  useEffect(() => {
    latestTitleRef.current = title;
  }, [title]);

  const dispatch = useCallback((next: EditorCommandInput) => {
    commandIdRef.current += 1;
    setCommand({ id: commandIdRef.current, ...next } as EditorCommand);
  }, []);

  useEffect(() => {
    if (!topCommand) return;
    commandIdRef.current += 1;
    setCommand({ ...topCommand, id: commandIdRef.current } as EditorCommand);
    onTopCommandConsumed?.(topCommand.id);
  }, [onTopCommandConsumed, topCommand]);

  const handleFlushDraft = useCallback(async (requestId: number, nextDraft: NoteEditorDraft) => {
    latestTitleRef.current = nextDraft.title;
    latestMarkdownRef.current = nextDraft.markdown;
    const pending = pendingFlushesRef.current.get(requestId);
    if (!pending) return;
    pendingFlushesRef.current.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve(nextDraft);
  }, []);

  const flushDraft = useCallback(() => new Promise<NoteEditorDraft>((resolve) => {
    if (!editorStateRef.current.ready) {
      resolve({ title: latestTitleRef.current, markdown: latestMarkdownRef.current });
      return;
    }
    flushRequestIdRef.current += 1;
    commandIdRef.current += 1;
    const requestId = flushRequestIdRef.current;
    const timeout = setTimeout(() => {
      const pending = pendingFlushesRef.current.get(requestId);
      if (!pending) return;
      pendingFlushesRef.current.delete(requestId);
      pending.resolve({ title: latestTitleRef.current, markdown: latestMarkdownRef.current });
    }, EDITOR_FLUSH_TIMEOUT_MS);
    pendingFlushesRef.current.set(requestId, { resolve, timeout });
    setCommand({
      id: commandIdRef.current,
      type: 'requestDraftFlush',
      requestId,
    });
  }), []);

  useImperativeHandle(ref, () => ({
    flushDraft,
    focus: (target = 'body', position) => {
      dispatch({ type: 'focus', target, position });
    },
  }), [dispatch, flushDraft]);

  const openEditorSheet = useCallback((sheet: EditorSheet) => {
    sheetRequestIdRef.current += 1;
    const requestId = sheetRequestIdRef.current;
    setSheetPresentation({ active: null, pending: sheet });
    dispatch({ type: 'blur' });
    void (async () => {
      await dismissKeyboardAndWait();
      await afterNativeInteractions();
      if (sheetRequestIdRef.current !== requestId) return;
      setSheetPresentation({ active: sheet, pending: null });
    })();
  }, [dispatch]);

  const closeEditorSheet = useCallback(() => {
    sheetRequestIdRef.current += 1;
    setSheetPresentation({ active: null, pending: null });
  }, []);

  const runAfterEditorSheetClose = useCallback((action: () => void) => {
    closeEditorSheet();
    void afterNativeInteractions().then(action);
  }, [closeEditorSheet]);

  const openLinkSheet = useCallback(() => {
    setLinkTitle('');
    setLinkUrl('');
    openEditorSheet('link');
  }, [openEditorSheet]);

  useEffect(() => {
    if (activeSheet !== 'link') return;
    const timer = setTimeout(() => {
      linkUrlInputRef.current?.focus();
    }, 80);
    return () => clearTimeout(timer);
  }, [activeSheet]);

  const handleApplyLink = useCallback(() => {
    const normalizedUrl = normalizeEditorLinkUrl(linkUrl);
    if (!isLikelyEditorLinkUrl(normalizedUrl)) return;
    const normalizedTitle = sanitizeEditorLinkText(linkTitle).trim();
    runAfterEditorSheetClose(() => {
      dispatch({ type: 'setLink', title: normalizedTitle, url: normalizedUrl });
    });
  }, [dispatch, linkTitle, linkUrl, runAfterEditorSheetClose]);

  const handleRemoveLink = useCallback(() => {
    runAfterEditorSheetClose(() => {
      dispatch({ type: 'removeLink' });
    });
  }, [dispatch, runAfterEditorSheetClose]);

  const insertPickedAttachment = useCallback((attachment: NonNullable<EditorAttachmentPickResult>) => {
    dispatch({ type: 'insertPreparedAttachment', attachment });
  }, [dispatch]);

  const pickAndInsertAttachment = useCallback((source: EditorAttachmentPickSource) => {
    setNativeActionActive(true);
    closeEditorSheet();
    void (async () => {
      try {
        await afterNativeInteractions();
        await waitForNativePresentation(120);
        await afterNativeInteractions();
        const attachment = await onRequestAttachment(source);
        if (attachment) insertPickedAttachment(attachment);
      } finally {
        setNativeActionActive(false);
      }
    })();
  }, [closeEditorSheet, insertPickedAttachment, onRequestAttachment]);

  const handleInsertImageFromLibrary = useCallback(() => {
    pickAndInsertAttachment('photos');
  }, [pickAndInsertAttachment]);

  const handleInsertImageFromCamera = useCallback(() => {
    pickAndInsertAttachment('camera');
  }, [pickAndInsertAttachment]);

  const handleInsertDocument = useCallback(() => {
    pickAndInsertAttachment('document');
  }, [pickAndInsertAttachment]);

  const actions = useMemo<ToolbarAction[]>(() => {
    return [
      {
        key: 'todo',
        label: labels.todo,
        icon: 'checkbox-marked-outline',
        active: editorState.taskList,
        onPress: () => dispatch({ type: 'toggleTaskList' }),
      },
      {
        key: 'attachment',
        label: labels.image,
        icon: 'paperclip',
        active: editorState.image,
        onPress: () => openEditorSheet('image'),
      },
      {
        key: 'format',
        label: labels.textStyle,
        icon: 'format-letter-case',
        active: editorState.headingLevel > 0 || editorState.blockquote || editorState.codeBlock,
        onPress: () => openEditorSheet('heading'),
      },
      {
        key: 'more',
        label: labels.more,
        icon: 'dots-horizontal-circle-outline',
        onPress: () => openEditorSheet('more'),
      },
    ];
  }, [
    dispatch,
    editorState.blockquote,
    editorState.codeBlock,
    editorState.headingLevel,
    editorState.image,
    editorState.taskList,
    labels.image,
    labels.more,
    labels.textStyle,
    labels.todo,
    openEditorSheet,
  ]);
  const showEditorToolbar = (
    mode === 'edit'
    &&
    editorState.focused
    && editorState.focusTarget === 'body'
    && !nativeModalVisible
  );

  return (
    <View style={styles.container}>
      <NoteEditorDomAdapter
        noteId={noteId}
        initialTitle={title}
        initialMarkdown={markdown}
        titlePlaceholder={titlePlaceholder}
        attachmentSrcMap={attachmentSrcMap}
        editable={mode === 'edit'}
        theme={editorTheme}
        labels={labels}
        command={command}
        bottomInset={editorBottomInset}
        onChangeTitle={handleTitleChange}
        onChangeMarkdown={handleChange}
        onSelectionChange={handleSelectionChange}
        onStateChange={handleStateChange}
        onRequestEdit={onRequestEdit}
        onRequestAttachment={onRequestAttachment}
        onFlushDraft={handleFlushDraft}
        dom={domProps}
      />
      {showEditorToolbar ? (
        <View
          style={[
            styles.toolbarDock,
            {
              backgroundColor: colors.surface.base,
              bottom: keyboardOverlayInset + FLOATING_BOTTOM_OFFSET,
              paddingBottom: toolbarBottomPadding,
            },
          ]}
        >
          <EditorToolbar
            actions={actions}
            isDark={isDark}
            colors={colors}
          />
        </View>
      ) : null}
      <BottomSheetModal
        visible={activeSheet === 'image'}
        onDismiss={closeEditorSheet}
        title={labels.image}
        maxHeight="44%"
      >
        <View style={styles.imageMenu}>
          <ImageSourceRow
            label={labels.imageFromLibrary}
            icon="image-multiple-outline"
            onPress={handleInsertImageFromLibrary}
          />
          <ImageSourceRow label={labels.imageCamera} icon="camera-outline" onPress={handleInsertImageFromCamera} />
          <ImageSourceRow label={labels.imageDocument} icon="file-document-outline" onPress={handleInsertDocument} />
        </View>
      </BottomSheetModal>
      <BottomSheetModal
        visible={activeSheet === 'heading'}
        onDismiss={closeEditorSheet}
        title={labels.textStyle}
        maxHeight="52%"
        scroll
      >
        <View style={styles.imageMenu}>
          {([
            { level: 1, label: 'H1' },
            { level: 2, label: 'H2' },
            { level: 3, label: 'H3' },
            { level: 4, label: 'H4' },
            { level: 0, label: labels.textStyle },
          ] as const).map((item) => (
            <ImageSourceRow
              key={item.level}
              label={item.label}
              icon={item.level === 0 ? 'format-paragraph' : `format-header-${item.level}`}
              onPress={() => {
                closeEditorSheet();
                dispatch({ type: 'setHeading', level: item.level });
              }}
            />
          ))}
          <ImageSourceRow
            label={labels.quote}
            icon="format-quote-close"
            onPress={() => {
              closeEditorSheet();
              dispatch({ type: 'toggleBlockquote' });
            }}
          />
          <ImageSourceRow
            label={labels.code}
            icon="code-tags"
            onPress={() => {
              closeEditorSheet();
              dispatch({ type: 'toggleCodeBlock' });
            }}
          />
          <ImageSourceRow
            label={labels.divider}
            icon="minus"
            onPress={() => {
              closeEditorSheet();
              dispatch({ type: 'insertDivider' });
            }}
          />
        </View>
      </BottomSheetModal>
      <BottomSheetModal
        visible={activeSheet === 'ai'}
        onDismiss={closeEditorSheet}
        title={labels.ai}
        maxHeight="52%"
      >
        <View style={styles.imageMenu}>
          {aiActions.map((action) => (
            <ImageSourceRow
              key={action.key}
              label={action.label}
              icon="sparkles"
              disabled={Boolean(aiLoadingKey)}
              suffix={aiLoadingKey === action.key ? '…' : undefined}
              onPress={() => {
                closeEditorSheet();
                onRequestAiAction?.(action);
              }}
            />
          ))}
        </View>
      </BottomSheetModal>
      <BottomSheetModal
        visible={activeSheet === 'more'}
        onDismiss={closeEditorSheet}
        title={labels.more}
        maxHeight="58%"
        scroll
      >
        <View style={styles.imageMenu}>
          <ImageSourceRow
            label={labels.bulletList}
            icon="format-list-bulleted"
            onPress={() => {
              closeEditorSheet();
              dispatch({ type: 'toggleBulletList' });
            }}
          />
          <ImageSourceRow
            label={labels.link}
            icon="link-variant"
            onPress={() => {
              closeEditorSheet();
              void afterNativeInteractions().then(openLinkSheet);
            }}
          />
          <ImageSourceRow
            label={labels.undo}
            icon="undo"
            disabled={!editorState.canUndo}
            onPress={() => {
              closeEditorSheet();
              dispatch({ type: 'undo' });
            }}
          />
          <ImageSourceRow
            label={labels.redo}
            icon="redo"
            disabled={!editorState.canRedo}
            onPress={() => {
              closeEditorSheet();
              dispatch({ type: 'redo' });
            }}
          />
          {onRequestAiAction && aiActions.length > 0 ? (
            <ImageSourceRow
              label={labels.ai}
              icon="creation-outline"
              disabled={Boolean(aiLoadingKey)}
              onPress={() => {
                closeEditorSheet();
                void afterNativeInteractions().then(() => openEditorSheet('ai'));
              }}
            />
          ) : null}
        </View>
      </BottomSheetModal>
      <BottomSheetModal
        visible={activeSheet === 'link'}
        onDismiss={closeEditorSheet}
        title={labels.link}
        maxHeight="52%"
        keyboardAvoiding
      >
        <View style={styles.linkSheet}>
          <TextInput
            style={[
              styles.linkInput,
              {
                backgroundColor: colors.surface.input,
                borderColor: colors.border.default,
                color: colors.text.primary,
              },
            ]}
            placeholder={labels.link}
            placeholderTextColor={colors.text.tertiary}
            value={linkTitle}
            onChangeText={setLinkTitle}
            autoCapitalize="sentences"
            autoCorrect
          />
          <TextInput
            ref={linkUrlInputRef}
            style={[
              styles.linkInput,
              {
                backgroundColor: colors.surface.input,
                borderColor: colors.border.default,
                color: colors.text.primary,
              },
            ]}
            placeholder={labels.linkUrlPlaceholder}
            placeholderTextColor={colors.text.tertiary}
            value={linkUrl}
            onChangeText={setLinkUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <View style={styles.linkActions}>
            <Pressable
              style={({ pressed }) => [
                styles.linkAction,
                {
                  backgroundColor: colors.surface.input,
                  borderColor: colors.border.default,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
              onPress={handleRemoveLink}
              accessibilityRole="button"
              accessibilityLabel={labels.removeLink}
            >
              <Text style={[styles.linkActionText, { color: colors.text.secondary }]}>{labels.removeLink}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.linkAction,
                {
                  backgroundColor: colors.accent.primary,
                  borderColor: colors.accent.primary,
                  opacity: !canApplyLink ? 0.42 : pressed ? 0.72 : 1,
                },
              ]}
              onPress={handleApplyLink}
              disabled={!canApplyLink}
              accessibilityRole="button"
              accessibilityLabel={labels.apply}
            >
              <Text style={[styles.linkActionText, { color: colors.accent.onPrimary }]}>{labels.apply}</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheetModal>
    </View>
  );
}));

function EditorToolbar({
  actions,
  isDark,
  colors,
}: {
  actions: ToolbarAction[];
  isDark: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = (actions.length * TOOL_BUTTON_SIZE)
    + (Math.max(actions.length - 1, 0) * spacing.sm)
    + (spacing.sm * 2);
  const maxWidth = Math.max(TOOL_BUTTON_SIZE + (spacing.sm * 2), windowWidth - (spacing.md * 2));
  const toolbarWidth = Math.min(contentWidth, maxWidth);

  return (
    <View
      style={[
        styles.toolbar,
        {
          width: toolbarWidth,
          backgroundColor: isDark ? colors.surface.panel : colors.surface.base,
          borderColor: colors.border.default,
          shadowColor: colors.text.primary,
        },
      ]}
    >
      <ScrollView
        horizontal
        style={styles.toolbarScroll}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbarContent}
      >
        {actions.map((action) => {
          const selected = action.active;
          return (
            <Pressable
              key={action.key}
              style={({ pressed }) => [
                styles.toolButton,
                {
                  backgroundColor: selected ? colors.accent.selectionBg : colors.surface.input,
                  borderColor: selected ? colors.accent.primary : colors.border.default,
                  opacity: action.disabled ? 0.42 : pressed ? 0.68 : 1,
                },
              ]}
              onPress={action.onPress}
              disabled={action.disabled}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              hitSlop={4}
            >
              <Icon
                source={action.icon}
                size={19}
                color={selected ? colors.accent.primary : colors.text.secondary}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ImageSourceRow({
  label,
  icon,
  disabled,
  suffix,
  onPress,
}: {
  label: string;
  icon: string;
  disabled?: boolean;
  suffix?: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.imageMenuRow,
        {
          backgroundColor: pressed && !disabled ? colors.surface.hover : 'transparent',
          opacity: disabled ? 0.42 : 1,
        },
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Icon source={icon} size={22} color={colors.text.secondary} />
      <Text style={[styles.imageMenuLabel, { color: colors.text.primary }]}>{label}</Text>
      {suffix ? <Text style={[styles.imageMenuSuffix, { color: colors.text.tertiary }]}>{suffix}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  domContainer: {
    flex: 1,
  },
  dom: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  toolbarDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingTop: spacing.xs,
  },
  toolbar: {
    alignSelf: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    overflow: 'hidden',
  },
  toolbarScroll: {
    width: '100%',
  },
  toolbarContent: {
    minHeight: 48,
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  toolButton: {
    width: TOOL_BUTTON_SIZE,
    height: TOOL_BUTTON_SIZE,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageMenu: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  linkSheet: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  linkInput: {
    minHeight: 48,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    lineHeight: 22,
  },
  linkActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  linkAction: {
    flex: 1,
    minHeight: 46,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  linkActionText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  imageMenuRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
  },
  imageMenuLabel: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
  },
  imageMenuSuffix: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
});

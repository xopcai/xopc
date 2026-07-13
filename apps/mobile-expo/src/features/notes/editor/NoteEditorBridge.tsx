import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { GestureResponderHandlers } from 'react-native';
import { InteractionManager, Keyboard, NativeModules, Platform, Pressable, ScrollView, StyleSheet, TextInput, UIManager, View, useWindowDimensions } from 'react-native';
import type { ReactNode } from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { BottomSheetModal } from '../../../components/BottomSheetModal';
import { useKeyboardListPadding } from '../../../hooks/use-keyboard-list-padding';
import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding, radii, spacing, useTheme } from '../../../theme';
import NoteEditorDomAdapter, { type NoteEditorAdapterCommand } from '../web-editor/NoteEditorDomAdapter';
import { DEFAULT_EDITOR_RUNTIME_STATE } from './editor-contract';
import type { NoteEditorInteractionState, NoteEditorPresentationState } from './editor-interaction';
import { canUseDomEditor } from './editor-platform';
import {
  isNativeMarkdownFlushResponse,
  NATIVE_JOIN_MARKDOWN_BLOCKS_SCRIPT,
  shouldForwardNativeMarkdownMessage,
} from './native-editor-markdown';
import type {
  EditorAttachmentPickSource,
  EditorCommand,
  EditorCommandInput,
  EditorAttachmentPickResult,
  NoteEditorHandle,
  EditorRuntimeState,
  EditorSelectionContext,
  NoteEditorLabels,
  NoteEditorTheme,
} from './editor-protocol';

type ToolbarAction = {
  key: string;
  label: string;
  icon: string;
  active?: boolean;
  disabled?: boolean;
  panHandlers?: GestureResponderHandlers;
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
const NATIVE_MARKDOWN_SYNC_DELAY_MS = 1000;

type PendingFlush = {
  resolve: (markdown: string) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type NativeRichEditorHandle = {
  getMarkdown: () => string;
  flushMarkdown: () => Promise<string>;
  focus: (position?: 'start' | 'end' | number) => void;
  blur: () => void;
  setHeading: (level: 1 | 2 | 3 | 4 | 0) => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleBulletList: () => void;
  insertTodo: () => void;
  toggleBlockquote: () => void;
  toggleCodeBlock: () => void;
  insertDivider: () => void;
  insertAttachment: (attachment: NonNullable<EditorAttachmentPickResult>) => void;
  setLink: (title: string, url: string) => void;
  removeLink: () => void;
  undo: () => void;
  redo: () => void;
};

type EditorSheet = 'image' | 'link' | 'heading' | 'ai';

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

function sameEditorState(a: EditorRuntimeState, b: EditorRuntimeState): boolean {
  return a.ready === b.ready
    && a.focused === b.focused
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

function isExpoDomWebViewAvailable(): boolean {
  return canUseDomEditor({
    platform: Platform.OS,
    isStoreClient: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
    hasExpoDomWebViewModule: Boolean(NativeModules.ExpoDomWebViewModule),
    getViewManagerConfig: UIManager.getViewManagerConfig,
  });
}

export interface NoteEditorBridgeProps {
  noteId: string;
  markdown: string;
  attachmentSrcMap?: Record<string, string>;
  topCommand?: EditorCommand | null;
  labels: NoteEditorLabels;
  onChangeMarkdown: (markdown: string) => void;
  onSelectionChange?: (context: EditorSelectionContext) => void;
  onRequestAttachment: (source: EditorAttachmentPickSource) => Promise<EditorAttachmentPickResult>;
  onInteractionStateChange?: (state: NoteEditorInteractionState) => void;
  onRuntimeStateChange?: (state: EditorRuntimeState) => void;
  aiActions?: NoteEditorAiAction[];
  aiLoadingKey?: string | null;
  onRequestAiAction?: (action: NoteEditorAiAction) => void;
  voiceFeedback?: ReactNode;
  voicePanHandlers?: GestureResponderHandlers;
  voicePressHandler?: () => void;
  voiceActive?: boolean;
  voiceDisabled?: boolean;
}

export const NoteEditorBridge = memo(forwardRef<NoteEditorBridgeHandle, NoteEditorBridgeProps>(function NoteEditorBridge({
  noteId,
  markdown,
  attachmentSrcMap,
  topCommand,
  labels,
  onChangeMarkdown,
  onSelectionChange,
  onRequestAttachment,
  onInteractionStateChange,
  onRuntimeStateChange,
  aiActions = [],
  aiLoadingKey,
  onRequestAiAction,
  voiceFeedback,
  voicePanHandlers,
  voicePressHandler,
  voiceActive,
  voiceDisabled,
}, ref) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardBottomInset = useKeyboardListPadding();
  const richEditorRef = useRef<NativeRichEditorHandle | null>(null);
  const linkUrlInputRef = useRef<TextInput | null>(null);
  const commandIdRef = useRef(0);
  const flushRequestIdRef = useRef(0);
  const pendingFlushesRef = useRef(new Map<number, PendingFlush>());
  const latestMarkdownRef = useRef(markdown);
  const [command, setCommand] = useState<NoteEditorAdapterCommand | null>(null);
  const [editorState, setEditorState] = useState<EditorRuntimeState>(DEFAULT_EDITOR_RUNTIME_STATE);
  const editorStateRef = useRef<EditorRuntimeState>(DEFAULT_EDITOR_RUNTIME_STATE);
  const pendingEditorStateRef = useRef<EditorRuntimeState | null>(null);
  const editorStateFrameRef = useRef<number | null>(null);
  const [sheetPresentation, setSheetPresentation] = useState<SheetPresentation>({ active: null, pending: null });
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [nativeActionActive, setNativeActionActive] = useState(false);
  const sheetRequestIdRef = useRef(0);
  const activeSheet = sheetPresentation.active;
  const presentation: NoteEditorPresentationState = activeSheet ? 'open' : (sheetPresentation.pending || nativeActionActive) ? 'opening' : 'none';
  const nativeModalVisible = presentation !== 'none';
  const canUseDomEditor = useMemo(() => isExpoDomWebViewAvailable(), []);
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
      resolve(latestMarkdownRef.current);
    });
    pendingFlushesRef.current.clear();
  }, []);

  useEffect(() => {
    latestMarkdownRef.current = markdown;
  }, [markdown]);

  useEffect(() => {
    onInteractionStateChange?.({
      focused: editorState.focused,
      presentation,
    });
  }, [editorState.focused, onInteractionStateChange, presentation]);

  useEffect(() => {
    if (canUseDomEditor) return;
    const fallbackState: EditorRuntimeState = {
      ...DEFAULT_EDITOR_RUNTIME_STATE,
      ready: true,
      focused: editorStateRef.current.focused,
    };
    editorStateRef.current = fallbackState;
    setEditorState(fallbackState);
    onRuntimeStateChange?.(fallbackState);
  }, [canUseDomEditor, onRuntimeStateChange]);

  const dispatch = useCallback((next: EditorCommandInput) => {
    commandIdRef.current += 1;
    setCommand({ id: commandIdRef.current, ...next } as EditorCommand);
  }, []);

  const runNativeEditorCommand = useCallback((next: EditorCommand) => {
    const native = richEditorRef.current;
    if (!native) return;
    switch (next.type) {
      case 'focus':
        native.focus(next.position);
        return;
      case 'blur':
        native.blur();
        return;
      case 'setHeading':
        native.setHeading(next.level);
        return;
      case 'toggleBold':
        native.toggleBold();
        return;
      case 'toggleItalic':
        native.toggleItalic();
        return;
      case 'toggleBulletList':
        native.toggleBulletList();
        return;
      case 'toggleTaskList':
        native.insertTodo();
        return;
      case 'toggleBlockquote':
        native.toggleBlockquote();
        return;
      case 'toggleCodeBlock':
        native.toggleCodeBlock();
        return;
      case 'insertDivider':
        native.insertDivider();
        return;
      case 'insertPreparedAttachment':
        native.insertAttachment(next.attachment);
        return;
      case 'setLink':
        native.setLink(next.title, next.url);
        return;
      case 'removeLink':
        native.removeLink();
        return;
      case 'undo':
        native.undo();
        return;
      case 'redo':
        native.redo();
        return;
      default:
        return;
    }
  }, []);

  useEffect(() => {
    if (!topCommand) return;
    if (!canUseDomEditor) {
      runNativeEditorCommand(topCommand);
      return;
    }
    commandIdRef.current += 1;
    setCommand({ ...topCommand, id: commandIdRef.current } as EditorCommand);
  }, [canUseDomEditor, runNativeEditorCommand, topCommand]);

  const handleFlushMarkdown = useCallback(async (requestId: number, nextMarkdown: string) => {
    latestMarkdownRef.current = nextMarkdown;
    const pending = pendingFlushesRef.current.get(requestId);
    if (!pending) return;
    pendingFlushesRef.current.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve(nextMarkdown);
  }, []);

  const flushMarkdown = useCallback(() => new Promise<string>((resolve) => {
    if (!canUseDomEditor) {
      void (richEditorRef.current?.flushMarkdown() ?? Promise.resolve(latestMarkdownRef.current)).then(resolve);
      return;
    }
    if (!editorStateRef.current.ready) {
      resolve(latestMarkdownRef.current);
      return;
    }
    flushRequestIdRef.current += 1;
    commandIdRef.current += 1;
    const requestId = flushRequestIdRef.current;
    const timeout = setTimeout(() => {
      const pending = pendingFlushesRef.current.get(requestId);
      if (!pending) return;
      pendingFlushesRef.current.delete(requestId);
      pending.resolve(latestMarkdownRef.current);
    }, EDITOR_FLUSH_TIMEOUT_MS);
    pendingFlushesRef.current.set(requestId, { resolve, timeout });
    setCommand({
      id: commandIdRef.current,
      type: 'requestMarkdownFlush',
      requestId,
    });
  }), [canUseDomEditor]);

  useImperativeHandle(ref, () => ({
    flushMarkdown,
    focus: (position) => dispatch({ type: 'focus', position }),
  }), [dispatch, flushMarkdown]);

  const openEditorSheet = useCallback((sheet: EditorSheet) => {
    sheetRequestIdRef.current += 1;
    const requestId = sheetRequestIdRef.current;
    setSheetPresentation({ active: null, pending: sheet });
    richEditorRef.current?.blur();
    void (async () => {
      await dismissKeyboardAndWait();
      await afterNativeInteractions();
      if (sheetRequestIdRef.current !== requestId) return;
      setSheetPresentation({ active: sheet, pending: null });
    })();
  }, []);

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
    const url = linkUrl.trim();
    if (!url) return;
    runAfterEditorSheetClose(() => {
      if (!canUseDomEditor) {
        richEditorRef.current?.setLink(linkTitle, url);
        return;
      }
      dispatch({ type: 'setLink', title: linkTitle, url });
    });
  }, [canUseDomEditor, dispatch, linkTitle, linkUrl, runAfterEditorSheetClose]);

  const handleRemoveLink = useCallback(() => {
    runAfterEditorSheetClose(() => {
      if (!canUseDomEditor) {
        richEditorRef.current?.removeLink();
        return;
      }
      dispatch({ type: 'removeLink' });
    });
  }, [canUseDomEditor, dispatch, runAfterEditorSheetClose]);

  const insertPickedAttachment = useCallback((attachment: NonNullable<EditorAttachmentPickResult>) => {
    if (canUseDomEditor) {
      dispatch({ type: 'insertPreparedAttachment', attachment });
      return;
    }
    richEditorRef.current?.insertAttachment(attachment);
  }, [canUseDomEditor, dispatch]);

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
    const nextActions: ToolbarAction[] = [
    {
      key: 'undo',
      label: labels.undo,
      icon: 'undo',
      disabled: !editorState.canUndo,
      onPress: () => {
        if (canUseDomEditor) dispatch({ type: 'undo' });
        else richEditorRef.current?.undo();
      },
    },
    {
      key: 'redo',
      label: labels.redo,
      icon: 'redo',
      disabled: !editorState.canRedo,
      onPress: () => {
        if (canUseDomEditor) dispatch({ type: 'redo' });
        else richEditorRef.current?.redo();
      },
    },
    {
      key: 'format',
      label: labels.textStyle,
      icon: 'format-letter-case',
      active: editorState.headingLevel > 0 || editorState.blockquote || editorState.codeBlock,
      onPress: () => openEditorSheet('heading'),
    },
    {
      key: 'bold',
      label: labels.bold,
      icon: 'format-bold',
      active: editorState.bold,
      onPress: () => {
        if (canUseDomEditor) dispatch({ type: 'toggleBold' });
        else richEditorRef.current?.toggleBold();
      },
    },
    {
      key: 'italic',
      label: labels.italic,
      icon: 'format-italic',
      active: editorState.italic,
      onPress: () => {
        if (canUseDomEditor) dispatch({ type: 'toggleItalic' });
        else richEditorRef.current?.toggleItalic();
      },
    },
    {
      key: 'bullet',
      label: labels.bulletList,
      icon: 'format-list-bulleted',
      active: editorState.bulletList,
      onPress: () => {
        if (canUseDomEditor) dispatch({ type: 'toggleBulletList' });
        else richEditorRef.current?.toggleBulletList();
      },
    },
    {
      key: 'todo',
      label: labels.todo,
      icon: 'checkbox-marked-outline',
      active: editorState.taskList,
      onPress: () => {
        if (canUseDomEditor) dispatch({ type: 'toggleTaskList' });
        else richEditorRef.current?.insertTodo();
      },
    },
    {
      key: 'image',
      label: labels.image,
      icon: 'image-outline',
      active: editorState.image,
      onPress: () => openEditorSheet('image'),
    },
    {
      key: 'link',
      label: labels.link,
      icon: 'link-variant',
      active: editorState.link,
      onPress: openLinkSheet,
    },
    ];

    if (onRequestAiAction && aiActions.length > 0) {
      nextActions.push({
        key: 'ai',
        label: labels.ai,
        icon: 'creation-outline',
        disabled: Boolean(aiLoadingKey),
        onPress: () => openEditorSheet('ai'),
      });
    }

    nextActions.push(
    {
      key: 'audio',
      label: labels.audio,
      icon: 'microphone-outline',
      active: voiceActive,
      disabled: voiceDisabled,
      panHandlers: voiceActive ? voicePanHandlers : undefined,
      onPress: voicePressHandler ?? (() => undefined),
    },
    );

    return nextActions;
  }, [
    aiActions.length,
    aiLoadingKey,
    canUseDomEditor,
    dispatch,
    editorState.blockquote,
    editorState.bold,
    editorState.bulletList,
    editorState.canRedo,
    editorState.canUndo,
    editorState.codeBlock,
    editorState.headingLevel,
    editorState.image,
    editorState.italic,
    editorState.link,
    editorState.taskList,
    labels.ai,
    labels.bold,
    labels.redo,
    labels.bulletList,
    labels.italic,
    labels.audio,
    labels.image,
    labels.link,
    labels.textStyle,
    labels.todo,
    labels.undo,
    onRequestAiAction,
    openLinkSheet,
    openEditorSheet,
    voiceActive,
    voiceDisabled,
    voicePanHandlers,
    voicePressHandler,
  ]);
  const showEditorToolbar = (editorState.focused && !nativeModalVisible) || Boolean(voiceActive);

  return (
    <View style={styles.container}>
      {canUseDomEditor ? (
        <NoteEditorDomAdapter
          noteId={noteId}
          initialMarkdown={markdown}
          attachmentSrcMap={attachmentSrcMap}
          editable
          theme={editorTheme}
          labels={labels}
          command={command}
          bottomInset={editorBottomInset}
          onChangeMarkdown={handleChange}
          onSelectionChange={handleSelectionChange}
          onStateChange={handleStateChange}
          onRequestAttachment={onRequestAttachment}
          onFlushMarkdown={handleFlushMarkdown}
          dom={domProps}
        />
      ) : (
        <NativeRichTextEditor
          ref={richEditorRef}
          noteId={noteId}
          markdown={markdown}
          attachmentSrcMap={attachmentSrcMap}
          theme={editorTheme}
          labels={labels}
          bottomInset={editorBottomInset}
          onChangeMarkdown={handleChange}
          onSelectionChange={handleSelectionChange}
          onStateChange={handleStateChange}
        />
      )}
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
                if (canUseDomEditor) dispatch({ type: 'setHeading', level: item.level });
                else richEditorRef.current?.setHeading(item.level);
              }}
            />
          ))}
          <ImageSourceRow
            label={labels.quote}
            icon="format-quote-close"
            onPress={() => {
              closeEditorSheet();
              if (canUseDomEditor) dispatch({ type: 'toggleBlockquote' });
              else richEditorRef.current?.toggleBlockquote();
            }}
          />
          <ImageSourceRow
            label={labels.code}
            icon="code-tags"
            onPress={() => {
              closeEditorSheet();
              if (canUseDomEditor) dispatch({ type: 'toggleCodeBlock' });
              else richEditorRef.current?.toggleCodeBlock();
            }}
          />
          <ImageSourceRow
            label={labels.divider}
            icon="minus"
            onPress={() => {
              closeEditorSheet();
              if (canUseDomEditor) dispatch({ type: 'insertDivider' });
              else richEditorRef.current?.insertDivider();
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
                  opacity: !linkUrl.trim() ? 0.42 : pressed ? 0.72 : 1,
                },
              ]}
              onPress={handleApplyLink}
              disabled={!linkUrl.trim()}
              accessibilityRole="button"
              accessibilityLabel={labels.apply}
            >
              <Text style={[styles.linkActionText, { color: colors.accent.onPrimary }]}>{labels.apply}</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheetModal>
      {voiceFeedback}
    </View>
  );
}));

type NativeRichTextEditorProps = {
  noteId: string;
  markdown: string;
  attachmentSrcMap?: Record<string, string>;
  theme: NoteEditorTheme;
  labels: NoteEditorLabels;
  bottomInset: number;
  onChangeMarkdown: (markdown: string) => Promise<void>;
  onSelectionChange?: (context: EditorSelectionContext) => Promise<void>;
  onStateChange?: (state: EditorRuntimeState) => Promise<void> | void;
};

type NativeRichEditorMessage =
  | { type: 'ready'; markdown?: string; state?: EditorRuntimeState }
  | { type: 'content'; markdown: string; reason: 'typing' | 'command' | 'flush'; flushRequestId?: number | null; state?: EditorRuntimeState }
  | { type: 'selection'; context: EditorSelectionContext; state?: EditorRuntimeState }
  | { type: 'focus'; focused: boolean; state: EditorRuntimeState };

function nativeEditorHtml({
  markdown,
  attachmentSrcMap,
  theme,
  labels,
  bottomInset,
  selectionEnabled,
}: {
  markdown: string;
  attachmentSrcMap: Record<string, string>;
  theme: NoteEditorTheme;
  labels: NoteEditorLabels;
  bottomInset: number;
  selectionEnabled: boolean;
}): string {
  const resolvedBottomInset = Math.max(96, Math.round(bottomInset));
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body { margin: 0; padding: 0; min-height: 100%; background: ${theme.background}; color: ${theme.text}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; scroll-padding-bottom: var(--xopc-editor-bottom-inset); }
    :root { --xopc-editor-bottom-inset: ${resolvedBottomInset}px; }
    #editor { box-sizing: border-box; min-height: 100vh; padding: 16px 20px var(--xopc-editor-bottom-inset); outline: none; font-size: 16px; line-height: 1.42; word-break: break-word; -webkit-user-select: text; user-select: text; scroll-margin-bottom: var(--xopc-editor-bottom-inset); }
    #editor:empty:before { content: ${JSON.stringify(labels.placeholder)}; color: ${theme.textTertiary}; }
    h1, h2, h3, h4, p, ul, ol, blockquote, pre { margin: 0 0 14px; }
    h1 { font-size: 32px; line-height: 38px; font-weight: 760; }
    h2 { font-size: 23px; line-height: 29px; font-weight: 700; }
    h3 { font-size: 19px; line-height: 25px; font-weight: 650; }
    h4 { font-size: 17px; line-height: 24px; font-weight: 650; }
    ul, ol { padding-left: 24px; }
    li { margin: 4px 0; }
    blockquote { border-left: 0; border-radius: 14px; padding: 14px 16px; color: ${theme.text}; background: ${theme.accentSoft}; }
    blockquote:before { content: "✦"; color: ${theme.accent}; margin-right: 10px; }
    a { color: ${theme.accent}; text-decoration: underline; }
    code { background: ${theme.input}; border-radius: 5px; padding: 1px 4px; }
    pre { background: ${theme.input}; border-radius: 14px; padding: 14px; overflow-x: auto; }
    hr { border: 0; height: 1px; background: ${theme.border}; margin: 18px 0; }
    img { display: block; max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0 12px; background: ${theme.input}; }
    input[type="checkbox"] { transform: translateY(1px); margin-right: 8px; }
  </style>
</head>
<body>
  <div id="editor" contenteditable="true" spellcheck="true"></div>
  <script>
    (function () {
      var editor = document.getElementById('editor');
      var attachmentMap = ${JSON.stringify(attachmentSrcMap)};
      var savedRange = null;
      var emitTimer = null;
      var tick = String.fromCharCode(96);

      function post(payload) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
      function escapeHtml(value) {
        return String(value || '').replace(/[&<>"]/g, function (ch) {
          return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;';
        });
      }
      function escapeAttr(value) {
        return escapeHtml(value).replace(/'/g, '&#39;');
      }
      function inlineToHtml(value) {
        var html = escapeHtml(value);
        html = html.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, function (_, alt, src) {
          var canonical = src.trim();
          var display = attachmentMap[canonical] || canonical;
          return '<img alt="' + escapeAttr(alt) + '" data-src="' + escapeAttr(canonical) + '" src="' + escapeAttr(display) + '" />';
        });
        html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
        html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
        html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
        html = html.replace(new RegExp(tick + '([^' + tick + ']+)' + tick, 'g'), '<code>$1</code>');
        return html;
      }
      function closeList(out, state) {
        if (state.list) {
          out.push('</' + state.list + '>');
          state.list = '';
        }
      }
      function closeParagraph(out, state) {
        if (state.paragraphLines && state.paragraphLines.length) {
          out.push('<p data-xopc-paragraph="true">' + state.paragraphLines.map(inlineToHtml).join('\\n') + '</p>');
          state.paragraphLines = [];
        }
      }
      function markdownToHtml(markdown) {
        if (!String(markdown || '').trim()) return '';
        var lines = String(markdown || '').split(/\\r?\\n/);
        var out = [];
        var state = { list: '', code: false, codeLines: [], paragraphLines: [] };
        lines.forEach(function (line) {
          var m;
          if (state.code) {
            if (line.indexOf(tick + tick + tick) === 0) {
              out.push('<pre><code>' + escapeHtml(state.codeLines.join('\\n')) + '</code></pre>');
              state.code = false;
              state.codeLines = [];
            } else {
              state.codeLines.push(line);
            }
          } else if (line.indexOf(tick + tick + tick) === 0) {
            closeList(out, state);
            closeParagraph(out, state);
            state.code = true;
            state.codeLines = [];
          } else if (!line.trim()) {
            closeList(out, state);
            closeParagraph(out, state);
          } else if ((m = /^(#{1,4})\\s+(.+)$/.exec(line))) {
            closeList(out, state);
            closeParagraph(out, state);
            out.push('<h' + m[1].length + '>' + inlineToHtml(m[2]) + '</h' + m[1].length + '>');
          } else if (/^(-{3,}|\\*{3,}|_{3,})$/.test(line.trim())) {
            closeList(out, state);
            closeParagraph(out, state);
            out.push('<hr />');
          } else if ((m = /^>\\s?(.+)$/.exec(line))) {
            closeList(out, state);
            closeParagraph(out, state);
            out.push('<blockquote>' + inlineToHtml(m[1]) + '</blockquote>');
          } else if ((m = /^- \\[([ xX])\\]\\s*(.*)$/.exec(line))) {
            closeParagraph(out, state);
            if (state.list !== 'ul') {
              closeList(out, state);
              out.push('<ul data-task-list="true">');
              state.list = 'ul';
            }
            out.push('<li data-task-item="true"><input type="checkbox" ' + (m[1].toLowerCase() === 'x' ? 'checked ' : '') + '/>' + inlineToHtml(m[2]) + '</li>');
          } else if ((m = /^[-*]\\s+(.+)$/.exec(line))) {
            closeParagraph(out, state);
            if (state.list !== 'ul') {
              closeList(out, state);
              out.push('<ul>');
              state.list = 'ul';
            }
            out.push('<li>' + inlineToHtml(m[1]) + '</li>');
          } else if ((m = /^\\d+\\.\\s+(.+)$/.exec(line))) {
            closeParagraph(out, state);
            if (state.list !== 'ol') {
              closeList(out, state);
              out.push('<ol>');
              state.list = 'ol';
            }
            out.push('<li>' + inlineToHtml(m[1]) + '</li>');
          } else {
            closeList(out, state);
            state.paragraphLines.push(line);
          }
        });
        if (state.code) {
          out.push('<pre><code>' + escapeHtml(state.codeLines.join('\\n')) + '</code></pre>');
        }
        closeParagraph(out, state);
        closeList(out, state);
        return out.join('');
      }
      function inlineToMarkdown(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        var tag = node.tagName.toLowerCase();
        if (tag === 'br') return '\\n';
        if (tag === 'strong' || tag === 'b') return '**' + childrenToMarkdown(node) + '**';
        if (tag === 'em' || tag === 'i') return '*' + childrenToMarkdown(node) + '*';
        if (tag === 'code') return tick + (node.textContent || '') + tick;
        if (tag === 'a') return '[' + childrenToMarkdown(node) + '](' + (node.getAttribute('href') || '') + ')';
        if (tag === 'img') return '![' + (node.getAttribute('alt') || 'image') + '](' + (node.getAttribute('data-src') || node.getAttribute('src') || '') + ')';
        if (tag === 'input') return '';
        return childrenToMarkdown(node);
      }
      function childrenToMarkdown(node) {
        return Array.prototype.map.call(node.childNodes, inlineToMarkdown).join('');
      }
      ${NATIVE_JOIN_MARKDOWN_BLOCKS_SCRIPT}
      function markdownBlock(text, paragraph) {
        return { text: text, paragraph: !!paragraph };
      }
      function blockToMarkdown(node) {
        if (node.nodeType === Node.TEXT_NODE) return markdownBlock((node.nodeValue || '').trim(), false);
        if (node.nodeType !== Node.ELEMENT_NODE) return markdownBlock('', false);
        var tag = node.tagName.toLowerCase();
        var text = childrenToMarkdown(node).trim();
        if (tag === 'h1') return markdownBlock('# ' + text, false);
        if (tag === 'h2') return markdownBlock('## ' + text, false);
        if (tag === 'h3') return markdownBlock('### ' + text, false);
        if (tag === 'h4') return markdownBlock('#### ' + text, false);
        if (tag === 'blockquote') return markdownBlock('> ' + text, false);
        if (tag === 'pre') return markdownBlock(tick + tick + tick + '\\n' + (node.textContent || '').trim() + '\\n' + tick + tick + tick, false);
        if (tag === 'hr') return markdownBlock('---', false);
        if (tag === 'ul') {
          return markdownBlock(Array.prototype.map.call(node.children, function (li) {
            var checked = li.querySelector('input[type="checkbox"]') && li.querySelector('input[type="checkbox"]').checked;
            var task = li.getAttribute('data-task-item') === 'true' || node.getAttribute('data-task-list') === 'true';
            return (task ? '- [' + (checked ? 'x' : ' ') + '] ' : '- ') + childrenToMarkdown(li).trim();
          }).join('\\n'), false);
        }
        if (tag === 'ol') {
          return markdownBlock(Array.prototype.map.call(node.children, function (li, index) {
            return (index + 1) + '. ' + childrenToMarkdown(li).trim();
          }).join('\\n'), false);
        }
        return markdownBlock(text, tag === 'p' && node.getAttribute('data-xopc-paragraph') === 'true');
      }
      function htmlToMarkdown() {
        return joinNativeMarkdownBlocks(Array.prototype.map.call(editor.childNodes, blockToMarkdown));
      }
      function state() {
        var selection = window.getSelection();
        var from = 0;
        var to = 0;
        var parent = null;
        if (selection && selection.rangeCount) {
          var range = selection.getRangeAt(0);
          from = range.startOffset || 0;
          to = range.endOffset || from;
          parent = range.commonAncestorContainer;
          if (parent && parent.nodeType !== Node.ELEMENT_NODE) parent = parent.parentElement;
        }
        var active = function (selector) {
          return !!(parent && parent.closest && parent.closest(selector));
        };
        var heading = 0;
        if (active('h1')) heading = 1;
        else if (active('h2')) heading = 2;
        else if (active('h3')) heading = 3;
        else if (active('h4')) heading = 4;
        return {
          ready: true,
          focused: document.activeElement === editor,
          selection: { from: from, to: to },
          emptySelection: from === to,
          canUndo: document.queryCommandEnabled('undo'),
          canRedo: document.queryCommandEnabled('redo'),
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          headingLevel: heading,
          bulletList: active('ul:not([data-task-list="true"])'),
          taskList: active('ul[data-task-list="true"], li[data-task-item="true"]'),
          blockquote: active('blockquote'),
          codeBlock: active('pre'),
          link: false,
          image: false
        };
      }
      function postState() {
        var nextState = state();
        post({ type: 'focus', focused: nextState.focused, state: nextState });
      }
      function postSelection() {
        if (!${selectionEnabled ? 'true' : 'false'}) return;
        var markdown = htmlToMarkdown();
        post({
          type: 'selection',
          context: {
            from: state().selection.from,
            to: state().selection.to,
            markdown: markdown,
            currentBlockMarkdown: markdown,
            beforeMarkdown: markdown.slice(0, 1200),
            afterMarkdown: markdown.slice(Math.max(0, markdown.length - 1200))
          },
          state: state()
        });
      }
      function emitChange(reason, flushRequestId) {
        if (emitTimer) {
          clearTimeout(emitTimer);
          emitTimer = null;
        }
        var markdown = htmlToMarkdown();
        post({ type: 'content', reason: reason || 'typing', markdown: markdown, flushRequestId: flushRequestId || null, state: state() });
      }
      function scheduleEmit() {
        if (emitTimer) clearTimeout(emitTimer);
        emitTimer = setTimeout(function () {
          emitTimer = null;
          emitChange('typing');
        }, ${NATIVE_MARKDOWN_SYNC_DELAY_MS});
      }
      function saveSelection() {
        var selection = window.getSelection();
        if (selection && selection.rangeCount) savedRange = selection.getRangeAt(0).cloneRange();
      }
      function restoreSelection() {
        if (!savedRange) return;
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedRange);
      }
      function placeCaret(position) {
        var selection = window.getSelection();
        if (!selection) return;
        var range = document.createRange();
        if (position === 'start') {
          range.setStart(editor, 0);
          range.collapse(true);
        } else if (typeof position === 'number') {
          var remaining = Math.max(0, position);
          var walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
          var node = walker.nextNode();
          while (node && remaining > (node.nodeValue || '').length) {
            remaining -= (node.nodeValue || '').length;
            node = walker.nextNode();
          }
          if (node) {
            range.setStart(node, Math.min(remaining, (node.nodeValue || '').length));
            range.collapse(true);
          } else {
            range.selectNodeContents(editor);
            range.collapse(false);
          }
        } else {
          range.selectNodeContents(editor);
          range.collapse(false);
        }
        selection.removeAllRanges();
        selection.addRange(range);
        savedRange = range.cloneRange();
      }
      function insertHtml(html) {
        editor.focus();
        restoreSelection();
        document.execCommand('insertHTML', false, html);
        saveSelection();
        emitChange('command');
      }
      function formatBlock(tagName) {
        editor.focus();
        restoreSelection();
        document.execCommand('formatBlock', false, tagName);
        saveSelection();
        emitChange('command');
      }
      function command(name, payload) {
        if (name === 'setHeading') {
          var level = payload && Number(payload.level);
          formatBlock(level >= 1 && level <= 4 ? 'h' + level : 'p');
        } else if (name === 'toggleBold') {
          editor.focus();
          restoreSelection();
          document.execCommand('bold', false);
          saveSelection();
          emitChange('command');
        } else if (name === 'toggleItalic') {
          editor.focus();
          restoreSelection();
          document.execCommand('italic', false);
          saveSelection();
          emitChange('command');
        } else if (name === 'toggleBulletList') insertHtml('<ul><li> </li></ul>');
        else if (name === 'insertTodo') insertHtml('<ul data-task-list="true"><li data-task-item="true"><input type="checkbox" /> </li></ul>');
        else if (name === 'toggleBlockquote') formatBlock('blockquote');
        else if (name === 'toggleCodeBlock') formatBlock('pre');
        else if (name === 'insertDivider') insertHtml('<hr /><p><br /></p>');
        else if (name === 'insertAttachment') {
          var label = (payload && payload.alt) || (payload && payload.kind === 'image' ? 'image' : 'attachment');
          if (payload && payload.kind === 'image') {
            insertHtml('<img alt="' + escapeAttr(label) + '" data-src="' + escapeAttr(payload.src) + '" src="' + escapeAttr(payload.displaySrc || attachmentMap[payload.src] || payload.src) + '" />');
          } else {
            insertHtml('<a href="' + escapeAttr(payload.src) + '">' + escapeHtml(label) + '</a>');
          }
        } else if (name === 'setLink') {
          var title = (payload && payload.title) || (payload && payload.url) || '';
          var url = (payload && payload.url) || '';
          insertHtml('<a href="' + escapeAttr(url) + '">' + escapeHtml(title) + '</a>');
        } else if (name === 'removeLink') {
          editor.focus();
          restoreSelection();
          document.execCommand('unlink', false);
          emitChange('command');
        } else if (name === 'undo' || name === 'redo') {
          editor.focus();
          document.execCommand(name, false);
          emitChange('command');
        }
      }
      window.xopcEditor = {
        focus: function (position) {
          editor.focus();
          placeCaret(position || 'end');
          postState();
        },
        blur: function () { editor.blur(); },
        command: command,
        setAttachmentMap: function (nextMap) {
          attachmentMap = nextMap || {};
          Array.prototype.forEach.call(editor.querySelectorAll('img[data-src]'), function (img) {
            var src = img.getAttribute('data-src');
            img.setAttribute('src', attachmentMap[src] || src);
          });
        },
        setMarkdown: function (nextMarkdown) {
          editor.innerHTML = markdownToHtml(nextMarkdown || '');
          emitChange('flush');
        },
        flushMarkdown: function (requestId) {
          emitChange('flush', requestId);
        },
        setBottomInset: function (nextBottomInset) {
          var inset = Math.max(96, Math.round(Number(nextBottomInset) || 0));
          document.documentElement.style.setProperty('--xopc-editor-bottom-inset', inset + 'px');
        }
      };
      editor.addEventListener('input', scheduleEmit);
      editor.addEventListener('change', scheduleEmit);
      editor.addEventListener('focus', postState);
      editor.addEventListener('blur', function () { emitChange('flush'); postState(); });
      document.addEventListener('selectionchange', function () {
        if (document.activeElement !== editor) return;
        saveSelection();
        postSelection();
      });
      editor.innerHTML = markdownToHtml(${JSON.stringify(markdown)});
      post({ type: 'ready', markdown: htmlToMarkdown(), state: state() });
    })();
  </script>
</body>
</html>`;
}

const NativeRichTextEditor = memo(forwardRef<NativeRichEditorHandle, NativeRichTextEditorProps>(function NativeRichTextEditor({
  noteId,
  markdown,
  attachmentSrcMap,
  theme,
  labels,
  bottomInset,
  onChangeMarkdown,
  onSelectionChange,
  onStateChange,
}, ref) {
  const webViewRef = useRef<WebView | null>(null);
  const latestMarkdownRef = useRef(markdown);
  const lastWebMarkdownRef = useRef(markdown);
  const readyRef = useRef(false);
  const flushRequestIdRef = useRef(0);
  const pendingFlushesRef = useRef(new Map<number, PendingFlush>());
  const html = useMemo(
    () => nativeEditorHtml({
      markdown,
      attachmentSrcMap: attachmentSrcMap ?? {},
      theme,
      labels,
      bottomInset,
      selectionEnabled: Boolean(onSelectionChange),
    }),
    // The WebView is keyed by noteId. Later markdown changes are pushed with injected JS.
    [noteId, theme, labels, onSelectionChange],
  );

  const inject = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(`${script}\ntrue;`);
  }, []);

  const flushMarkdown = useCallback(() => new Promise<string>((resolve) => {
    if (!readyRef.current) {
      resolve(latestMarkdownRef.current);
      return;
    }
    flushRequestIdRef.current += 1;
    const requestId = flushRequestIdRef.current;
    const timeout = setTimeout(() => {
      const pending = pendingFlushesRef.current.get(requestId);
      if (!pending) return;
      pendingFlushesRef.current.delete(requestId);
      pending.resolve(latestMarkdownRef.current);
    }, EDITOR_FLUSH_TIMEOUT_MS);
    pendingFlushesRef.current.set(requestId, { resolve, timeout });
    inject(`window.xopcEditor && window.xopcEditor.flushMarkdown(${requestId});`);
  }), [inject]);

  useEffect(() => () => {
    pendingFlushesRef.current.forEach(({ resolve, timeout }) => {
      clearTimeout(timeout);
      resolve(latestMarkdownRef.current);
    });
    pendingFlushesRef.current.clear();
  }, []);

  useImperativeHandle(ref, () => ({
    getMarkdown: () => latestMarkdownRef.current,
    flushMarkdown,
    focus: (position) => inject(`window.xopcEditor && window.xopcEditor.focus(${JSON.stringify(position ?? 'end')});`),
    blur: () => inject('window.xopcEditor && window.xopcEditor.blur();'),
    setHeading: (level) => inject(`window.xopcEditor && window.xopcEditor.command("setHeading", ${JSON.stringify({ level })});`),
    toggleBold: () => inject('window.xopcEditor && window.xopcEditor.command("toggleBold");'),
    toggleItalic: () => inject('window.xopcEditor && window.xopcEditor.command("toggleItalic");'),
    toggleBulletList: () => inject('window.xopcEditor && window.xopcEditor.command("toggleBulletList");'),
    insertTodo: () => inject('window.xopcEditor && window.xopcEditor.command("insertTodo");'),
    toggleBlockquote: () => inject('window.xopcEditor && window.xopcEditor.command("toggleBlockquote");'),
    toggleCodeBlock: () => inject('window.xopcEditor && window.xopcEditor.command("toggleCodeBlock");'),
    insertDivider: () => inject('window.xopcEditor && window.xopcEditor.command("insertDivider");'),
    insertAttachment: (attachment) => {
      inject(`window.xopcEditor && window.xopcEditor.command("insertAttachment", ${JSON.stringify(attachment)});`);
    },
    setLink: (title, url) => {
      inject(`window.xopcEditor && window.xopcEditor.command("setLink", ${JSON.stringify({ title, url })});`);
    },
    removeLink: () => inject('window.xopcEditor && window.xopcEditor.command("removeLink");'),
    undo: () => inject('window.xopcEditor && window.xopcEditor.command("undo");'),
    redo: () => inject('window.xopcEditor && window.xopcEditor.command("redo");'),
  }), [flushMarkdown, inject]);

  useEffect(() => {
    latestMarkdownRef.current = markdown;
    if (!readyRef.current || markdown === lastWebMarkdownRef.current) return;
    inject(`window.xopcEditor && window.xopcEditor.setMarkdown(${JSON.stringify(markdown)});`);
  }, [inject, markdown]);

  useEffect(() => {
    if (!readyRef.current) return;
    inject(`window.xopcEditor && window.xopcEditor.setAttachmentMap(${JSON.stringify(attachmentSrcMap ?? {})});`);
  }, [attachmentSrcMap, inject]);

  useEffect(() => {
    if (!readyRef.current) return;
    inject(`window.xopcEditor && window.xopcEditor.setBottomInset(${Math.max(96, Math.round(bottomInset))});`);
  }, [bottomInset, inject]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    let message: NativeRichEditorMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as NativeRichEditorMessage;
    } catch {
      return;
    }
    if (message.type === 'ready') {
      readyRef.current = true;
      if (typeof message.markdown === 'string') {
        lastWebMarkdownRef.current = message.markdown;
      }
    }
    if ('markdown' in message && typeof message.markdown === 'string') {
      const shouldForward = shouldForwardNativeMarkdownMessage(message, latestMarkdownRef.current);
      latestMarkdownRef.current = message.markdown;
      lastWebMarkdownRef.current = message.markdown;
      if (message.type === 'content' && typeof message.flushRequestId === 'number' && isNativeMarkdownFlushResponse(message, message.flushRequestId)) {
        const pending = pendingFlushesRef.current.get(message.flushRequestId);
        if (pending) {
          pendingFlushesRef.current.delete(message.flushRequestId);
          clearTimeout(pending.timeout);
          pending.resolve(message.markdown);
        }
      }
      if (shouldForward) {
        void onChangeMarkdown(message.markdown);
      }
    }
    if (message.type === 'selection') {
      void onSelectionChange?.(message.context);
    }
    if (message.state) {
      void onStateChange?.(message.state);
    }
  }, [onChangeMarkdown, onSelectionChange, onStateChange]);

  return (
    <WebView
      key={noteId}
      ref={webViewRef}
      source={{ html }}
      originWhitelist={['*']}
      javaScriptEnabled
      scrollEnabled
      hideKeyboardAccessoryView
      keyboardDisplayRequiresUserAction={false}
      automaticallyAdjustContentInsets={false}
      contentInset={{ top: 0, left: 0, bottom: Math.max(0, Math.round(bottomInset)), right: 0 }}
      contentInsetAdjustmentBehavior="never"
      onMessage={handleMessage}
      style={styles.richWebView}
      containerStyle={styles.richWebViewContainer}
    />
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
              {...action.panHandlers}
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
  richWebViewContainer: {
    flex: 1,
    minHeight: 0,
  },
  richWebView: {
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

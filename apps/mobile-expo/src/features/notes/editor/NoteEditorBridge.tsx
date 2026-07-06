import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { GestureResponderHandlers } from 'react-native';
import { Keyboard, NativeModules, Platform, Pressable, ScrollView, StyleSheet, TextInput, UIManager, View, useWindowDimensions } from 'react-native';
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
import { canUseDomEditor } from './editor-platform';
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

export type NoteEditorBridgeHandle = NoteEditorHandle;

const TOOL_BUTTON_SIZE = 44;
const EDITOR_FLUSH_TIMEOUT_MS = 1500;

type PendingFlush = {
  resolve: (markdown: string) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type NativeRichEditorHandle = {
  getMarkdown: () => string;
  focus: () => void;
  blur: () => void;
  insertTodo: () => void;
  insertAttachment: (attachment: NonNullable<EditorAttachmentPickResult>) => void;
  setLink: (title: string, url: string) => void;
  removeLink: () => void;
  undo: () => void;
  redo: () => void;
};

type EditorSheet = 'image' | 'link';

function sameEditorState(a: EditorRuntimeState, b: EditorRuntimeState): boolean {
  return a.ready === b.ready
    && a.focused === b.focused
    && a.selection.from === b.selection.from
    && a.selection.to === b.selection.to
    && a.canUndo === b.canUndo
    && a.canRedo === b.canRedo
    && a.todo === b.todo
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
  onSelectionChange: (context: EditorSelectionContext) => void;
  onRequestAttachment: (source: EditorAttachmentPickSource) => Promise<EditorAttachmentPickResult>;
  onFocusChange?: (focused: boolean) => void;
  onRuntimeStateChange?: (state: EditorRuntimeState) => void;
  voiceFeedback?: ReactNode;
  voicePanHandlers?: GestureResponderHandlers;
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
  onFocusChange,
  onRuntimeStateChange,
  voiceFeedback,
  voicePanHandlers,
  voiceActive,
  voiceDisabled,
}, ref) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardBottomInset = useKeyboardListPadding();
  const richEditorRef = useRef<NativeRichEditorHandle | null>(null);
  const commandIdRef = useRef(0);
  const flushRequestIdRef = useRef(0);
  const pendingFlushesRef = useRef(new Map<number, PendingFlush>());
  const latestMarkdownRef = useRef(markdown);
  const [command, setCommand] = useState<NoteEditorAdapterCommand | null>(null);
  const [editorState, setEditorState] = useState<EditorRuntimeState>(DEFAULT_EDITOR_RUNTIME_STATE);
  const editorStateRef = useRef<EditorRuntimeState>(DEFAULT_EDITOR_RUNTIME_STATE);
  const pendingEditorStateRef = useRef<EditorRuntimeState | null>(null);
  const editorStateFrameRef = useRef<number | null>(null);
  const [activeSheet, setActiveSheet] = useState<EditorSheet | null>(null);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const sheetVisible = activeSheet !== null;
  const canUseDomEditor = useMemo(() => isExpoDomWebViewAvailable(), []);
  const keyboardOverlayInset = Platform.OS === 'android' ? 0 : keyboardBottomInset;
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

  const handleSelectionChange = useCallback(async (context: EditorSelectionContext) => {
    onSelectionChange(context);
  }, [onSelectionChange]);

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
    onFocusChange?.(editorState.focused || sheetVisible);
  }, [editorState.focused, onFocusChange, sheetVisible]);

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
        native.focus();
        return;
      case 'toggleTaskList':
        native.insertTodo();
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
      resolve(richEditorRef.current?.getMarkdown() ?? latestMarkdownRef.current);
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
  }), [flushMarkdown]);

  const openEditorSheet = useCallback((sheet: EditorSheet) => {
    onFocusChange?.(true);
    Keyboard.dismiss();
    richEditorRef.current?.blur();
    setActiveSheet(sheet);
  }, [onFocusChange]);

  const closeEditorSheet = useCallback(() => {
    setActiveSheet(null);
    onFocusChange?.(editorStateRef.current.focused);
  }, [onFocusChange]);

  const openLinkSheet = useCallback(() => {
    setLinkTitle('');
    setLinkUrl('');
    openEditorSheet('link');
  }, [openEditorSheet]);

  const handleApplyLink = useCallback(() => {
    const url = linkUrl.trim();
    if (!url) return;
    closeEditorSheet();
    if (!canUseDomEditor) {
      richEditorRef.current?.setLink(linkTitle, url);
      return;
    }
    dispatch({ type: 'setLink', title: linkTitle, url });
  }, [canUseDomEditor, closeEditorSheet, dispatch, linkTitle, linkUrl]);

  const handleRemoveLink = useCallback(() => {
    closeEditorSheet();
    if (!canUseDomEditor) {
      richEditorRef.current?.removeLink();
      return;
    }
    dispatch({ type: 'removeLink' });
  }, [canUseDomEditor, closeEditorSheet, dispatch]);

  const handleInsertImageFromLibrary = useCallback(() => {
    closeEditorSheet();
    if (!canUseDomEditor) {
      void onRequestAttachment('photos').then((attachment) => {
        if (attachment) richEditorRef.current?.insertAttachment(attachment);
      });
      return;
    }
    dispatch({ type: 'insertAttachment', source: 'photos' });
  }, [canUseDomEditor, closeEditorSheet, dispatch, onRequestAttachment]);

  const handleInsertImageFromCamera = useCallback(() => {
    closeEditorSheet();
    if (!canUseDomEditor) {
      void onRequestAttachment('camera').then((attachment) => {
        if (attachment) richEditorRef.current?.insertAttachment(attachment);
      });
      return;
    }
    dispatch({ type: 'insertAttachment', source: 'camera' });
  }, [canUseDomEditor, closeEditorSheet, dispatch, onRequestAttachment]);

  const handleInsertDocument = useCallback(() => {
    if (!canUseDomEditor) {
      void onRequestAttachment('document').then((attachment) => {
        if (attachment) richEditorRef.current?.insertAttachment(attachment);
      });
      return;
    }
    dispatch({ type: 'insertAttachment', source: 'document' });
  }, [canUseDomEditor, dispatch, onRequestAttachment]);

  const actions = useMemo<ToolbarAction[]>(() => [
    {
      key: 'todo',
      label: labels.todo,
      icon: 'checkbox-marked-outline',
      active: editorState.todo,
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
      key: 'file',
      label: labels.imageDocument,
      icon: 'file-document-outline',
      onPress: handleInsertDocument,
    },
    {
      key: 'link',
      label: labels.link,
      icon: 'link-variant',
      active: editorState.link,
      onPress: openLinkSheet,
    },
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
      key: 'audio',
      label: labels.audio,
      icon: 'microphone-outline',
      active: voiceActive,
      disabled: voiceDisabled,
      panHandlers: voicePanHandlers,
      onPress: () => undefined,
    },
  ], [
    canUseDomEditor,
    dispatch,
    editorState.canRedo,
    editorState.canUndo,
    editorState.image,
    editorState.link,
    editorState.todo,
    handleInsertDocument,
    labels.audio,
    labels.image,
    labels.imageDocument,
    labels.link,
    labels.redo,
    labels.todo,
    labels.undo,
    openLinkSheet,
    openEditorSheet,
    voiceActive,
    voiceDisabled,
    voicePanHandlers,
  ]);
  const showEditorToolbar = (editorState.focused && !sheetVisible) || Boolean(voiceActive);

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
  onSelectionChange: (context: EditorSelectionContext) => Promise<void>;
  onStateChange?: (state: EditorRuntimeState) => Promise<void> | void;
};

type NativeRichEditorMessage =
  | { type: 'ready'; markdown?: string; state?: EditorRuntimeState }
  | { type: 'change'; markdown: string; state?: EditorRuntimeState }
  | { type: 'selection'; context: EditorSelectionContext; state?: EditorRuntimeState }
  | { type: 'state'; state: EditorRuntimeState };

function nativeEditorHtml({
  markdown,
  attachmentSrcMap,
  theme,
  labels,
  bottomInset,
}: {
  markdown: string;
  attachmentSrcMap: Record<string, string>;
  theme: NoteEditorTheme;
  labels: NoteEditorLabels;
  bottomInset: number;
}): string {
  const resolvedBottomInset = Math.max(96, Math.round(bottomInset));
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body { margin: 0; padding: 0; min-height: 100%; background: ${theme.background}; color: ${theme.text}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    :root { --xopc-editor-bottom-inset: ${resolvedBottomInset}px; }
    #editor { box-sizing: border-box; min-height: 100vh; padding: 16px 20px var(--xopc-editor-bottom-inset); outline: none; font-size: 16px; line-height: 1.55; word-break: break-word; -webkit-user-select: text; user-select: text; }
    #editor:empty:before { content: ${JSON.stringify(labels.placeholder)}; color: ${theme.textTertiary}; }
    h1, h2, h3, p, ul, ol, blockquote { margin: 0 0 12px; }
    h1 { font-size: 28px; line-height: 34px; font-weight: 700; }
    h2 { font-size: 23px; line-height: 29px; font-weight: 700; }
    h3 { font-size: 19px; line-height: 25px; font-weight: 650; }
    ul, ol { padding-left: 24px; }
    li { margin: 4px 0; }
    blockquote { border-left: 3px solid ${theme.border}; padding-left: 12px; color: ${theme.textSecondary}; }
    a { color: ${theme.accent}; text-decoration: underline; }
    code { background: ${theme.input}; border-radius: 5px; padding: 1px 4px; }
    pre { background: ${theme.input}; border-radius: 8px; padding: 12px; overflow-x: auto; }
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
      function markdownToHtml(markdown) {
        if (!String(markdown || '').trim()) return '';
        var lines = String(markdown || '').split(/\\r?\\n/);
        var out = [];
        var state = { list: '' };
        lines.forEach(function (line) {
          var m;
          if (!line.trim()) {
            closeList(out, state);
            out.push('<p><br /></p>');
          } else if ((m = /^(#{1,3})\\s+(.+)$/.exec(line))) {
            closeList(out, state);
            out.push('<h' + m[1].length + '>' + inlineToHtml(m[2]) + '</h' + m[1].length + '>');
          } else if ((m = /^>\\s?(.+)$/.exec(line))) {
            closeList(out, state);
            out.push('<blockquote>' + inlineToHtml(m[1]) + '</blockquote>');
          } else if ((m = /^- \\[([ xX])\\]\\s*(.*)$/.exec(line))) {
            if (state.list !== 'ul') {
              closeList(out, state);
              out.push('<ul data-task-list="true">');
              state.list = 'ul';
            }
            out.push('<li data-task-item="true"><input type="checkbox" ' + (m[1].toLowerCase() === 'x' ? 'checked ' : '') + '/>' + inlineToHtml(m[2]) + '</li>');
          } else if ((m = /^[-*]\\s+(.+)$/.exec(line))) {
            if (state.list !== 'ul') {
              closeList(out, state);
              out.push('<ul>');
              state.list = 'ul';
            }
            out.push('<li>' + inlineToHtml(m[1]) + '</li>');
          } else if ((m = /^\\d+\\.\\s+(.+)$/.exec(line))) {
            if (state.list !== 'ol') {
              closeList(out, state);
              out.push('<ol>');
              state.list = 'ol';
            }
            out.push('<li>' + inlineToHtml(m[1]) + '</li>');
          } else {
            closeList(out, state);
            out.push('<p>' + inlineToHtml(line) + '</p>');
          }
        });
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
      function blockToMarkdown(node) {
        if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue || '').trim();
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        var tag = node.tagName.toLowerCase();
        var text = childrenToMarkdown(node).trim();
        if (tag === 'h1') return '# ' + text;
        if (tag === 'h2') return '## ' + text;
        if (tag === 'h3') return '### ' + text;
        if (tag === 'blockquote') return '> ' + text;
        if (tag === 'ul') {
          return Array.prototype.map.call(node.children, function (li) {
            var checked = li.querySelector('input[type="checkbox"]') && li.querySelector('input[type="checkbox"]').checked;
            var task = li.getAttribute('data-task-item') === 'true' || node.getAttribute('data-task-list') === 'true';
            return (task ? '- [' + (checked ? 'x' : ' ') + '] ' : '- ') + childrenToMarkdown(li).trim();
          }).join('\\n');
        }
        if (tag === 'ol') {
          return Array.prototype.map.call(node.children, function (li, index) {
            return (index + 1) + '. ' + childrenToMarkdown(li).trim();
          }).join('\\n');
        }
        return text;
      }
      function htmlToMarkdown() {
        return Array.prototype.map.call(editor.childNodes, blockToMarkdown).filter(function (part) {
          return part.trim().length > 0;
        }).join('\\n\\n');
      }
      function state() {
        var selection = window.getSelection();
        var from = 0;
        var to = 0;
        if (selection && selection.rangeCount) {
          from = selection.getRangeAt(0).startOffset || 0;
          to = selection.getRangeAt(0).endOffset || from;
        }
        return {
          ready: true,
          focused: document.activeElement === editor,
          selection: { from: from, to: to },
          canUndo: document.queryCommandEnabled('undo'),
          canRedo: document.queryCommandEnabled('redo'),
          todo: false,
          link: false,
          image: false
        };
      }
      function postState() {
        post({ type: 'state', state: state() });
      }
      function postSelection() {
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
      function emitChange() {
        var markdown = htmlToMarkdown();
        post({ type: 'change', markdown: markdown, state: state() });
      }
      function scheduleEmit() {
        if (emitTimer) clearTimeout(emitTimer);
        emitTimer = setTimeout(function () {
          emitTimer = null;
          emitChange();
        }, 150);
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
      function insertHtml(html) {
        editor.focus();
        restoreSelection();
        document.execCommand('insertHTML', false, html);
        saveSelection();
        emitChange();
      }
      function command(name, payload) {
        if (name === 'insertTodo') insertHtml('<ul data-task-list="true"><li data-task-item="true"><input type="checkbox" /> </li></ul>');
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
          emitChange();
        } else if (name === 'undo' || name === 'redo') {
          editor.focus();
          document.execCommand(name, false);
          emitChange();
        }
      }
      window.xopcEditor = {
        focus: function () { editor.focus(); },
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
          emitChange();
        },
        setBottomInset: function (nextBottomInset) {
          var inset = Math.max(96, Math.round(Number(nextBottomInset) || 0));
          document.documentElement.style.setProperty('--xopc-editor-bottom-inset', inset + 'px');
        }
      };
      editor.addEventListener('input', scheduleEmit);
      editor.addEventListener('change', scheduleEmit);
      editor.addEventListener('focus', postState);
      editor.addEventListener('blur', function () { emitChange(); postState(); });
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
  const html = useMemo(
    () => nativeEditorHtml({
      markdown,
      attachmentSrcMap: attachmentSrcMap ?? {},
      theme,
      labels,
      bottomInset,
    }),
    // The WebView is keyed by noteId. Later markdown changes are pushed with injected JS.
    [noteId, theme, labels],
  );

  const inject = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(`${script}\ntrue;`);
  }, []);

  useImperativeHandle(ref, () => ({
    getMarkdown: () => latestMarkdownRef.current,
    focus: () => inject('window.xopcEditor && window.xopcEditor.focus();'),
    blur: () => inject('window.xopcEditor && window.xopcEditor.blur();'),
    insertTodo: () => inject('window.xopcEditor && window.xopcEditor.command("insertTodo");'),
    insertAttachment: (attachment) => {
      inject(`window.xopcEditor && window.xopcEditor.command("insertAttachment", ${JSON.stringify(attachment)});`);
    },
    setLink: (title, url) => {
      inject(`window.xopcEditor && window.xopcEditor.command("setLink", ${JSON.stringify({ title, url })});`);
    },
    removeLink: () => inject('window.xopcEditor && window.xopcEditor.command("removeLink");'),
    undo: () => inject('window.xopcEditor && window.xopcEditor.command("undo");'),
    redo: () => inject('window.xopcEditor && window.xopcEditor.command("redo");'),
  }), [inject]);

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
    }
    if ('markdown' in message && typeof message.markdown === 'string') {
      latestMarkdownRef.current = message.markdown;
      lastWebMarkdownRef.current = message.markdown;
      void onChangeMarkdown(message.markdown);
    }
    if (message.type === 'selection') {
      void onSelectionChange(message.context);
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

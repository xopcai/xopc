'use dom';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from 'tiptap-markdown';

import type {
  EditorAttachmentPickSource,
  EditorAttachmentPickResult,
  EditorCommand,
  EditorRuntimeState,
  EditorSelectionContext,
  NoteEditorLabels,
  NoteEditorTheme,
} from '../editor/editor-protocol';
import { DEFAULT_EDITOR_RUNTIME_STATE } from '../editor/editor-contract';
import {
  EMPTY_IMAGE_SRC,
  createXopcImage,
  isXopcAttachmentSrc,
} from './NoteEditorExtensions';

type DomProps = import('expo/dom').DOMProps;

export type NoteEditorAdapterCommand = EditorCommand | {
  id: number;
  type: 'requestMarkdownFlush';
  requestId: number;
};

export interface NoteEditorDomAdapterProps {
  noteId: string;
  initialMarkdown: string;
  attachmentSrcMap?: Record<string, string>;
  editable?: boolean;
  theme: NoteEditorTheme;
  labels: NoteEditorLabels;
  command?: NoteEditorAdapterCommand | null;
  bottomInset?: number;
  dom?: DomProps;
  onChangeMarkdown: (markdown: string) => Promise<void>;
  onSelectionChange: (context: EditorSelectionContext) => Promise<void>;
  onStateChange?: (state: EditorRuntimeState) => Promise<void> | void;
  onRequestAttachment: (source: EditorAttachmentPickSource) => Promise<EditorAttachmentPickResult>;
  onFlushMarkdown?: (requestId: number, markdown: string) => Promise<void> | void;
}

const MARKDOWN_SYNC_DELAY_MS = 1000;

function markdownFromEditor(editor: NonNullable<ReturnType<typeof useEditor>>): string {
  const storage = editor.storage as unknown as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? editor.getText();
}

function setEditorMarkdown(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  markdown: string,
): void {
  editor.commands.setContent(markdown, { emitUpdate: false });
}

function selectionContextFromEditor(editor: NonNullable<ReturnType<typeof useEditor>>): EditorSelectionContext {
  const { from, to } = editor.state.selection;
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const selectedText = editor.state.doc.textBetween(start, end, '\n').trim();
  const currentBlockText = editor.state.selection.$from.parent.textContent.trim();
  const documentText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n').trim();
  return {
    from: start,
    to: end,
    markdown: selectedText,
    currentBlockMarkdown: currentBlockText,
    beforeMarkdown: documentText.slice(0, 1200),
    afterMarkdown: documentText.slice(Math.max(0, documentText.length - 1200)),
  };
}

function editorRuntimeState(editor: NonNullable<ReturnType<typeof useEditor>>): EditorRuntimeState {
  try {
    const { from, to } = editor.state.selection;
    return {
      ready: !editor.isDestroyed,
      focused: editor.isFocused,
      selection: { from, to },
      canUndo: canEditorRun(editor, (can) => can.undo()),
      canRedo: canEditorRun(editor, (can) => can.redo()),
      todo: editor.isActive('taskList'),
      link: editor.isActive('link'),
      image: editor.isActive('image'),
    };
  } catch {
    return DEFAULT_EDITOR_RUNTIME_STATE;
  }
}

function canEditorRun(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  command: (can: ReturnType<NonNullable<ReturnType<typeof useEditor>>['can']>) => boolean,
): boolean {
  try {
    if (editor.isDestroyed) return false;
    return command(editor.can());
  } catch {
    return false;
  }
}

function getEditorDom(editor: NonNullable<ReturnType<typeof useEditor>>): HTMLElement | null {
  try {
    if (editor.isDestroyed) return null;
    return editor.view.dom;
  } catch {
    return null;
  }
}

function sanitizeLinkText(value: string): string {
  return value.replace(/[<>&]/g, '');
}

function isLikelyUrl(value: string): boolean {
  return /^(https?:\/\/|www\.)\S+\.\S+$/i.test(value) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\/?\S*$/i.test(value);
}

function normalizedUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^www\./i, 'www.')}`;
}

function linkNode(label: string, href: string) {
  return {
    type: 'text',
    text: sanitizeLinkText(label),
    marks: [{ type: 'link', attrs: { href } }],
  };
}

function audioTranscriptNode(text: string) {
  return {
    type: 'blockquote',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Voice memo: ${sanitizeLinkText(text)}` }],
      },
    ],
  };
}

export default function NoteEditorDomAdapter({
  noteId,
  initialMarkdown,
  attachmentSrcMap,
  editable = true,
  theme,
  labels,
  command,
  bottomInset = 120,
  onChangeMarkdown,
  onSelectionChange,
  onStateChange,
  onRequestAttachment,
  onFlushMarkdown,
}: NoteEditorDomAdapterProps) {
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachmentSrcMapRef = useRef<Record<string, string>>(attachmentSrcMap ?? {});
  const latestMarkdownRef = useRef(initialMarkdown);
  const lastSentMarkdownRef = useRef(initialMarkdown);
  const noteIdRef = useRef(noteId);
  const contentSeededRef = useRef(false);
  const editorDirtyRef = useRef(false);
  const onChangeMarkdownRef = useRef(onChangeMarkdown);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onStateChangeRef = useRef(onStateChange);
  const onFlushMarkdownRef = useRef(onFlushMarkdown);
  const handledCommandIdRef = useRef<number | null>(null);

  attachmentSrcMapRef.current = attachmentSrcMap ?? {};
  onChangeMarkdownRef.current = onChangeMarkdown;
  onSelectionChangeRef.current = onSelectionChange;
  onStateChangeRef.current = onStateChange;
  onFlushMarkdownRef.current = onFlushMarkdown;

  const XopcImage = useMemo(() => createXopcImage((canonicalSrc) => attachmentSrcMapRef.current[canonicalSrc]), []);

  const emitMarkdown = useCallback(async (nextEditor: NonNullable<ReturnType<typeof useEditor>>) => {
    const markdown = markdownFromEditor(nextEditor);
    latestMarkdownRef.current = markdown;
    if (lastSentMarkdownRef.current === markdown) {
      editorDirtyRef.current = false;
      return markdown;
    }
    lastSentMarkdownRef.current = markdown;
    editorDirtyRef.current = false;
    await onChangeMarkdownRef.current(markdown);
    return markdown;
  }, []);

  const scheduleMarkdownEmit = useCallback((nextEditor: NonNullable<ReturnType<typeof useEditor>>) => {
    editorDirtyRef.current = true;
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
    changeTimerRef.current = setTimeout(() => {
      changeTimerRef.current = null;
      void emitMarkdown(nextEditor);
    }, MARKDOWN_SYNC_DELAY_MS);
  }, [emitMarkdown]);

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        underline: false,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        autolink: true,
        openOnClick: false,
        HTMLAttributes: { class: 'xopc-editor-link' },
      }),
      XopcImage.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: 'xopc-editor-image' },
      }),
      Placeholder.configure({
        placeholder: labels.placeholder,
      }),
      Markdown.configure({
        html: true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'xopc-editor-content',
        autocapitalize: 'sentences',
        autocomplete: 'on',
        autocorrect: 'on',
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      void onStateChangeRef.current?.(editorRuntimeState(nextEditor));
      scheduleMarkdownEmit(nextEditor);
    },
    onSelectionUpdate: ({ editor: nextEditor }) => {
      void onStateChangeRef.current?.(editorRuntimeState(nextEditor));
      void onSelectionChangeRef.current(selectionContextFromEditor(nextEditor));
    },
    onFocus: ({ editor: nextEditor }) => {
      void onStateChangeRef.current?.(editorRuntimeState(nextEditor));
    },
    onBlur: ({ editor: nextEditor }) => {
      if (changeTimerRef.current) {
        clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
      if (editorDirtyRef.current) void emitMarkdown(nextEditor);
      void onStateChangeRef.current?.(editorRuntimeState(nextEditor));
    },
    onCreate: ({ editor: nextEditor }) => {
      void onStateChangeRef.current?.(editorRuntimeState(nextEditor));
    },
  }, [XopcImage, emitMarkdown, labels.placeholder, scheduleMarkdownEmit]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
    void onStateChangeRef.current?.(editorRuntimeState(editor));
  }, [editable, editor]);

  useEffect(() => {
    if (!editor) return;
    const root = getEditorDom(editor);
    if (!root) return;
    root.querySelectorAll<HTMLImageElement>('img[data-xopc-src]').forEach((img) => {
      const canonicalSrc = img.getAttribute('data-xopc-src') ?? '';
      const displaySrc = attachmentSrcMapRef.current[canonicalSrc];
      if (displaySrc && img.getAttribute('src') !== displaySrc) {
        img.setAttribute('src', displaySrc);
      } else if (!displaySrc && isXopcAttachmentSrc(canonicalSrc) && img.getAttribute('src') !== EMPTY_IMAGE_SRC) {
        img.setAttribute('src', EMPTY_IMAGE_SRC);
      }
    });
  }, [attachmentSrcMap, editor]);

  useEffect(() => {
    if (!editor) return;
    const noteChanged = noteIdRef.current !== noteId;
    const externalChanged = initialMarkdown !== latestMarkdownRef.current;
    const localClean = !editorDirtyRef.current && latestMarkdownRef.current === lastSentMarkdownRef.current;
    if (contentSeededRef.current && !noteChanged && (!externalChanged || !localClean)) return;
    contentSeededRef.current = true;
    noteIdRef.current = noteId;
    latestMarkdownRef.current = initialMarkdown;
    lastSentMarkdownRef.current = initialMarkdown;
    editorDirtyRef.current = false;
    setEditorMarkdown(editor, initialMarkdown);
    void onStateChangeRef.current?.(editorRuntimeState(editor));
  }, [editor, initialMarkdown, noteId]);

  useEffect(() => () => {
    if (changeTimerRef.current) {
      clearTimeout(changeTimerRef.current);
      changeTimerRef.current = null;
    }
    if (editor && editorDirtyRef.current) void emitMarkdown(editor);
  }, [editor, emitMarkdown]);

  const insertPreparedAttachment = useCallback((picked: NonNullable<EditorAttachmentPickResult>) => {
    if (!editor || !editable) return;
    const label = sanitizeLinkText(picked.alt?.trim() || 'attachment');
    if (picked.kind === 'document') {
      editor
        .chain()
        .focus()
        .insertContent(linkNode(label, picked.src))
        .run();
      void emitMarkdown(editor);
      return;
    }
    if (picked.kind === 'audio') {
      const content = [
        ...(picked.transcript?.trim() ? [audioTranscriptNode(picked.transcript.trim())] : []),
        {
          type: 'paragraph',
          content: [linkNode(label, picked.src)],
        },
      ];
      editor.chain().focus().insertContent(content).run();
      void emitMarkdown(editor);
      return;
    }
    if (picked.displaySrc) {
      attachmentSrcMapRef.current = {
        ...attachmentSrcMapRef.current,
        [picked.src]: picked.displaySrc,
      };
    }
    editor.chain().focus().setImage({ src: picked.src, alt: picked.alt }).run();
    void emitMarkdown(editor);
  }, [editable, editor, emitMarkdown]);

  const insertAttachment = useCallback(async (source: EditorAttachmentPickSource) => {
    if (!editor || !editable) return;
    const picked = await onRequestAttachment(source);
    if (!picked) return;
    insertPreparedAttachment(picked);
  }, [editable, editor, insertPreparedAttachment, onRequestAttachment]);

  const applyLink = useCallback((title: string, url: string) => {
    if (!editor || !editable) return;
    const href = normalizedUrl(url);
    if (!href || !isLikelyUrl(href)) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, ' ').trim();
    const label = (title.trim() || selected || href).trim();
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'text',
        text: sanitizeLinkText(label),
        marks: [{ type: 'link', attrs: { href } }],
      })
      .run();
  }, [editable, editor]);

  const removeLink = useCallback(() => {
    if (!editor || !editable) return;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
  }, [editable, editor]);

  const focusEditorFromSurface = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!editor) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, a')) return;
    const content = getEditorDom(editor);
    if (!content) return;
    if (target && content.contains(target)) return;
    if (target) {
      editor.commands.focus('end');
    }
  }, [editor]);

  useEffect(() => {
    if (!editor || !command || handledCommandIdRef.current === command.id) return;
    handledCommandIdRef.current = command.id;
    if (!editable && command.type !== 'requestMarkdownFlush') return;

    const requestMarkdownFlush = async (requestId: number) => {
      if (changeTimerRef.current) {
        clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
      let markdown = latestMarkdownRef.current;
      try {
        markdown = await emitMarkdown(editor);
      } catch {
        latestMarkdownRef.current = markdown;
      }
      await onFlushMarkdownRef.current?.(requestId, markdown);
    };

    switch (command.type) {
      case 'focus':
        editor.commands.focus(command.position ?? undefined);
        break;
      case 'toggleTaskList':
        editor.chain().focus().toggleTaskList().run();
        break;
      case 'insertAttachment':
        void insertAttachment(command.source);
        break;
      case 'insertPreparedAttachment':
        insertPreparedAttachment(command.attachment);
        break;
      case 'setLink':
        applyLink(command.title, command.url);
        break;
      case 'removeLink':
        removeLink();
        break;
      case 'undo':
        editor.chain().focus().undo().run();
        break;
      case 'redo':
        editor.chain().focus().redo().run();
        break;
      case 'requestMarkdownFlush':
        void requestMarkdownFlush(command.requestId);
        break;
    }

    void onStateChangeRef.current?.(editorRuntimeState(editor));
  }, [applyLink, command, editable, editor, emitMarkdown, insertAttachment, insertPreparedAttachment, removeLink]);

  return (
    <main
      className="xopc-editor-root"
      style={{
        '--xopc-bg': theme.background,
        '--xopc-panel': theme.panel,
        '--xopc-input': theme.input,
        '--xopc-text': theme.text,
        '--xopc-text-secondary': theme.textSecondary,
        '--xopc-text-tertiary': theme.textTertiary,
        '--xopc-border': theme.border,
        '--xopc-accent': theme.accent,
        '--xopc-accent-soft': theme.accentSoft,
        '--xopc-danger': theme.danger,
        '--xopc-editor-bottom-inset': `${Math.max(96, Math.round(bottomInset))}px`,
      } as React.CSSProperties}
    >
      <style>{EDITOR_CSS}</style>
      <section className="xopc-editor-scroll" data-editable={editable ? 'true' : 'false'} onPointerDown={focusEditorFromSurface}>
        <EditorContent editor={editor} />
      </section>
    </main>
  );
}

const EDITOR_CSS = `
html, body, #root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: var(--xopc-bg);
}
body {
  touch-action: pan-y;
  overscroll-behavior-y: contain;
}
* {
  box-sizing: border-box;
}
button, input {
  font: inherit;
}
.xopc-editor-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--xopc-bg);
  color: var(--xopc-text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
}
.xopc-editor-scroll {
  min-height: 0;
  flex: 1;
  height: 100%;
  overflow-x: hidden;
  overflow-y: scroll;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  padding: 14px 20px var(--xopc-editor-bottom-inset);
}
.xopc-editor-content {
  display: block;
  min-height: calc(100% - 40px);
  outline: none;
  font-size: 17px;
  line-height: 1.58;
  letter-spacing: 0;
  color: var(--xopc-text);
  padding-bottom: 24px;
}
.xopc-editor-scroll[data-editable="false"] .xopc-editor-content {
  cursor: default;
  caret-color: transparent;
}
.xopc-editor-content p {
  margin: 0.55em 0;
}
.xopc-editor-content h1,
.xopc-editor-content h2,
.xopc-editor-content h3 {
  line-height: 1.18;
  margin: 1.05em 0 0.4em;
  font-weight: 650;
}
.xopc-editor-content h1 {
  font-size: 28px;
}
.xopc-editor-content h2 {
  font-size: 23px;
}
.xopc-editor-content h3 {
  font-size: 19px;
}
.xopc-editor-content ul,
.xopc-editor-content ol {
  padding-left: 1.35em;
}
.xopc-editor-content ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0;
}
.xopc-editor-content li[data-type="taskItem"] {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0.45em 0;
}
.xopc-editor-content li[data-type="taskItem"] > label {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  min-width: 22px;
  margin-top: 0.2em;
  user-select: none;
}
.xopc-editor-content li[data-type="taskItem"] > label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--xopc-accent);
}
.xopc-editor-content li[data-type="taskItem"] > div {
  flex: 1;
  min-width: 0;
}
.xopc-editor-content li[data-type="taskItem"] > div > p {
  margin: 0;
}
.xopc-editor-content blockquote {
  margin: 0.8em 0;
  padding-left: 0.9em;
  border-left: 3px solid var(--xopc-border);
  color: var(--xopc-text-secondary);
}
.xopc-editor-content pre {
  overflow-x: auto;
  border-radius: 8px;
  padding: 12px;
  background: var(--xopc-input);
  font-size: 14px;
}
.xopc-editor-content code {
  border-radius: 5px;
  padding: 1px 4px;
  background: var(--xopc-input);
}
.xopc-editor-link {
  color: var(--xopc-accent);
}
.xopc-editor-content a[href^="xopc-attachment://"] {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  min-height: 32px;
  margin: 2px 0;
  padding: 5px 9px;
  border: 1px solid var(--xopc-border);
  border-radius: 8px;
  background: var(--xopc-input);
  text-decoration: none;
  vertical-align: middle;
}
.xopc-editor-content u {
  text-decoration-thickness: 1.5px;
  text-underline-offset: 0.16em;
}
.xopc-editor-image {
  display: block;
  max-width: 100%;
  border-radius: 8px;
  margin: 12px 0;
}
.xopc-editor-content .is-empty::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  color: var(--xopc-text-tertiary);
}
`;

'use dom';

import { useCallback, useEffect, useMemo, useRef, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from 'tiptap-markdown';
import {
  NOTE_LINK_OPTIONS,
  NOTE_MARKDOWN_OPTIONS,
  NOTE_STARTER_KIT_OPTIONS,
  NOTE_TASK_ITEM_OPTIONS,
  serializeNoteMarkdown,
} from '@xopcai/note-editor-core';

import type {
  EditorAttachmentPickSource,
  EditorAttachmentPickResult,
  EditorCommand,
  EditorFocusTarget,
  NoteEditorDraft,
  EditorRuntimeState,
  EditorSelectionContext,
  NoteEditorLabels,
  NoteEditorTheme,
} from '../editor/editor-protocol';
import { DEFAULT_EDITOR_RUNTIME_STATE } from '../editor/editor-contract';
import { resolveEditorLink, sanitizeEditorLinkText } from '../editor/editor-link';
import {
  CodeBlockLanguage,
  EMPTY_IMAGE_SRC,
  createXopcImage,
  isXopcAttachmentSrc,
} from './NoteEditorExtensions';

type DomProps = import('expo/dom').DOMProps;

export type NoteEditorAdapterCommand = EditorCommand | {
  id: number;
  type: 'requestDraftFlush';
  requestId: number;
};

export interface NoteEditorDomAdapterProps {
  noteId: string;
  initialTitle: string;
  initialMarkdown: string;
  titlePlaceholder: string;
  attachmentSrcMap?: Record<string, string>;
  editable?: boolean;
  theme: NoteEditorTheme;
  labels: NoteEditorLabels;
  command?: NoteEditorAdapterCommand | null;
  bottomInset?: number;
  dom?: DomProps;
  onChangeTitle: (title: string) => Promise<void>;
  onChangeMarkdown: (markdown: string) => Promise<void>;
  onSelectionChange?: (context: EditorSelectionContext) => Promise<void>;
  onStateChange?: (state: EditorRuntimeState) => Promise<void> | void;
  onRequestEdit?: () => Promise<void> | void;
  onRequestAttachment: (source: EditorAttachmentPickSource) => Promise<EditorAttachmentPickResult>;
  onFlushDraft?: (requestId: number, draft: NoteEditorDraft) => Promise<void> | void;
}

const MARKDOWN_SYNC_DELAY_MS = 700;
const TITLE_SYNC_DELAY_MS = 250;

function markdownFromEditor(editor: NonNullable<ReturnType<typeof useEditor>>): string {
  return serializeNoteMarkdown(editor);
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

function editorRuntimeState(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  focusTarget: EditorFocusTarget,
): EditorRuntimeState {
  try {
    const { from, to } = editor.state.selection;
    const headingLevel = ([1, 2, 3, 4] as const).find((level) => editor.isActive('heading', { level })) ?? 0;
    return {
      ready: !editor.isDestroyed,
      focused: focusTarget !== 'none' || editor.isFocused,
      focusTarget: focusTarget !== 'none' ? focusTarget : editor.isFocused ? 'body' : 'none',
      selection: { from, to },
      emptySelection: from === to,
      canUndo: canEditorRun(editor, (can) => can.undo()),
      canRedo: canEditorRun(editor, (can) => can.redo()),
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      headingLevel,
      bulletList: editor.isActive('bulletList'),
      taskList: editor.isActive('taskList'),
      blockquote: editor.isActive('blockquote'),
      codeBlock: editor.isActive('codeBlock'),
      link: editor.isActive('link'),
      image: editor.isActive('image'),
    };
  } catch {
    return DEFAULT_EDITOR_RUNTIME_STATE;
  }
}

function sameRuntimeUiState(a: EditorRuntimeState, b: EditorRuntimeState): boolean {
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

function linkNode(label: string, href: string) {
  return {
    type: 'text',
    text: sanitizeEditorLinkText(label),
    marks: [{ type: 'link', attrs: { href } }],
  };
}

function audioTranscriptNode(text: string) {
  return {
    type: 'blockquote',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Voice memo: ${sanitizeEditorLinkText(text)}` }],
      },
    ],
  };
}

export default function NoteEditorDomAdapter({
  noteId,
  initialTitle,
  initialMarkdown,
  titlePlaceholder,
  attachmentSrcMap,
  editable = true,
  theme,
  labels,
  command,
  bottomInset = 120,
  onChangeTitle,
  onChangeMarkdown,
  onSelectionChange,
  onStateChange,
  onRequestEdit,
  onRequestAttachment,
  onFlushDraft,
}: NoteEditorDomAdapterProps) {
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachmentSrcMapRef = useRef<Record<string, string>>(attachmentSrcMap ?? {});
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const latestTitleRef = useRef(initialTitle);
  const lastSentTitleRef = useRef(initialTitle);
  const latestMarkdownRef = useRef(initialMarkdown);
  const lastSentMarkdownRef = useRef(initialMarkdown);
  const noteIdRef = useRef(noteId);
  const titleNoteIdRef = useRef(noteId);
  const contentSeededRef = useRef(false);
  const titleSeededRef = useRef(false);
  const titleDirtyRef = useRef(false);
  const editorDirtyRef = useRef(false);
  const focusTargetRef = useRef<EditorFocusTarget>('none');
  const onChangeTitleRef = useRef(onChangeTitle);
  const onChangeMarkdownRef = useRef(onChangeMarkdown);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onStateChangeRef = useRef(onStateChange);
  const onFlushDraftRef = useRef(onFlushDraft);
  const handledCommandIdRef = useRef<number | null>(null);
  const pendingEditPositionRef = useRef<number | 'end' | null>(null);
  const initialBottomInsetRef = useRef(bottomInset);
  const lastRuntimeStateRef = useRef<EditorRuntimeState | null>(null);
  const runtimeStateFrameRef = useRef<number | null>(null);
  const pendingRuntimeEditorRef = useRef<NonNullable<ReturnType<typeof useEditor>> | null>(null);

  attachmentSrcMapRef.current = attachmentSrcMap ?? {};
  onChangeTitleRef.current = onChangeTitle;
  onChangeMarkdownRef.current = onChangeMarkdown;
  onSelectionChangeRef.current = onSelectionChange;
  onStateChangeRef.current = onStateChange;
  onFlushDraftRef.current = onFlushDraft;

  const XopcImage = useMemo(() => createXopcImage((canonicalSrc) => attachmentSrcMapRef.current[canonicalSrc]), []);

  const emitRuntimeState = useCallback((nextEditor: NonNullable<ReturnType<typeof useEditor>>) => {
    const nextState = editorRuntimeState(nextEditor, focusTargetRef.current);
    const previous = lastRuntimeStateRef.current;
    if (previous && sameRuntimeUiState(previous, nextState)) {
      lastRuntimeStateRef.current = nextState;
      return;
    }
    lastRuntimeStateRef.current = nextState;
    void onStateChangeRef.current?.(nextState);
  }, []);

  const scheduleRuntimeState = useCallback((nextEditor: NonNullable<ReturnType<typeof useEditor>>) => {
    pendingRuntimeEditorRef.current = nextEditor;
    if (runtimeStateFrameRef.current !== null) return;
    runtimeStateFrameRef.current = window.requestAnimationFrame(() => {
      runtimeStateFrameRef.current = null;
      const pendingEditor = pendingRuntimeEditorRef.current;
      pendingRuntimeEditorRef.current = null;
      if (pendingEditor && !pendingEditor.isDestroyed) emitRuntimeState(pendingEditor);
    });
  }, [emitRuntimeState]);

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

  const emitTitle = useCallback(async () => {
    const title = latestTitleRef.current;
    if (lastSentTitleRef.current === title) {
      titleDirtyRef.current = false;
      return title;
    }
    lastSentTitleRef.current = title;
    titleDirtyRef.current = false;
    await onChangeTitleRef.current(title);
    return title;
  }, []);

  const scheduleMarkdownEmit = useCallback((nextEditor: NonNullable<ReturnType<typeof useEditor>>) => {
    editorDirtyRef.current = true;
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
    changeTimerRef.current = setTimeout(() => {
      changeTimerRef.current = null;
      void emitMarkdown(nextEditor);
    }, MARKDOWN_SYNC_DELAY_MS);
  }, [emitMarkdown]);

  const scheduleTitleEmit = useCallback(() => {
    titleDirtyRef.current = true;
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => {
      titleTimerRef.current = null;
      void emitTitle();
    }, TITLE_SYNC_DELAY_MS);
  }, [emitTitle]);

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure(NOTE_STARTER_KIT_OPTIONS),
      CodeBlockLanguage,
      TaskList,
      TaskItem.configure(NOTE_TASK_ITEM_OPTIONS),
      Link.configure({
        ...NOTE_LINK_OPTIONS,
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
      Markdown.configure(NOTE_MARKDOWN_OPTIONS),
    ],
    content: '',
    editorProps: {
      scrollThreshold: 28,
      scrollMargin: {
        top: 16,
        right: 0,
        bottom: Math.max(96, Math.round(initialBottomInsetRef.current)),
        left: 0,
      },
      attributes: {
        class: 'xopc-editor-content',
        autocapitalize: 'sentences',
        autocomplete: 'on',
        autocorrect: 'on',
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      scheduleRuntimeState(nextEditor);
      scheduleMarkdownEmit(nextEditor);
    },
    onSelectionUpdate: ({ editor: nextEditor }) => {
      scheduleRuntimeState(nextEditor);
      if (onSelectionChangeRef.current) {
        void onSelectionChangeRef.current(selectionContextFromEditor(nextEditor));
      }
    },
    onFocus: ({ editor: nextEditor }) => {
      focusTargetRef.current = 'body';
      emitRuntimeState(nextEditor);
    },
    onBlur: ({ editor: nextEditor }) => {
      if (changeTimerRef.current) {
        clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
      if (editorDirtyRef.current) void emitMarkdown(nextEditor);
      if (focusTargetRef.current === 'body') focusTargetRef.current = 'none';
      emitRuntimeState(nextEditor);
    },
    onCreate: ({ editor: nextEditor }) => {
      emitRuntimeState(nextEditor);
    },
  }, [XopcImage, emitMarkdown, emitRuntimeState, labels.placeholder, scheduleMarkdownEmit, scheduleRuntimeState]);

  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        scrollThreshold: 28,
        scrollMargin: {
          top: 16,
          right: 0,
          bottom: Math.max(96, Math.round(bottomInset)),
          left: 0,
        },
      },
    });
  }, [bottomInset, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
    if (!editable) {
      pendingEditPositionRef.current = null;
      focusTargetRef.current = 'none';
      editor.commands.blur();
    } else if (pendingEditPositionRef.current !== null) {
      const position = pendingEditPositionRef.current;
      pendingEditPositionRef.current = null;
      focusTargetRef.current = 'body';
      editor.commands.focus(position);
    }
    emitRuntimeState(editor);
  }, [editable, editor, emitRuntimeState]);

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

    let cancelled = false;
    let frame: number | null = null;

    const seedContent = () => {
      if (cancelled || editor.isDestroyed) return;
      const initialized = (editor as unknown as { isEditorContentInitialized?: boolean }).isEditorContentInitialized;
      if (!initialized) {
        frame = window.requestAnimationFrame(seedContent);
        return;
      }

      contentSeededRef.current = true;
      noteIdRef.current = noteId;
      latestMarkdownRef.current = initialMarkdown;
      lastSentMarkdownRef.current = initialMarkdown;
      editorDirtyRef.current = false;
      setEditorMarkdown(editor, initialMarkdown);
      lastRuntimeStateRef.current = null;
      emitRuntimeState(editor);
    };

    seedContent();

    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [editor, emitRuntimeState, initialMarkdown, noteId]);

  useEffect(() => {
    const noteChanged = titleNoteIdRef.current !== noteId;
    const externalChanged = initialTitle !== latestTitleRef.current;
    const localClean = !titleDirtyRef.current && latestTitleRef.current === lastSentTitleRef.current;
    if (titleSeededRef.current && !noteChanged && (!externalChanged || !localClean)) return;
    titleSeededRef.current = true;
    titleNoteIdRef.current = noteId;
    latestTitleRef.current = initialTitle;
    lastSentTitleRef.current = initialTitle;
    titleDirtyRef.current = false;
    if (titleInputRef.current && titleInputRef.current.value !== initialTitle) {
      titleInputRef.current.value = initialTitle;
    }
  }, [initialTitle, noteId]);

  useEffect(() => () => {
    if (runtimeStateFrameRef.current !== null) {
      window.cancelAnimationFrame(runtimeStateFrameRef.current);
      runtimeStateFrameRef.current = null;
    }
    if (changeTimerRef.current) {
      clearTimeout(changeTimerRef.current);
      changeTimerRef.current = null;
    }
    if (titleTimerRef.current) {
      clearTimeout(titleTimerRef.current);
      titleTimerRef.current = null;
    }
    if (editor && editorDirtyRef.current) void emitMarkdown(editor);
    if (titleDirtyRef.current) void emitTitle();
  }, [editor, emitMarkdown, emitTitle]);

  const handleTitleInput = useCallback((event: FormEvent<HTMLTextAreaElement>) => {
    latestTitleRef.current = event.currentTarget.value;
    scheduleTitleEmit();
  }, [scheduleTitleEmit]);

  const handleTitleFocus = useCallback(() => {
    focusTargetRef.current = 'title';
    if (editor) emitRuntimeState(editor);
  }, [editor, emitRuntimeState]);

  const handleTitleBlur = useCallback(() => {
    if (titleTimerRef.current) {
      clearTimeout(titleTimerRef.current);
      titleTimerRef.current = null;
    }
    if (titleDirtyRef.current) void emitTitle();
    if (focusTargetRef.current === 'title') focusTargetRef.current = 'none';
    if (editor) emitRuntimeState(editor);
  }, [editor, emitRuntimeState, emitTitle]);

  const handleTitleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || !editor) return;
    event.preventDefault();
    if (titleTimerRef.current) {
      clearTimeout(titleTimerRef.current);
      titleTimerRef.current = null;
    }
    void emitTitle();
    focusTargetRef.current = 'body';
    editor.commands.focus('start');
  }, [editor, emitTitle]);

  const insertPreparedAttachment = useCallback((picked: NonNullable<EditorAttachmentPickResult>) => {
    if (!editor || !editable) return;
    const label = sanitizeEditorLinkText(picked.alt?.trim() || 'attachment');
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
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, ' ').trim();
    const resolved = resolveEditorLink(title, url, selected);
    if (!resolved) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'text',
        text: resolved.title,
        marks: [{ type: 'link', attrs: { href: resolved.url } }],
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
    if (!editable) {
      pendingEditPositionRef.current = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      })?.pos ?? 'end';
      void onRequestEdit?.();
      return;
    }
    const content = getEditorDom(editor);
    if (!content) return;
    if (target && content.contains(target)) return;
    if (target) {
      editor.commands.focus('end');
    }
  }, [editable, editor, onRequestEdit]);

  useEffect(() => {
    if (!editor || !command || handledCommandIdRef.current === command.id) return;
    handledCommandIdRef.current = command.id;
    if (!editable && command.type !== 'requestDraftFlush') return;

    const requestDraftFlush = async (requestId: number) => {
      if (changeTimerRef.current) {
        clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
      if (titleTimerRef.current) {
        clearTimeout(titleTimerRef.current);
        titleTimerRef.current = null;
      }
      let markdown = latestMarkdownRef.current;
      let title = latestTitleRef.current;
      try {
        [title, markdown] = await Promise.all([emitTitle(), emitMarkdown(editor)]);
      } catch {
        latestMarkdownRef.current = markdown;
        latestTitleRef.current = title;
      }
      await onFlushDraftRef.current?.(requestId, { title, markdown });
    };

    switch (command.type) {
      case 'focus':
        if (command.target === 'title') {
          focusTargetRef.current = 'title';
          titleInputRef.current?.focus();
        } else {
          focusTargetRef.current = 'body';
          editor.commands.focus(command.position ?? undefined);
        }
        break;
      case 'blur':
        editor.commands.blur();
        break;
      case 'setHeading':
        if (command.level === 0) {
          editor.chain().focus().setParagraph().run();
        } else {
          editor.chain().focus().toggleHeading({ level: command.level }).run();
        }
        break;
      case 'toggleBold':
        editor.chain().focus().toggleBold().run();
        break;
      case 'toggleItalic':
        editor.chain().focus().toggleItalic().run();
        break;
      case 'toggleBulletList':
        editor.chain().focus().toggleBulletList().run();
        break;
      case 'toggleTaskList':
        editor.chain().focus().toggleTaskList().run();
        break;
      case 'toggleBlockquote':
        editor.chain().focus().toggleBlockquote().run();
        break;
      case 'toggleCodeBlock':
        editor.chain().focus().toggleCodeBlock().run();
        break;
      case 'insertDivider':
        editor.chain().focus().setHorizontalRule().run();
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
      case 'requestDraftFlush':
        void requestDraftFlush(command.requestId);
        break;
    }

    emitRuntimeState(editor);
  }, [applyLink, command, editable, editor, emitMarkdown, emitRuntimeState, insertAttachment, insertPreparedAttachment, removeLink]);

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
        <header className="xopc-editor-header">
          <textarea
            key={noteId}
            ref={titleInputRef}
            className="xopc-editor-title"
            defaultValue={initialTitle}
            rows={1}
            placeholder={titlePlaceholder}
            aria-label="Note title"
            readOnly={!editable}
            onInput={handleTitleInput}
            onFocus={handleTitleFocus}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
          />
        </header>
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
  scroll-padding-bottom: var(--xopc-editor-bottom-inset);
  padding: 14px 20px var(--xopc-editor-bottom-inset);
}
.xopc-editor-header {
  margin: 0 0 8px;
}
.xopc-editor-title {
  display: block;
  width: 100%;
  min-height: 42px;
  max-height: 116px;
  resize: none;
  overflow: hidden;
  border: 0;
  outline: none;
  padding: 0;
  background: transparent;
  color: var(--xopc-text);
  font: 760 32px/1.16 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
  letter-spacing: -0.45px;
}
.xopc-editor-title::placeholder {
  color: var(--xopc-text-tertiary);
  opacity: 1;
}
.xopc-editor-scroll[data-editable="false"] .xopc-editor-title {
  caret-color: transparent;
}
.xopc-editor-content {
  display: block;
  min-height: calc(100% - 40px);
  outline: none;
  font-size: 16px;
  line-height: 1.42;
  letter-spacing: 0;
  color: var(--xopc-text);
  padding-bottom: 24px;
  scroll-margin-bottom: var(--xopc-editor-bottom-inset);
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
.xopc-editor-content h3,
.xopc-editor-content h4 {
  line-height: 1.18;
  margin: 1.05em 0 0.4em;
  font-weight: 650;
}
.xopc-editor-content h1 {
  font-size: 32px;
  font-weight: 760;
}
.xopc-editor-content h2 {
  font-size: 23px;
}
.xopc-editor-content h3 {
  font-size: 19px;
}
.xopc-editor-content h4 {
  font-size: 17px;
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
  padding: 14px 16px;
  border-left: 0;
  border-radius: 14px;
  color: var(--xopc-text);
  background: var(--xopc-accent-soft);
}
.xopc-editor-content blockquote:before {
  content: "✦";
  color: var(--xopc-accent);
  margin-right: 10px;
}
.xopc-editor-content pre {
  overflow-x: auto;
  border-radius: 14px;
  padding: 14px;
  background: var(--xopc-input);
  font-size: 14px;
}
.xopc-editor-content code {
  border-radius: 5px;
  padding: 1px 4px;
  background: var(--xopc-input);
}
.xopc-editor-content hr {
  border: 0;
  height: 1px;
  margin: 20px 0;
  background: var(--xopc-border);
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

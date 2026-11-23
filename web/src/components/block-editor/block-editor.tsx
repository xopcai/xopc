import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import {
  NOTE_LINK_OPTIONS,
  NOTE_MARKDOWN_OPTIONS,
  NOTE_STARTER_KIT_OPTIONS,
  NOTE_TASK_ITEM_OPTIONS,
  serializeNoteMarkdown,
} from '@xopcai/note-editor-core';

import { cn } from '@/lib/cn';
import type { EditorTextSelection } from '@/components/editor-text-selection';
import { messages } from '@/i18n/messages';
import { useAppLinkOpener } from '@/lib/use-app-link-opener';
import { useLocaleStore } from '@/stores/locale-store';

import { noteAttachmentRef, uploadNoteMedia, type NoteAttachment } from '@/features/notes/notes-api';

import { AudioNode } from './extensions/audio-node';
import { CalloutDecorations } from './extensions/callout-decorations';
import { InlineMath, BlockMath } from './extensions/math-node';
import { DiagramCodeBlock } from './extensions/diagram-code-block';
import { focusAfterBlockInsert } from './extensions/block-insert-focus';
import { ExtraKeyboardShortcuts } from './extensions/keyboard-shortcuts';
import { NoteWikiLinks } from './extensions/note-wiki-links';
import { SlashCommands } from './extensions/slash-commands';
import { TableExtensions } from './extensions/table-nodes';
import { BlockTrailingNode } from './extensions/trailing-node';
import { InlineVoiceRecorder } from './inline-voice-recorder';
import { BlockEditorToolbar } from './toolbar';
import { ResizableImage } from './extensions/resizable-image';
import { LinkBubbleMenu } from './link-bubble-menu';
import { applyLinkHref, modifiedClickLinkHref } from './link-interaction';
import type { SlashCommandRuntime } from './slash-items';

import './block-editor.css';

export interface BlockEditorProps {
  /** Markdown content to initialize the editor with. */
  initialContent: string;
  /** Called on every content change with the serialized Markdown string. */
  onChange: (markdown: string) => void;
  /** Placeholder text shown when the editor is empty. */
  placeholder?: string;
  className?: string;
  documentHeader?: React.ReactNode;
  autoFocus?: boolean;
  /** Note ID for image/file upload endpoint. */
  noteId?: string;
  /** Known note attachments for rich audio vs file card rendering. */
  attachments?: NoteAttachment[];
  onAttachmentUploaded?: (attachment: NoteAttachment) => void;
  onTextSelection?: (selection: EditorTextSelection | null) => void;
}

function isEmptyParagraphAtDocEdge(
  editor: { state: { doc: { childCount: number; resolve: (pos: number) => { index: (depth: number) => number } } } },
  pos: number,
): 'first' | 'last' | null {
  const { doc } = editor.state;
  const $pos = doc.resolve(pos);
  if ($pos.index(0) === 0) {
    return 'first';
  }
  if ($pos.index(0) === doc.childCount - 1) {
    return 'last';
  }
  return null;
}

export function BlockEditor({
  initialContent,
  onChange,
  placeholder = 'Start writing, or type "/" for commands…',
  className,
  documentHeader,
  autoFocus = false,
  noteId,
  attachments,
  onAttachmentUploaded,
  onTextSelection,
}: BlockEditorProps) {
  const language = useLocaleStore((s) => s.language);
  const zh = language === 'zh';
  const notesLabels = messages(language).notes;
  const openAppLink = useAppLinkOpener();
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [voiceRecorderOpen, setVoiceRecorderOpen] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const languageRef = useRef(language);
  languageRef.current = language;
  const [localAttachments, setLocalAttachments] = useState<NoteAttachment[]>([]);
  const attachmentsRef = useRef<NoteAttachment[] | undefined>(attachments);
  attachmentsRef.current = attachments
    ? [...attachments, ...localAttachments.filter((item) => !attachments.some((a) => a.id === item.id))]
    : localAttachments.length > 0
      ? localAttachments
      : undefined;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const selectionCallback = useRef(onTextSelection);
  selectionCallback.current = onTextSelection;
  const [scrollTarget, setScrollTarget] = useState<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashRuntimeRef = useRef<SlashCommandRuntime>({});
  const uploadImageFileRef = useRef<(file: File) => void>(() => undefined);
  const uploadAttachmentFileRef = useRef<(file: File) => void>(() => undefined);
  const latestMarkdownRef = useRef(initialContent);
  const lastSentMarkdownRef = useRef(initialContent);
  const contentSeededRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        ...NOTE_STARTER_KIT_OPTIONS,
        codeBlock: false,
        trailingNode: false,
      }),
      ...TableExtensions,
      DiagramCodeBlock.configure({ HTMLAttributes: { class: 'block-editor-code' } }),
      BlockTrailingNode,
      ResizableImage.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: 'block-editor-image' },
      }),
      TaskList,
      TaskItem.configure(NOTE_TASK_ITEM_OPTIONS),
      Placeholder.configure({
        placeholder: ({ editor: editorInstance, node, pos }) => {
          if (node.type.name !== 'paragraph' || node.content.size > 0) {
            return '';
          }
          const edge = isEmptyParagraphAtDocEdge(editorInstance, pos);
          if (edge === 'first' || edge === 'last') {
            return placeholder;
          }
          return '';
        },
        includeChildren: true,
      }),
      Link.configure({
        ...NOTE_LINK_OPTIONS,
        HTMLAttributes: { class: 'block-editor-link' },
      }),
      InlineMath, BlockMath,
      Markdown.configure(NOTE_MARKDOWN_OPTIONS),
      AudioNode.configure({
        getAttachments: () => attachmentsRef.current,
      }),
      CalloutDecorations,
      ExtraKeyboardShortcuts,
      NoteWikiLinks.configure({
        getCurrentNoteId: () => noteIdRef.current,
        getLocale: () => languageRef.current,
      }),
      SlashCommands.configure({
        getRuntime: () => slashRuntimeRef.current,
      }),
    ],
    content: '',
    onUpdate: ({ editor: editorInstance }) => {
      selectionCallback.current?.(null);
      const markdownContent = serializeNoteMarkdown(editorInstance);
      latestMarkdownRef.current = markdownContent;
      lastSentMarkdownRef.current = markdownContent;
      onChangeRef.current(markdownContent);
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to, empty } = current.state.selection;
      const text = current.state.doc.textBetween(from, to, '\n');
      if (empty || !text.trim() || !current.view.hasFocus()) { selectionCallback.current?.(null); return; }
      const document = current.state.doc;
      const start = current.view.coordsAtPos(from); const end = current.view.coordsAtPos(to);
      const resolved = document.resolve(to);
      const insertAt = resolved.depth ? resolved.after(1) : to;
      selectionCallback.current?.({ text,
        rect: { left: Math.min(start.left,end.left), right: Math.max(start.right,end.right), top: start.top, bottom: end.bottom },
        insertAfter: markdown => {
          if (current.isDestroyed || !current.state.doc.eq(document)) return false;
          return current.chain().focus().insertContentAt(insertAt, markdown).run();
        },
        replaceSelection: markdown => {
          if (current.isDestroyed || !current.state.doc.eq(document)) return false;
          return current.chain().focus().insertContentAt({ from, to }, markdown).run();
        },
        restore: () => { if (!current.isDestroyed && current.state.doc.eq(document)) current.chain().focus().setTextSelection({ from, to }).run(); },
      });
    },
    editorProps: {
      attributes: {
        class: 'block-editor-content',
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;

        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) uploadImageFileRef.current(file);
            return true;
          }
        }
        return false;
      },
      handleClick: (_view, _pos, event) => {
        const href = modifiedClickLinkHref(event);
        if (!href) return false;
        event.preventDefault();
        void openAppLink(href);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;

        for (const file of files) {
          if (file.type.startsWith('image/')) {
            event.preventDefault();
            uploadImageFileRef.current(file);
            return true;
          }
          event.preventDefault();
          uploadAttachmentFileRef.current(file);
          return true;
        }
        return false;
      },
    },
  });

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (!noteId || !editor) return;

      try {
        setImageUploading(true);
        setImageUploadError(null);
        const attachment = await uploadNoteMedia(noteId, file);
        setLocalAttachments((prev) => [...prev, attachment]);
        onAttachmentUploaded?.(attachment);
        editor
          .chain()
          .focus()
          .setImage({ src: noteAttachmentRef(noteId, attachment.id), alt: file.name })
          .run();
        focusAfterBlockInsert(editor);
      } catch (err) {
        setImageUploadError(err instanceof Error ? err.message : notesLabels.imageUploadFailedHint);
      } finally {
        setImageUploading(false);
      }
    },
    [editor, noteId, notesLabels.imageUploadFailedHint, onAttachmentUploaded],
  );

  const handleAttachmentUpload = useCallback(
    async (file: File) => {
      if (!noteId || !editor) return;
      if (file.type.startsWith('image/')) {
        await handleImageUpload(file);
        return;
      }
      try {
        setImageUploading(true);
        setImageUploadError(null);
        const attachment = await uploadNoteMedia(noteId, file);
        setLocalAttachments((prev) => [...prev, attachment]);
        onAttachmentUploaded?.(attachment);
        const href = noteAttachmentRef(noteId, attachment.id);
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'audioAttachment',
            attrs: { href, label: file.name },
          })
          .run();
        focusAfterBlockInsert(editor);
      } catch (err) {
        setImageUploadError(err instanceof Error ? err.message : notesLabels.imageUploadFailedHint);
      } finally {
        setImageUploading(false);
      }
    },
    [editor, handleImageUpload, noteId, notesLabels.imageUploadFailedHint, onAttachmentUploaded],
  );

  uploadImageFileRef.current = (file: File) => {
    void handleImageUpload(file);
  };
  uploadAttachmentFileRef.current = (file: File) => {
    void handleAttachmentUpload(file);
  };

  const requestImagePicker = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const requestFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const openLinkDialog = useCallback(() => {
    if (!editor) return;
    const currentHref = String(editor.getAttributes('link').href ?? '');
    setLinkDraft(currentHref);
    setLinkDialogOpen(true);
    window.requestAnimationFrame(() => linkInputRef.current?.focus());
  }, [editor]);

  slashRuntimeRef.current = {
    locale: language,
    onImageUpload: noteId ? handleImageUpload : undefined,
    requestImagePicker: noteId ? requestImagePicker : undefined,
    requestFilePicker: noteId ? requestFilePicker : undefined,
    requestVoiceRecord: noteId ? () => setVoiceRecorderOpen(true) : undefined,
  };

  useEffect(() => {
    if (!editor) return;
    const externalChanged = initialContent !== latestMarkdownRef.current;
    const localClean = latestMarkdownRef.current === lastSentMarkdownRef.current;
    if (contentSeededRef.current && (!externalChanged || !localClean)) return;

    let cancelled = false;
    let frame: number | null = null;
    const markdown = initialContent;

    const seedContent = () => {
      if (cancelled || editor.isDestroyed) return;
      const initialized = (editor as unknown as { isEditorContentInitialized?: boolean }).isEditorContentInitialized;
      if (!initialized) {
        frame = window.requestAnimationFrame(seedContent);
        return;
      }

      editor.commands.setContent(markdown, { emitUpdate: false });
      latestMarkdownRef.current = markdown;
      lastSentMarkdownRef.current = markdown;
      contentSeededRef.current = true;
    };

    seedContent();

    return () => {
      cancelled = true;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [editor, initialContent]);

  useEffect(() => {
    if (!editor || !autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.focus('end');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor, autoFocus]);

  if (!editor) return null;

  return (
    <div className={cn('flex h-full min-w-0 flex-col overflow-hidden', className)}>
      <BlockEditorToolbar
        editor={editor}
        onImageUpload={noteId ? handleImageUpload : undefined}
        onFileUpload={noteId ? handleAttachmentUpload : undefined}
        onVoiceRecord={noteId ? () => setVoiceRecorderOpen((prev) => !prev) : undefined}
        voiceRecording={voiceRecorderOpen}
        imageUploading={imageUploading}
        onRequestLinkEdit={openLinkDialog}
      />
      {voiceRecorderOpen && noteId ? (
        <InlineVoiceRecorder
          noteId={noteId}
          onInserted={({ attachment, href, label }) => {
            setVoiceRecorderOpen(false);
            setLocalAttachments((prev) => [...prev, attachment]);
            onAttachmentUploaded?.(attachment);
            editor
              .chain()
              .focus()
              .insertContent({
                type: 'audioAttachment',
                attrs: { href, label },
              })
              .run();
            focusAfterBlockInsert(editor);
          }}
          onCancel={() => {
            setVoiceRecorderOpen(false);
            editor.commands.focus();
          }}
        />
      ) : null}
      {linkDialogOpen ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            applyLinkHref(editor, linkDraft);
            setLinkDialogOpen(false);
          }}
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-subtle bg-surface-inset px-4 py-2 text-xs"
        >
          <span className="font-medium text-fg-muted">{zh ? '链接地址' : 'Link URL'}</span>
          <input
            ref={linkInputRef}
            type="text"
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setLinkDialogOpen(false);
                editor.commands.focus();
              }
            }}
            placeholder="https://..."
            aria-label={zh ? '链接地址' : 'Link URL'}
            className="h-8 min-w-48 flex-1 rounded-md border border-edge bg-surface-panel px-2.5 text-xs text-fg outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="h-8 rounded-md bg-accent px-3 font-medium text-on-accent hover:bg-accent-hover"
          >
            {zh ? '确定' : 'Apply'}
          </button>
          {editor.isActive('link') ? (
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setLinkDialogOpen(false);
              }}
              className="h-8 rounded-md px-2.5 text-danger hover:bg-danger-soft"
            >
              {zh ? '移除' : 'Remove'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setLinkDialogOpen(false);
              editor.commands.focus();
            }}
            className="h-8 rounded-md px-2.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            {zh ? '取消' : 'Cancel'}
          </button>
        </form>
      ) : null}
      {imageUploadError ? (
        <div className="border-b border-danger/20 bg-danger-soft px-6 py-2 text-xs text-danger" role="alert">
          <span className="font-medium">{notesLabels.imageUploadFailed}</span> · {imageUploadError}
        </div>
      ) : null}
      <div ref={setScrollTarget} data-note-outline-scroll={noteId ? true : undefined} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className={cn('flex min-h-full min-w-0 flex-col px-5 py-4 sm:px-6', documentHeader && 'mx-auto w-full max-w-3xl pt-6 sm:px-10 sm:pt-9')}>
          {documentHeader && <div className="mb-5 shrink-0">{documentHeader}</div>}
          <EditorContent editor={editor} className="flex min-w-0 flex-1 flex-col [&>.ProseMirror]:flex-1" />
        </div>
      </div>
      {scrollTarget && (
        <LinkBubbleMenu
          editor={editor}
          scrollTarget={scrollTarget}
          labels={{
            open: notesLabels.linkOpen,
            edit: notesLabels.linkEdit,
            copy: notesLabels.linkCopy,
            copied: notesLabels.linkCopied,
            remove: notesLabels.linkRemove,
            openFailed: notesLabels.linkOpenFailed,
          }}
        />
      )}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && noteId) {
            void handleImageUpload(file);
          }
          if (imageInputRef.current) {
            imageInputRef.current.value = '';
          }
        }}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && noteId) {
            void handleAttachmentUpload(file);
          }
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }}
        className="hidden"
      />
    </div>
  );
}

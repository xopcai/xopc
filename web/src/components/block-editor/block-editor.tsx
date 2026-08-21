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
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { noteAttachmentRef, uploadNoteMedia } from '@/features/notes/notes-api';

import { AudioNode } from './extensions/audio-node';
import { focusAfterBlockInsert } from './extensions/block-insert-focus';
import { ExtraKeyboardShortcuts } from './extensions/keyboard-shortcuts';
import { SlashCommands } from './extensions/slash-commands';
import { BlockTrailingNode } from './extensions/trailing-node';
import { BlockEditorToolbar } from './toolbar';
import { ResizableImage } from './extensions/resizable-image';
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
  /** Note ID for image upload endpoint. */
  noteId?: string;
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
  noteId,
}: BlockEditorProps) {
  const language = useLocaleStore((s) => s.language);
  const notesLabels = messages(language).notes;
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const imageInputRef = useRef<HTMLInputElement>(null);
  const slashRuntimeRef = useRef<SlashCommandRuntime>({});
  const uploadImageFileRef = useRef<(file: File) => void>(() => undefined);
  const latestMarkdownRef = useRef(initialContent);
  const lastSentMarkdownRef = useRef(initialContent);
  const contentSeededRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        ...NOTE_STARTER_KIT_OPTIONS,
        codeBlock: { HTMLAttributes: { class: 'block-editor-code' } },
      }),
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
      Markdown.configure(NOTE_MARKDOWN_OPTIONS),
      AudioNode,
      ExtraKeyboardShortcuts,
      SlashCommands.configure({
        getRuntime: () => slashRuntimeRef.current,
      }),
    ],
    content: '',
    onUpdate: ({ editor: editorInstance }) => {
      const markdownContent = serializeNoteMarkdown(editorInstance);
      latestMarkdownRef.current = markdownContent;
      lastSentMarkdownRef.current = markdownContent;
      onChangeRef.current(markdownContent);
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
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;

        for (const file of files) {
          if (file.type.startsWith('image/')) {
            event.preventDefault();
            uploadImageFileRef.current(file);
            return true;
          }
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
    [editor, noteId, notesLabels.imageUploadFailed, notesLabels.imageUploadFailedHint],
  );

  uploadImageFileRef.current = (file: File) => {
    void handleImageUpload(file);
  };

  const requestImagePicker = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  slashRuntimeRef.current = {
    onImageUpload: noteId ? handleImageUpload : undefined,
    requestImagePicker: noteId ? requestImagePicker : undefined,
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

  if (!editor) return null;

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      <BlockEditorToolbar
        editor={editor}
        onImageUpload={noteId ? handleImageUpload : undefined}
        imageUploading={imageUploading}
      />
      {imageUploadError ? (
        <div className="border-b border-danger/20 bg-danger-soft px-6 py-2 text-xs text-danger" role="alert">
          <span className="font-medium">{notesLabels.imageUploadFailed}</span> · {imageUploadError}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <EditorContent editor={editor} />
      </div>
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
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';

import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { showToast } from '@/lib/toast';
import { useLocaleStore } from '@/stores/locale-store';

import { noteAttachmentRef, uploadNoteMedia } from '@/features/notes/notes-api';

import { AudioNode } from './extensions/audio-node';
import { ExtraKeyboardShortcuts } from './extensions/keyboard-shortcuts';
import { BlockEditorToolbar } from './toolbar';
import { ResizableImage } from './extensions/resizable-image';
import { SlashMenu } from './slash-menu';

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
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'block-editor-code' } },
      }),
      ResizableImage.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: 'block-editor-image' },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: 'block-editor-link' },
      }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      AudioNode,
      ExtraKeyboardShortcuts,
    ],
    content: initialContent,
    onUpdate: ({ editor: editorInstance }) => {
      const markdownContent = (editorInstance.storage as any).markdown.getMarkdown();
      onChangeRef.current(markdownContent);
    },
    editorProps: {
      attributes: {
        class: 'block-editor-content',
      },
    },
  });

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (!noteId || !editor) return;

      try {
        setImageUploading(true);
        const attachment = await uploadNoteMedia(noteId, file);
        editor
          .chain()
          .focus()
          .setImage({ src: noteAttachmentRef(noteId, attachment.id), alt: file.name })
          .run();
      } catch (err) {
        showToast({
          type: 'error',
          title: notesLabels.imageUploadFailed,
          message: err instanceof Error ? err.message : notesLabels.imageUploadFailedHint,
        });
      } finally {
        setImageUploading(false);
      }
    },
    [editor, noteId, notesLabels.imageUploadFailed, notesLabels.imageUploadFailedHint],
  );

  // Handle paste/drop images
  useEffect(() => {
    if (!editor || !noteId) return;

    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) void handleImageUpload(file);
          return;
        }
      }
    };

    const handleDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files;
      if (!files?.length) return;

      for (const file of files) {
        if (file.type.startsWith('image/')) {
          event.preventDefault();
          void handleImageUpload(file);
          return;
        }
      }
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener('paste', handlePaste);
    editorElement.addEventListener('drop', handleDrop);

    return () => {
      editorElement.removeEventListener('paste', handlePaste);
      editorElement.removeEventListener('drop', handleDrop);
    };
  }, [editor, noteId, handleImageUpload]);

  if (!editor) return null;

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      <BlockEditorToolbar
        editor={editor}
        onImageUpload={noteId ? handleImageUpload : undefined}
        imageUploading={imageUploading}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <SlashMenu editor={editor} onImageUpload={noteId ? handleImageUpload : undefined} />
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

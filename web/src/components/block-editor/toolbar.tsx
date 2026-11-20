import { useCallback, useRef } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Minus,
  ImagePlus,
  Link as LinkIcon,
  Undo2,
  Redo2,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { focusAfterBlockInsert } from './extensions/block-insert-focus';
import { editSelectedLink } from './link-interaction';

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, isActive, disabled, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={isActive}
      onMouseDown={event => event.preventDefault()}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        isActive && 'bg-surface-hover text-accent',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div aria-hidden className="mx-1 h-4 w-px shrink-0 bg-edge" />;
}

export interface BlockEditorToolbarProps {
  editor: Editor;
  onImageUpload?: (file: File) => Promise<void>;
  imageUploading?: boolean;
}

export function BlockEditorToolbar({ editor, onImageUpload, imageUploading = false }: BlockEditorToolbarProps) {
  const zh = useLocaleStore(state => state.language === 'zh');
  const formats = useEditorState({
    editor,
    selector: ({ editor }) => ({
      undo: editor.can().undo(),
      redo: editor.can().redo(),
      heading1: editor.isActive('heading', { level: 1 }),
      heading2: editor.isActive('heading', { level: 2 }),
      heading3: editor.isActive('heading', { level: 3 }),
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      code: editor.isActive('code'),
      link: editor.isActive('link'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      taskList: editor.isActive('taskList'),
      blockquote: editor.isActive('blockquote'),
    }),
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file && onImageUpload && !imageUploading) {
        void onImageUpload(file);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [imageUploading, onImageUpload],
  );

  const iconSize = 16;

  return (
    <div role="group" aria-label={zh ? '排版工具' : 'Formatting controls'}
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain border-b border-edge-subtle px-3 py-1.5">
      {/* Undo / Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!formats.undo}
        title={zh ? '撤销' : 'Undo'}
      >
        <Undo2 size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!formats.redo}
        title={zh ? '重做' : 'Redo'}
      >
        <Redo2 size={iconSize} />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={formats.heading1}
        title={zh ? '一级标题' : 'Heading 1'}
      >
        <Heading1 size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={formats.heading2}
        title={zh ? '二级标题' : 'Heading 2'}
      >
        <Heading2 size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={formats.heading3}
        title={zh ? '三级标题' : 'Heading 3'}
      >
        <Heading3 size={iconSize} />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Inline formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={formats.bold}
        title={zh ? '加粗' : 'Bold (⌘B)'}
      >
        <Bold size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={formats.italic}
        title={zh ? '斜体' : 'Italic (⌘I)'}
      >
        <Italic size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={formats.strike}
        title={zh ? '删除线' : 'Strikethrough'}
      >
        <Strikethrough size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={formats.code}
        title={zh ? '行内代码' : 'Inline code'}
      >
        <Code size={iconSize} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editSelectedLink(editor)} isActive={formats.link} title={zh ? '链接' : 'Link'}>
        <LinkIcon size={iconSize} />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Block types */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={formats.bulletList}
        title={zh ? '无序列表' : 'Bullet list'}
      >
        <List size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={formats.orderedList}
        title={zh ? '有序列表' : 'Ordered list'}
      >
        <ListOrdered size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        isActive={formats.taskList}
        title={zh ? '待办列表' : 'Task list'}
      >
        <ListTodo size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={formats.blockquote}
        title={zh ? '引用' : 'Quote'}
      >
        <Quote size={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => {
          editor.chain().focus().setHorizontalRule().run();
          focusAfterBlockInsert(editor);
        }}
        title={zh ? '分隔线' : 'Divider'}
      >
        <Minus size={iconSize} />
      </ToolbarButton>

      {/* Image upload */}
      {onImageUpload && (
        <>
          <ToolbarDivider />
          <ToolbarButton
            onClick={handleImageClick}
            disabled={imageUploading}
            title={imageUploading ? (zh ? '正在上传…' : 'Uploading…') : (zh ? '插入图片' : 'Insert image')}
          >
            <ImagePlus size={iconSize} className={imageUploading ? 'animate-pulse' : undefined} />
          </ToolbarButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Minus,
  ImagePlus,
} from 'lucide-react';

import { cn } from '@/lib/cn';

interface SlashMenuItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  /** Regular action for editor commands. If `id === 'image'`, handled separately via file input. */
  action: (editor: Editor) => void;
}

const ICON_SIZE = 18;

const SLASH_ITEMS: SlashMenuItem[] = [
  {
    id: 'heading1',
    label: 'Heading 1',
    description: 'Large section heading',
    icon: <Heading1 size={ICON_SIZE} />,
    action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'heading2',
    label: 'Heading 2',
    description: 'Medium section heading',
    icon: <Heading2 size={ICON_SIZE} />,
    action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'heading3',
    label: 'Heading 3',
    description: 'Small section heading',
    icon: <Heading3 size={ICON_SIZE} />,
    action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bulletList',
    label: 'Bullet List',
    description: 'Unordered list',
    icon: <List size={ICON_SIZE} />,
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: 'Numbered List',
    description: 'Ordered list',
    icon: <ListOrdered size={ICON_SIZE} />,
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    label: 'Task List',
    description: 'List with checkboxes',
    icon: <ListTodo size={ICON_SIZE} />,
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'blockquote',
    label: 'Quote',
    description: 'Block quotation',
    icon: <Quote size={ICON_SIZE} />,
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    label: 'Code Block',
    description: 'Fenced code snippet',
    icon: <Code2 size={ICON_SIZE} />,
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'Horizontal rule',
    icon: <Minus size={ICON_SIZE} />,
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Upload an image',
    icon: <ImagePlus size={ICON_SIZE} />,
    action: () => {
      // Handled via file input in SlashMenu component
    },
  },
];

export interface SlashMenuProps {
  editor: Editor;
  /** Called when user picks the Image slash command — triggers file upload flow. */
  onImageUpload?: (file: File) => Promise<void>;
}

export function SlashMenu({ editor, onImageUpload }: SlashMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const slashPosRef = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const filteredItems = SLASH_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      item.description.toLowerCase().includes(query.toLowerCase()),
  );

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
    slashPosRef.current = null;
  }, []);

  const handleImageFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file && onImageUpload) {
        void onImageUpload(file);
      }
      if (imageInputRef.current) {
        imageInputRef.current.value = '';
      }
    },
    [onImageUpload],
  );

  const executeItem = useCallback(
    (item: SlashMenuItem) => {
      // Delete the slash command text
      if (slashPosRef.current !== null) {
        const currentPos = editor.state.selection.from;
        editor
          .chain()
          .focus()
          .deleteRange({ from: slashPosRef.current, to: currentPos })
          .run();
      }

      // Image item triggers file upload instead of a direct editor command
      if (item.id === 'image' && onImageUpload) {
        closeMenu();
        imageInputRef.current?.click();
        return;
      }

      item.action(editor);
      closeMenu();
    },
    [editor, closeMenu, onImageUpload],
  );

  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = filteredItems[selectedIndex];
        if (item) executeItem(item);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener('keydown', handleKeyDown, true);
    return () => editorElement.removeEventListener('keydown', handleKeyDown, true);
  }, [editor, isOpen, filteredItems, selectedIndex, executeItem, closeMenu]);

  // Watch for '/' typed at the start of a line or after whitespace
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      const { state } = editor;
      const { from } = state.selection;
      const currentLineStart = state.doc.resolve(from).start();
      const textBeforeCursor = state.doc.textBetween(currentLineStart, from);

      const slashMatch = textBeforeCursor.match(/\/([^\s]*)$/);

      if (slashMatch && (slashMatch.index === 0 || textBeforeCursor[slashMatch.index! - 1] === ' ')) {
        const slashStartPos = currentLineStart + slashMatch.index!;
        slashPosRef.current = slashStartPos;
        setQuery(slashMatch[1]);
        setSelectedIndex(0);

        // Calculate menu position
        const coords = editor.view.coordsAtPos(from);
        const editorRect = editor.view.dom.getBoundingClientRect();
        setPosition({
          top: coords.bottom - editorRect.top + 4,
          left: coords.left - editorRect.left,
        });

        setIsOpen(true);
      } else if (isOpen) {
        closeMenu();
      }
    };

    editor.on('update', handleUpdate);
    editor.on('selectionUpdate', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
      editor.off('selectionUpdate', handleUpdate);
    };
  }, [editor, isOpen, closeMenu]);

  if (!isOpen || !position || filteredItems.length === 0) return null;

  return (
    <>
      <div
        ref={menuRef}
        className="absolute z-50 w-64 overflow-hidden rounded-lg border border-edge bg-surface-base shadow-lg"
        style={{ top: position.top, left: position.left }}
      >
        <div className="max-h-72 overflow-y-auto p-1">
          {filteredItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => executeItem(item)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
                index === selectedIndex
                  ? 'bg-surface-hover text-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-edge bg-surface-raised">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.label}</span>
                <span className="block truncate text-xs text-fg-muted">{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      {/* Hidden file input for image upload via slash command */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageFileChange}
        className="hidden"
      />
    </>
  );
}

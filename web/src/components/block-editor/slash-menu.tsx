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
  /** The scroll container that owns the positioning context (position: relative). */
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export function SlashMenu({ editor, onImageUpload, containerRef }: SlashMenuProps) {
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

  useEffect(() => {
    const container = menuRef.current?.querySelector('.overflow-y-auto');
    if (!container) return;
    const buttons = container.querySelectorAll('button');
    buttons[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

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
      // Capture slash position before closeMenu() resets it.
      const slashFrom = slashPosRef.current;

      // Delete the slash command text
      if (slashFrom !== null) {
        const currentPos = editor.state.selection.from;
        editor
          .chain()
          .focus()
          .deleteRange({ from: slashFrom, to: currentPos })
          .run();
      }

      // Image item triggers file upload instead of a direct editor command.
      // Defer the click so the editor's synchronous .focus() above settles first —
      // without this, browsers may block the file picker as a non-user gesture.
      if (item.id === 'image' && onImageUpload) {
        closeMenu();
        setTimeout(() => imageInputRef.current?.click(), 0);
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

  // Recalculate menu position when images inside the editor finish loading.
  // ProseMirror doesn't fire an 'update' event on img.onload, but the layout
  // reflows when an image's intrinsic size resolves, making the cached position stale.
  useEffect(() => {
    if (!editor || !isOpen) return;

    const handleImageLoad = () => {
      if (!isOpen) return;
      const { state } = editor;
      const { from } = state.selection;
      const coords = editor.view.coordsAtPos(from);
      const containerEl = containerRef?.current;
      if (containerEl) {
        const containerRect = containerEl.getBoundingClientRect();
        const scrollTop = containerEl.scrollTop;
        const cursorTopInContainer = coords.bottom - containerRect.top - scrollTop + 4;
        const cursorLeftInContainer = coords.left - containerRect.left;
        const maxMenuHeight = Math.min(SLASH_ITEMS.length * 52 + 8, 296);
        const showBelow = coords.bottom + 4 + maxMenuHeight <= window.innerHeight;
        setPosition({
          top: showBelow
            ? cursorTopInContainer
            : cursorTopInContainer - maxMenuHeight - 8,
          left: cursorLeftInContainer,
        });
      }
    };

    const editorEl = editor.view.dom;
    editorEl.addEventListener('load', handleImageLoad, true);
    return () => editorEl.removeEventListener('load', handleImageLoad, true);
  }, [editor, isOpen, containerRef]);

  // Watch for '/' typed at the start of a line or after whitespace
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      const { state } = editor;
      const { from } = state.selection;

      // Detect '/' slash commands by extracting text from block start to cursor.
      // textBetween() safely skips non-text nodes (images, etc.).
      //
      // After block-image insertion, the cursor may sit at a gapcursor position
      // (between the image node and the next paragraph). In that case
      // `$cursor.parent` is `doc`, which is NOT a textblock. We resolve
      // forward to find the nearest textblock so slash detection still works
      // when the user starts typing in the auto-created paragraph.
      let $cursor = state.doc.resolve(from);
      let blockStart = from;

      if ($cursor.parent.isTextblock) {
        blockStart = $cursor.start();
      } else {
        // Cursor is between blocks (gapcursor position — common after
        // inserting a block image). Try resolving one position forward
        // into the next textblock (the empty paragraph that TrailingNode
        // or ProseMirror creates after the block node).
        const nextPos = Math.min(from + 1, state.doc.content.size);
        const $next = state.doc.resolve(nextPos);
        if ($next.parent.isTextblock) {
          $cursor = $next;
          blockStart = $cursor.start();
        } else {
          if (isOpen) closeMenu();
          return;
        }
      }

      // When the cursor sits at a gapcursor position and the user hasn't
      // typed yet, blockStart (next paragraph start) can be > from.
      // In that case there is no text to search, so bail out early.
      if (blockStart >= from) {
        if (isOpen) closeMenu();
        return;
      }
      const textBefore = state.doc.textBetween(blockStart, from, undefined, '\ufffc');

      const slashIdx = textBefore.search(/\/[^\/\s]*$/);
      const isValidSlash =
        slashIdx >= 0 &&
        (slashIdx === 0 || /\s/.test(textBefore[slashIdx - 1]));

      if (isValidSlash) {
        // Convert text-space offset to document position by iterating
        // through the parent's children, counting positions for non-text
        // nodes (images use nodeSize, text uses text length).
        const targetTextOff = slashIdx;
        let docPos = blockStart;
        let textOff = 0;
        let slashStartPos = blockStart + slashIdx; // fallback
        const paragraph = $cursor.parent;
        for (let n = 0; n < paragraph.childCount; n++) {
          const child = paragraph.child(n);
          if (child.isText) {
            const len = child.text!.length;
            if (textOff + len > targetTextOff) {
              slashStartPos = docPos + (targetTextOff - textOff);
              break;
            }
            textOff += len;
            docPos += len;
          } else {
            docPos += child.nodeSize;
          }
        }

        slashPosRef.current = slashStartPos;
        setQuery(textBefore.slice(slashIdx + 1));
        setSelectedIndex(0);

        // Calculate menu position relative to the scroll container (position: absolute).
        // Use container border-box top minus scrollTop to get content-relative coords,
        // which correctly handles any scroll offset regardless of editor layout changes.
        const coords = editor.view.coordsAtPos(from);
        const containerEl = containerRef?.current;
        if (containerEl) {
          const containerRect = containerEl.getBoundingClientRect();
          const scrollTop = containerEl.scrollTop;
          const cursorTopInContainer = coords.bottom - containerRect.top - scrollTop + 4;
          const cursorLeftInContainer = coords.left - containerRect.left;

          // Flip above cursor when menu would overflow the viewport bottom.
          const maxMenuHeight = Math.min(SLASH_ITEMS.length * 52 + 8, 296);
          const showBelow = coords.bottom + 4 + maxMenuHeight <= window.innerHeight;
          setPosition({
            top: showBelow
              ? cursorTopInContainer
              : cursorTopInContainer - maxMenuHeight - 8,
            left: cursorLeftInContainer,
          });
        } else {
          // Fallback: position relative to the editor DOM element itself.
          const editorRect = editor.view.dom.getBoundingClientRect();
          setPosition({
            top: coords.bottom - editorRect.top + 4,
            left: coords.left - editorRect.left,
          });
        }

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

  // Always render the hidden file input so it stays in the DOM when
  // executeItem calls closeMenu() before triggering the click.
  return (
    <>
      {isOpen && position && filteredItems.length > 0 && (
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
      )}
      {/* Hidden file input — always mounted so closeMenu()+click() works for image upload. */}
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

import type { Editor, Range } from '@tiptap/core';

import { focusAfterBlockInsert } from './extensions/block-insert-focus';

export type SlashItemId =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock'
  | 'divider'
  | 'image';

export interface SlashItem {
  id: SlashItemId;
  label: string;
  description: string;
  keywords: string[];
}

export interface SlashCommandRuntime {
  onImageUpload?: (file: File) => Promise<void>;
  requestImagePicker?: () => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'heading1',
    label: 'Heading 1',
    description: 'Large section heading',
    keywords: ['h1', 'title', 'heading'],
  },
  {
    id: 'heading2',
    label: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2', 'heading'],
  },
  {
    id: 'heading3',
    label: 'Heading 3',
    description: 'Small section heading',
    keywords: ['h3', 'heading'],
  },
  {
    id: 'bulletList',
    label: 'Bullet List',
    description: 'Unordered list',
    keywords: ['ul', 'list', 'bullet'],
  },
  {
    id: 'orderedList',
    label: 'Numbered List',
    description: 'Ordered list',
    keywords: ['ol', 'list', 'numbered'],
  },
  {
    id: 'taskList',
    label: 'Task List',
    description: 'List with checkboxes',
    keywords: ['todo', 'task', 'checkbox'],
  },
  {
    id: 'blockquote',
    label: 'Quote',
    description: 'Block quotation',
    keywords: ['quote', 'blockquote'],
  },
  {
    id: 'codeBlock',
    label: 'Code Block',
    description: 'Fenced code snippet',
    keywords: ['code', 'snippet'],
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'Horizontal rule',
    keywords: ['hr', 'rule', 'line'],
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Upload an image',
    keywords: ['img', 'photo', 'picture'],
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return SLASH_ITEMS;
  }

  return SLASH_ITEMS.filter((item) => {
    const haystack = [item.label, item.description, ...item.keywords].join(' ').toLowerCase();
    return haystack.includes(normalized);
  });
}

export function runSlashItem(
  item: SlashItem,
  editor: Editor,
  range: Range,
  runtime: SlashCommandRuntime,
): void {
  if (item.id === 'image') {
    editor.chain().focus().deleteRange(range).run();
    if (runtime.requestImagePicker) {
      setTimeout(() => runtime.requestImagePicker?.(), 0);
    }
    return;
  }

  const chain = editor.chain().focus().deleteRange(range);

  switch (item.id) {
    case 'heading1':
      chain.setHeading({ level: 1 }).run();
      return;
    case 'heading2':
      chain.setHeading({ level: 2 }).run();
      return;
    case 'heading3':
      chain.setHeading({ level: 3 }).run();
      return;
    case 'bulletList':
      chain.toggleBulletList().run();
      return;
    case 'orderedList':
      chain.toggleOrderedList().run();
      return;
    case 'taskList':
      chain.toggleTaskList().run();
      return;
    case 'blockquote':
      chain.toggleBlockquote().run();
      return;
    case 'codeBlock':
      chain.toggleCodeBlock().run();
      return;
    case 'divider':
      chain.setHorizontalRule().run();
      focusAfterBlockInsert(editor);
      return;
    default:
      return;
  }
}

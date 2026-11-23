import type { Editor, Range } from '@tiptap/core';

import { focusAfterBlockInsert } from './extensions/block-insert-focus';
import { insertCalloutBlock } from './extensions/callout-decorations';
import { insertMarkdownTable } from './extensions/table-nodes';

export type SlashItemId =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'table'
  | 'callout'
  | 'blockquote'
  | 'codeBlock'
  | 'divider'
  | 'voiceRecord'
  | 'image'
  | 'file';

export interface SlashItem {
  id: SlashItemId;
  badge: string;
  label: string;
  zhLabel: string;
  description: string;
  zhDescription: string;
  keywords: string[];
}

export interface SlashCommandRuntime {
  locale?: 'en' | 'zh';
  onImageUpload?: (file: File) => Promise<void>;
  requestImagePicker?: () => void;
  requestFilePicker?: () => void;
  requestVoiceRecord?: () => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'heading1',
    badge: 'H1',
    label: 'Heading 1',
    zhLabel: '一级标题',
    description: 'Large section heading',
    zhDescription: '大号章节标题',
    keywords: ['h1', 'title', 'heading', '一级标题', '标题'],
  },
  {
    id: 'heading2',
    badge: 'H2',
    label: 'Heading 2',
    zhLabel: '二级标题',
    description: 'Medium section heading',
    zhDescription: '中号小节标题',
    keywords: ['h2', 'heading', '二级标题', '标题'],
  },
  {
    id: 'heading3',
    badge: 'H3',
    label: 'Heading 3',
    zhLabel: '三级标题',
    description: 'Small section heading',
    zhDescription: '小号子标题',
    keywords: ['h3', 'heading', '三级标题', '标题'],
  },
  {
    id: 'bulletList',
    badge: '•',
    label: 'Bullet List',
    zhLabel: '无序列表',
    description: 'Unordered list',
    zhDescription: '项目符号列表',
    keywords: ['ul', 'list', 'bullet', '无序列表', '列表'],
  },
  {
    id: 'orderedList',
    badge: '1.',
    label: 'Numbered List',
    zhLabel: '有序列表',
    description: 'Ordered list',
    zhDescription: '数字编号列表',
    keywords: ['ol', 'list', 'numbered', '有序列表', '编号'],
  },
  {
    id: 'taskList',
    badge: '☑',
    label: 'Task List',
    zhLabel: '待办列表',
    description: 'List with checkboxes',
    zhDescription: '可勾选的待办清单',
    keywords: ['todo', 'task', 'checkbox', '待办', '清单', '任务'],
  },
  {
    id: 'table',
    badge: '⊞',
    label: 'Table',
    zhLabel: '表格',
    description: 'Insert a Markdown table',
    zhDescription: '插入三行三列表格',
    keywords: ['table', 'grid', 'rows', 'columns', '表格', 'biaoge'],
  },
  {
    id: 'callout',
    badge: '💡',
    label: 'Callout',
    zhLabel: '高亮提示块',
    description: 'Highlighted note or warning box',
    zhDescription: '插入重点提示或警告卡片',
    keywords: ['callout', 'alert', 'note', 'tip', 'warning', '高亮', '提示', '卡片'],
  },
  {
    id: 'blockquote',
    badge: '❝',
    label: 'Quote',
    zhLabel: '引用',
    description: 'Block quotation',
    zhDescription: '引用段落或提示语',
    keywords: ['quote', 'blockquote', '引用'],
  },
  {
    id: 'codeBlock',
    badge: '</>',
    label: 'Code Block',
    zhLabel: '代码块',
    description: 'Fenced code snippet',
    zhDescription: '插入代码或 Mermaid 图表',
    keywords: ['code', 'snippet', 'mermaid', '代码', '代码块'],
  },
  {
    id: 'divider',
    badge: '—',
    label: 'Divider',
    zhLabel: '分隔线',
    description: 'Horizontal rule',
    zhDescription: '插入水平分割线',
    keywords: ['hr', 'rule', 'line', '分隔线', '分割线'],
  },
  {
    id: 'voiceRecord',
    badge: '🎙',
    label: 'Voice Clip',
    zhLabel: '内联语音片段',
    description: 'Record & embed an audio clip',
    zhDescription: '直接录制语音并插入正文',
    keywords: ['record', 'voice', 'audio', 'mic', '录音', '语音', '口述'],
  },
  {
    id: 'image',
    badge: 'IMG',
    label: 'Image',
    zhLabel: '图片',
    description: 'Upload an image',
    zhDescription: '上传并插入图片',
    keywords: ['img', 'photo', 'picture', '图片', '照片'],
  },
  {
    id: 'file',
    badge: 'FILE',
    label: 'Attachment',
    zhLabel: '文件附件',
    description: 'Attach a PDF, document, or audio file',
    zhDescription: '上传 PDF、Office 文档或音频附件',
    keywords: ['file', 'attachment', 'pdf', 'doc', 'audio', '附件', '文件', '上传'],
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return SLASH_ITEMS;
  }

  return SLASH_ITEMS.filter((item) => {
    const haystack = [
      item.label,
      item.zhLabel,
      item.description,
      item.zhDescription,
      ...item.keywords,
    ]
      .join(' ')
      .toLowerCase();
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

  if (item.id === 'file') {
    editor.chain().focus().deleteRange(range).run();
    if (runtime.requestFilePicker) {
      setTimeout(() => runtime.requestFilePicker?.(), 0);
    }
    return;
  }

  if (item.id === 'voiceRecord') {
    editor.chain().focus().deleteRange(range).run();
    if (runtime.requestVoiceRecord) {
      setTimeout(() => runtime.requestVoiceRecord?.(), 0);
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
    case 'table':
      chain.run();
      insertMarkdownTable(editor, 3, 3);
      return;
    case 'callout':
      chain.run();
      insertCalloutBlock(editor, 'NOTE', runtime.locale !== 'en');
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

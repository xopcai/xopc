// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import {
  NOTE_LINK_OPTIONS,
  NOTE_MARKDOWN_OPTIONS,
  NOTE_STARTER_KIT_OPTIONS,
  serializeNoteMarkdown,
} from '@xopcai/note-editor-core';

import { isLikelyAudioAttachment } from '../audio-block';
import { AudioNode } from '../extensions/audio-node';
import { CalloutDecorations, insertCalloutBlock } from '../extensions/callout-decorations';
import { ResizableImage, splitImageAltAndWidth } from '../extensions/resizable-image';
import { TableExtensions } from '../extensions/table-nodes';
import { parseMarkdownWithCharts } from '@/components/markdown/parse-markdown';

function createRoundTripEditor(markdown: string) {
  return new Editor({
    extensions: [
      StarterKit.configure(NOTE_STARTER_KIT_OPTIONS),
      Link.configure(NOTE_LINK_OPTIONS),
      ResizableImage,
      AudioNode.configure({
        getAttachments: () => [
          {
            id: 'att-audio',
            type: 'audio',
            mimeType: 'audio/webm',
            fileName: 'meeting.webm',
            size: 1024,
            relativePath: 'meeting.webm',
          },
          {
            id: 'att-pdf',
            type: 'file',
            mimeType: 'application/pdf',
            fileName: 'report.pdf',
            size: 2048,
            relativePath: 'report.pdf',
          },
        ],
      }),
      ...TableExtensions,
      CalloutDecorations,
      Markdown.configure(NOTE_MARKDOWN_OPTIONS),
    ],
    content: markdown,
  });
}

describe('BlockEditor P0 lossless Markdown round-trip', () => {
  it('preserves GFM tables as pipe syntax without HTML escaping', () => {
    const input = [
      '| 模块 | 状态 |',
      '| --- | --- |',
      '| 录音纪要 | 已打通 |',
      '| 块编辑器 | 无损保存 |',
    ].join('\n');
    const editor = createRoundTripEditor(input);
    try {
      const output = serializeNoteMarkdown(editor);
      expect(output).toContain('| 模块 | 状态 |');
      expect(output).toContain('| 录音纪要 | 已打通 |');
      expect(output).not.toContain('<table');
      expect(output).not.toContain('&lt;table');
    } finally {
      editor.destroy();
    }
  });

  it('preserves audio and file attachment links on serialize instead of dropping them', () => {
    const input = [
      '# 会议资料',
      '',
      '[meeting.webm](xopc-attachment://notes/note-1/att-audio)',
      '',
      '[report.pdf](xopc-attachment://notes/note-1/att-pdf)',
    ].join('\n');
    const editor = createRoundTripEditor(input);
    try {
      const output = serializeNoteMarkdown(editor);
      expect(output).toContain('[meeting.webm](xopc-attachment://notes/note-1/att-audio)');
      expect(output).toContain('[report.pdf](xopc-attachment://notes/note-1/att-pdf)');
      expect(
        isLikelyAudioAttachment({
          id: 'att-audio',
          type: 'audio',
          mimeType: 'audio/webm',
          fileName: 'meeting.webm',
          size: 1024,
          relativePath: 'meeting.webm',
        }),
      ).toBe(true);
      expect(
        isLikelyAudioAttachment({
          id: 'att-pdf',
          type: 'file',
          mimeType: 'application/pdf',
          fileName: 'report.pdf',
          size: 2048,
          relativePath: 'report.pdf',
        }),
      ).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  it('persists resized image widths via ![alt|width](src) and preserves H5/H6 headings', () => {
    const input = [
      '##### 五级标题',
      '',
      '###### 六级标题',
      '',
      '![架构图|360](xopc-attachment://notes/note-1/att-img)',
    ].join('\n');
    const editor = createRoundTripEditor(input);
    try {
      expect(splitImageAltAndWidth('架构图|360')).toEqual({ alt: '架构图', width: 360 });
      const output = serializeNoteMarkdown(editor);
      expect(output).toContain('##### 五级标题');
      expect(output).toContain('###### 六级标题');
      expect(output).toContain('![架构图|360](xopc-attachment://notes/note-1/att-img)');
    } finally {
      editor.destroy();
    }
  });

  it('inserts and round-trips GitHub-style Callout blocks and renders md-callout HTML in preview', () => {
    const editor = createRoundTripEditor('');
    try {
      insertCalloutBlock(editor, 'WARNING', true);
      const md = serializeNoteMarkdown(editor);
      expect(md).toContain('> [!WARNING]');
      const parsed = parseMarkdownWithCharts(md);
      expect(parsed.html).toContain('md-callout-warning');
      expect(parsed.html).toContain('data-callout="WARNING"');
    } finally {
      editor.destroy();
    }
  });
});

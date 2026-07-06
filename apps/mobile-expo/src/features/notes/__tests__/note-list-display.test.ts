import { describe, expect, it } from 'vitest';

import type { NoteIndexEntry } from '../../../query/notes';
import {
  extractAttachmentPreviewText,
  formatNoteRelativeTime,
  resolveNoteListDisplay,
} from '../note-list-display';

const kindLabels = {
  kindThought: '想法',
  kindTodo: '待办',
  kindVoice: '语音',
  kindMedia: '媒体',
  kindBookmark: '链接',
};

const emptyHints = {
  voice: '点击听取或补充转写',
  media: '点击查看附件',
  bookmark: '点击打开链接',
  default: '点击打开并补充内容',
};

const timeLabels = {
  justNow: '刚刚',
  minutes: '{{n}} 分钟前',
  hours: '{{n}} 小时前',
  days: '{{n}} 天前',
};

function makeEntry(overrides: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
  return {
    id: 'note-1',
    kind: 'thought',
    status: 'inbox',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('resolveNoteListDisplay', () => {
  it('shows content preview with kind and relative time in meta line', () => {
    const display = resolveNoteListDisplay(
      makeEntry({ snippet: '明天整理项目需求文档', tags: ['工作'] }),
      {
        untitled: '无标题',
        kindLabels,
        emptyHints,
        timeLabels,
        now: 1_700_000_030_000,
      },
    );

    expect(display.title).toBe('明天整理项目需求文档');
    expect(display.subtitle).toBeNull();
    expect(display.metaLine).toBe('想法 · 刚刚 · 工作');
  });

  it('separates explicit title and body preview', () => {
    const display = resolveNoteListDisplay(
      makeEntry({ title: '会议纪要', snippet: '需要跟进设计评审' }),
      {
        untitled: '无标题',
        kindLabels,
        emptyHints,
        timeLabels,
        now: 1_700_000_030_000,
      },
    );

    expect(display.title).toBe('会议纪要');
    expect(display.subtitle).toBe('需要跟进设计评审');
  });

  it('falls back to cached content and attachment transcript', () => {
    const display = resolveNoteListDisplay(
      makeEntry({ kind: 'voice', snippet: '' }),
      {
        untitled: '无标题',
        cachedNote: {
          attachments: [{ id: 'a1', type: 'audio', mimeType: 'audio/m4a', fileName: 'voice.m4a', size: 1, relativePath: 'voice.m4a', transcript: '记得买牛奶' }],
        },
        kindLabels,
        emptyHints,
        timeLabels,
        now: 1_700_000_030_000,
      },
    );

    expect(display.title).toBe('记得买牛奶');
    expect(display.metaLine).toContain('语音');
  });

  it('uses kind label and actionable hint when content is empty', () => {
    const display = resolveNoteListDisplay(
      makeEntry({ kind: 'media', snippet: '' }),
      {
        untitled: '无标题',
        kindLabels,
        emptyHints,
        timeLabels,
        now: 1_700_000_030_000,
      },
    );

    expect(display.title).toBe('媒体');
    expect(display.subtitle).toBe('点击查看附件');
    expect(display.metaLine).toBe('刚刚');
  });
});

describe('extractAttachmentPreviewText', () => {
  it('prefers transcript over file name', () => {
    expect(extractAttachmentPreviewText({
      attachments: [{
        id: 'a1',
        type: 'audio',
        mimeType: 'audio/m4a',
        fileName: 'voice.m4a',
        size: 1,
        relativePath: 'voice.m4a',
        transcript: '  买咖啡  ',
      }],
    })).toBe('买咖啡');
  });
});

describe('formatNoteRelativeTime', () => {
  it('formats minutes and days', () => {
    const now = 1_700_000_000_000;
    expect(formatNoteRelativeTime(now - 5 * 60_000, timeLabels, now)).toBe('5 分钟前');
    expect(formatNoteRelativeTime(now - 2 * 24 * 60 * 60_000, timeLabels, now)).toBe('2 天前');
  });
});

describe('cached markdown fallback', () => {
  it('derives title from cached markdown when index is empty', () => {
    const display = resolveNoteListDisplay(
      makeEntry({ snippet: '' }),
      {
        untitled: '无标题',
        cachedNote: {
          markdown: '本地缓存正文',
        },
        kindLabels,
        emptyHints,
        timeLabels,
        now: 1_700_000_030_000,
      },
    );

    expect(display.title).toBe('本地缓存正文');
  });
});

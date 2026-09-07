import { describe, expect, it } from 'vitest';

import { buildNoteReadAloudText } from '../note-read-aloud';
import { splitSpeakableText } from '../../voice/read-aloud-text';

describe('note full-text reading', () => {
  it('reads the title and every paragraph without attachment addresses or checklist syntax', () => {
    expect(buildNoteReadAloudText('旅行计划', [
      '## 第一天', '- [x] 到达机场。',
      '[行程](https://example.com)和![地图](xopc-attachment://notes/n1/a1)',
      '最后一天回家。',
    ].join('\n'))).toBe('旅行计划\n\n第一天\n到达机场。\n行程和地图\n最后一天回家。');
  });

  it('does not repeat a title already at the start of the document', () => {
    expect(buildNoteReadAloudText('标题', '# 标题\n\n正文。')).toBe('标题\n\n正文。');
  });

  it('keeps fenced content as part of the full document', () => {
    expect(buildNoteReadAloudText('', '开头。\n```text\n需要朗读的段落。\n```\n结尾。'))
      .toContain('需要朗读的段落。');
  });

  it('does not truncate a long note when splitting audio requests', () => {
    const body = '这是完整的笔记内容。'.repeat(1000) + '最后一段。';
    const text = buildNoteReadAloudText('', body);
    expect(splitSpeakableText(text).join('')).toBe(body);
  });

  it('leaves an empty document empty instead of reading a placeholder title', () => {
    expect(buildNoteReadAloudText('', '  \n')).toBe('');
  });
});

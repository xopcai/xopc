import { describe, expect, it } from 'vitest';

import { parseMarkdown } from '@/components/markdown/parse-markdown';
import {
  mergeConsecutiveTextBlocks,
  prepareStreamingMarkdown,
} from '@/features/chat/messages/streaming-markdown';
import type { MessageContent } from '@/features/chat/messages/messages.types';

function parsesTable(markdown: string): boolean {
  return parseMarkdown(markdown).includes('<table>');
}

describe('prepareStreamingMarkdown', () => {
  it('adds a temporary separator when a streaming table only has a header row', () => {
    const raw = 'Here is the table:\n\n| Name | Age |';
    const repaired = prepareStreamingMarkdown(raw);

    expect(parsesTable(raw)).toBe(false);
    expect(parsesTable(repaired)).toBe(true);
    expect(repaired).toContain('| --- | --- |');
  });

  it('repairs an incomplete separator row using the header column count', () => {
    const raw = '| Name | Age |\n| ---';
    const repaired = prepareStreamingMarkdown(raw);

    expect(parsesTable(raw)).toBe(false);
    expect(parsesTable(repaired)).toBe(true);
    expect(repaired).toBe('| Name | Age |\n| --- | --- |');
  });

  it('keeps a streaming table renderable when the separator row has only started', () => {
    const raw = 'Here is the table:\n\n| Name | Age |\n|';
    const repaired = prepareStreamingMarkdown(raw);

    expect(parsesTable(raw)).toBe(false);
    expect(parsesTable(repaired)).toBe(true);
    expect(repaired).toBe('Here is the table:\n\n| Name | Age |\n| --- | --- |');
  });

  it('does not insert a blank line while waiting for an indented separator row', () => {
    const raw = 'Here is the table:\n\n| Name | Age |\n ';
    const repaired = prepareStreamingMarkdown(raw);

    expect(parsesTable(raw)).toBe(false);
    expect(parsesTable(repaired)).toBe(true);
    expect(repaired).toBe('Here is the table:\n\n| Name | Age |\n| --- | --- |');
  });

  it('keeps common table prefixes renderable after the table first appears', () => {
    const raw = 'Here is the table:\n\n| Name | Age |\n | --- | --- |\n | Ada | 36 |';
    let seenTable = false;

    for (let i = 1; i <= raw.length; i++) {
      const prefix = raw.slice(0, i);
      const isTable = parsesTable(prepareStreamingMarkdown(prefix));
      if (isTable) seenTable = true;
      if (seenTable) expect(isTable, `prefix ${i}: ${JSON.stringify(prefix)}`).toBe(true);
    }
  });

  it('preserves container prefixes for streaming tables inside lists and blockquotes', () => {
    const samples = [
      '- item\n  | Name | Age |\n  | --- | --- |\n  | Ada | 36 |',
      '> | Name | Age |\n> | --- | --- |\n> | Ada | 36 |',
    ];

    for (const raw of samples) {
      let seenTable = false;
      for (let i = 1; i <= raw.length; i++) {
        const prefix = raw.slice(0, i);
        const isTable = parsesTable(prepareStreamingMarkdown(prefix));
        if (isTable) seenTable = true;
        if (seenTable) expect(isTable, `prefix ${i}: ${JSON.stringify(prefix)}`).toBe(true);
      }
    }
  });

  it('completes a partial final row without mutating non-table text', () => {
    const raw = '| Name | Age |\n| --- | --- |\n| Ada | 36';
    const repaired = prepareStreamingMarkdown(raw);

    expect(parsesTable(repaired)).toBe(true);
    expect(repaired).toBe('| Name | Age |\n| --- | --- |\n| Ada | 36 |');
  });

  it('leaves ordinary pipe text alone', () => {
    const raw = 'Use foo | bar in this shell command.';
    expect(prepareStreamingMarkdown(raw)).toBe(raw);
  });

  it('does not repair table-like text inside an unclosed code fence', () => {
    const raw = '```md\n| Name | Age |';
    expect(prepareStreamingMarkdown(raw)).toBe(raw);
  });
});

describe('mergeConsecutiveTextBlocks', () => {
  it('merges adjacent text blocks so GFM tables can span UI chunks', () => {
    const content: MessageContent[] = [
      { type: 'text', text: '| A | B |\n' },
      { type: 'text', text: '| --- | --- |\n| 1 | 2 |' },
    ];

    const merged = mergeConsecutiveTextBlocks(content);

    expect(merged).toEqual([{ type: 'text', text: '| A | B |\n| --- | --- |\n| 1 | 2 |' }]);
    expect(parsesTable(merged[0].type === 'text' ? merged[0].text : '')).toBe(true);
  });

  it('does not merge text across tool or thinking blocks', () => {
    const content: MessageContent[] = [
      { type: 'text', text: '| A | B |\n' },
      { type: 'tool_use', id: 't1', name: 'read_file', input: {}, status: 'done' },
      { type: 'text', text: '| --- | --- |' },
    ];

    expect(mergeConsecutiveTextBlocks(content)).toHaveLength(3);
  });
});

import { describe, expect, it } from 'vitest';

import { parseMarkdown } from '@/components/markdown/parse-markdown';
import {
  mergeConsecutiveTextBlocks,
} from '@/features/chat/messages/streaming-markdown';
import type { MessageContent } from '@/features/chat/messages/messages.types';

function parsesTable(markdown: string): boolean {
  return parseMarkdown(markdown).includes('<table>');
}

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

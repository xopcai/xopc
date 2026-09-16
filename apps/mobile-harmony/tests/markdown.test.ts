import { describe, expect, it } from 'vitest';
import { markdownBlocks, markdownSpans } from '../entry/src/main/ets/common/markdown';

describe('native Markdown subset', () => {
  it('renders headings, lists, quotes, fences, and rules without HTML', () => {
    const blocks = markdownBlocks('# Title\n\n- item\n2. second\n> quote\n\n```ts\nconst value = 1;\n```\n\n---');
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'list', 'list', 'quote', 'code', 'rule']);
    expect(blocks[4]?.text).toBe('const value = 1;');
  });
  it('retains unclosed code fences during streaming and keeps HTML inert as text', () => {
    expect(markdownBlocks('```\n# Not heading')[0]).toMatchObject({ kind: 'code', text: '# Not heading' });
    expect(markdownBlocks('<script>alert(1)</script>')[0]?.text).toBe('<script>alert(1)</script>');
  });
  it('keeps link targets visible and never downloads images while styling inline text', () => {
    expect(markdownSpans('A **bold** `code` *italic* [site](https://example.com)').map(({ kind, text }) => ({ kind, text })))
      .toEqual([{ kind: 'text', text: 'A ' }, { kind: 'bold', text: 'bold' }, { kind: 'text', text: ' ' }, { kind: 'code', text: 'code' },
        { kind: 'text', text: ' ' }, { kind: 'italic', text: 'italic' }, { kind: 'text', text: ' [site](https://example.com)' }]);
  });
});

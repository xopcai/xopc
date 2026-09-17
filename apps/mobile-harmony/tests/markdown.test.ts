import { describe, expect, it } from 'vitest';
import { markdownBlocks, markdownSpans, markdownLink } from '../entry/src/main/ets/common/markdown';

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
  it('parses actionable links without fetching images or HTML', () => {
    expect(markdownSpans('A **bold** `code` *italic* [site](https://example.com)').map(({ kind, text }) => ({ kind, text })))
      .toEqual([{ kind: 'text', text: 'A ' }, { kind: 'bold', text: 'bold' }, { kind: 'text', text: ' ' }, { kind: 'code', text: 'code' },
        { kind: 'text', text: ' ' }, { kind: 'italic', text: 'italic' }, { kind: 'text', text: ' ' }, { kind: 'link', text: 'site' }]);
    expect(markdownSpans('![image](https://example.com/image.png)')[0]).toMatchObject({ kind: 'link', href: 'https://example.com/image.png' });
  });
  it('parses tables with alignments, empty cells, escaped pipes and code pipes', () => {
    const [table, paragraph] = markdownBlocks('| Name | Value | Center |\n| :--- | ---: | :---: |\n| a\\|b | `x|y` | |\n\nAfter');
    expect(table.kind).toBe('table');
    expect(table.rows?.[1].cells.map(cell => cell.text)).toEqual(['a|b', '`x|y`', '']);
    expect(table.rows?.[0].cells.map(cell => cell.align)).toEqual(['left', 'right', 'center']);
    expect(paragraph.text).toBe('After');
    expect(markdownBlocks('a | b\n--- | wrong')[0].kind).toBe('paragraph');
    expect(markdownBlocks('| a | b |\n| --- | --- |\n| c |')[0].rows?.[1].cells.map(c => c.text)).toEqual(['c', '']);
  });
  it('preserves partial streaming tables, code fences, nesting, and task states', () => {
    expect(markdownBlocks('| a | b |\n| --- |')[0].kind).toBe('paragraph');
    expect(markdownBlocks('```ts\nconst x = 1;\n```oops\nstill code')[0]).toMatchObject({ kind: 'code', language: 'ts', text: 'const x = 1;\n```oops\nstill code' });
    expect(markdownBlocks('- [ ] todo\n  - [x] done').map(b => [b.text, b.level])).toEqual([['☐ todo', 0], ['☑ done', 1]]);
  });
  it('supports deletion, escaped punctuation, and balanced URL parentheses', () => {
    expect(markdownSpans('~~old~~ \\*literal [docs](https://example.com/a_(b))').filter(s => s.kind !== 'text'))
      .toMatchObject([{ kind: 'strike', text: 'old' }, { kind: 'link', href: 'https://example.com/a_(b)' }]);
    expect(markdownSpans('`[docs](https://example.com)`')[0].kind).toBe('code');
    expect(markdownSpans('``a ` b``')[0]).toMatchObject({ kind: 'code', text: 'a ` b' });
    expect(markdownSpans('<https://example.com>')[0].href).toBe('https://example.com');
  });
  it('never makes script, file, credentialed, malformed or control-character links actionable', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///private', '//example.com', '/api/private', 'https://user:pass@example.com', 'https://example.com\\evil', 'https://examp\nle.com', 'https://']) {
      expect(markdownLink(href)).toBe('');
      expect(markdownSpans(`[bad](${href})`).every(s => !s.href)).toBe(true);
    }
  });
});

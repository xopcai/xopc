import { describe, expect, it } from 'vitest';
import { markdownBlocks } from '../entry/src/main/ets/common/markdown';
import { XopcMarkdownStreamParser } from '../entry/src/main/ets/common/markdownStreamParser';
import { mathCandidateCount } from '../entry/src/main/ets/common/mathMarkdown';

describe('mathematical Markdown projection', () => {
  it('counts candidate boundaries across the whole message for the native render budget', () => {
    expect(mathCandidateCount(Array.from({ length: 257 }, () => '\\[x\\]').join('\n\n'))).toBe(257);
    expect(mathCandidateCount('Plain text')).toBe(0);
    expect(mathCandidateCount('\\(x\\)\n\n```math\nx^2\n```')).toBe(2);
  });
  it('retains mathematical containers and excludes embedded or indented displays', () => {
    for (const raw of ['> \\[\n> x^2\n> \\]', '- \\[\n  x^2\n  \\]']) {
      expect(markdownBlocks(raw)[0]).toMatchObject({ kind: 'math', text: raw });
    }
    expect(markdownBlocks('\\[x\\] after')[0].kind).toBe('paragraph');
    expect(markdownBlocks('    \\[x\\]')[0].kind).toBe('paragraph');
    expect(markdownBlocks('> \\[\n> x\n\nOutside').at(-1)?.text).toBe('Outside');
    expect(markdownBlocks('\\[ % \\]\nx^2\n\\]')[0].kind).toBe('math');
  });
  it('preserves formula blank lines during streaming and excludes code', () => {
    const raw = '\\[\n\\begin{aligned}\na &= b \\\\\n\nc &= d\n\\end{aligned}\n\\]';
    const source = `Before\n\n${raw}\n\nAfter`;
    expect(markdownBlocks(source).map(block => block.kind)).toEqual(['paragraph', 'math', 'paragraph']);
    const parser = new XopcMarkdownStreamParser();
    for (let offset = 0; offset <= source.length; offset++) {
      expect(parser.parse(source.slice(0, offset)).map(({ kind, text }) => ({ kind, text })))
        .toEqual(markdownBlocks(source.slice(0, offset)).map(({ kind, text }) => ({ kind, text })));
    }
    expect(markdownBlocks('```ts\n\\[x\\]\n```')[0].kind).toBe('code');
    expect(markdownBlocks('```math\nx^2\n```')[0].text).toBe('```math\nx^2\n```');
  });
});

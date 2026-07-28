import { describe, expect, it } from 'vitest';

import { splitStreamingMarkdownBlocks } from '@/components/markdown/parse-markdown';

describe('splitStreamingMarkdownBlocks', () => {
  it('freezes completed top-level blocks and leaves the active block as the tail', () => {
    const content = 'First paragraph.\n\n## Result\n\nStill streaming';
    const result = splitStreamingMarkdownBlocks(content);

    expect(result.stable.length).toBeGreaterThan(0);
    expect(result.stable.join('') + result.tail).toBe(content);
    expect(result.tail).toContain('Still streaming');
  });

  it('keeps a growing list together until a following block begins', () => {
    const listOnly = splitStreamingMarkdownBlocks('- one\n- two');
    expect(listOnly.stable).toEqual([]);

    const withFollowingParagraph = splitStreamingMarkdownBlocks(
      '- one\n- two\n\nFollowing paragraph',
    );
    expect(withFollowingParagraph.stable.join('')).toContain('- one');
    expect(withFollowingParagraph.tail).toContain('Following paragraph');
  });

  it('falls back to a single tail for reference-style links', () => {
    const content = 'Read [the docs][docs].\n\n[docs]: https://example.com';
    expect(splitStreamingMarkdownBlocks(content)).toEqual({
      stable: [],
      tail: content,
    });
  });

  it('keeps the previous stable blocks unchanged while the tail grows', () => {
    const first = splitStreamingMarkdownBlocks('Intro.\n\n## Answer\n\nPart');
    const next = splitStreamingMarkdownBlocks('Intro.\n\n## Answer\n\nPart two');

    expect(next.stable).toEqual(first.stable);
    expect(next.tail).toContain('Part two');
  });
});

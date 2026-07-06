import { describe, expect, it } from 'vitest';

import { extractMarkdownCodeBlocks } from '../extract-markdown-code';

describe('extractMarkdownCodeBlocks', () => {
  it('returns empty string when no fenced blocks exist', () => {
    expect(extractMarkdownCodeBlocks('plain text only')).toBe('');
  });

  it('extracts a single fenced block', () => {
    expect(extractMarkdownCodeBlocks('Intro\n```ts\nconst x = 1;\n```\nOutro')).toBe('const x = 1;');
  });

  it('joins multiple fenced blocks', () => {
    expect(
      extractMarkdownCodeBlocks('```js\na()\n```\n\nmiddle\n\n```py\nprint(1)\n```'),
    ).toBe('a()\n\nprint(1)');
  });
});

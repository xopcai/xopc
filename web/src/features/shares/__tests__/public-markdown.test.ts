import { describe, expect, it } from 'vitest';

import { blockRemoteMarkdownImages } from '../public-markdown';

describe('blockRemoteMarkdownImages', () => {
  it('turns inline and reference-style remote images into links', () => {
    const markdown = [
      '![inline](https://example.com/image.png "title")',
      '![reference][asset]',
      '',
      '[asset]: https://example.com/reference.png',
    ].join('\n');

    const result = blockRemoteMarkdownImages(markdown, 'Remote image blocked');

    expect(result).toContain('[inline](https://example.com/image.png)');
    expect(result).toContain('[reference](https://example.com/reference.png)');
    expect(result).not.toContain('![inline]');
    expect(result).not.toContain('![reference]');
  });

  it('keeps local and non-image links unchanged', () => {
    const markdown = '![local](/s/token/assets/one)\n[website](https://example.com)';
    expect(blockRemoteMarkdownImages(markdown, 'Blocked')).toBe(markdown);
  });
});

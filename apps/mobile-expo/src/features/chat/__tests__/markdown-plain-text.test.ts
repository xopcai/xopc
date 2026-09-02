import { describe, expect, it } from 'vitest';

import { markdownPreviewText } from '../markdown-plain-text';

describe('markdownPreviewText', () => {
  it('removes structural Markdown while preserving readable content', () => {
    expect(markdownPreviewText([
      '## Latest result',
      '',
      '- Status: **passed**',
      '- Review [PR #7622](https://example.com/pull/7622)',
      '',
      '> Ready to merge.',
    ].join('\n'))).toBe('Latest result Status: passed Review PR #7622 Ready to merge.');
  });
});

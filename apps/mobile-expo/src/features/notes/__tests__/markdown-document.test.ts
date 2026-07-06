import { describe, expect, it } from 'vitest';

import {
  getMarkdownOutline,
  stripMarkdownFrontmatter,
} from '../markdown/markdown-document';

describe('markdown-document', () => {
  it('strips frontmatter from note markdown', () => {
    expect(stripMarkdownFrontmatter('---\ntitle: "Idea"\n---\n\n# Visible')).toBe('# Visible');
    expect(stripMarkdownFrontmatter('# Visible')).toBe('# Visible');
  });

  it('builds heading outline and ignores frontmatter and code fences', () => {
    expect(getMarkdownOutline([
      '---',
      'title: Hidden',
      '---',
      '',
      '# Intro',
      '',
      '```md',
      '## Ignored',
      '```',
      '',
      '## Next step {#next}',
      '### Next step',
      '## Next step',
    ].join('\n'))).toEqual([
      { id: 'intro', title: 'Intro', level: 1, range: { start: 23, end: 30 } },
      { id: 'next', title: 'Next step', level: 2, range: { start: 54, end: 74 } },
      { id: 'next-step', title: 'Next step', level: 3, range: { start: 75, end: 88 } },
      { id: 'next-step-2', title: 'Next step', level: 2, range: { start: 89, end: 101 } },
    ]);
  });
});

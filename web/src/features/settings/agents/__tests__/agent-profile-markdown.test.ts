import { describe, expect, it } from 'vitest';

import {
  replaceProfileMarkdownBody,
  splitProfileMarkdownFrontMatter,
} from '@/features/settings/agents/agent-profile-markdown';

describe('agent profile markdown', () => {
  it('keeps front matter outside visual editor body updates', () => {
    const current = '---\nowner: local\n---\n# Old body\n';
    expect(splitProfileMarkdownFrontMatter(current)).toEqual({
      frontMatter: '---\nowner: local\n---\n',
      body: '# Old body\n',
    });
    expect(replaceProfileMarkdownBody(current, '# New body')).toBe('---\nowner: local\n---\n# New body');
  });
});

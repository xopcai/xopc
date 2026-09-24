import { describe, expect, it } from 'vitest';

import {
  parseIdentityMarkdown,
  replaceProfileMarkdownBody,
  splitProfileMarkdownFrontMatter,
  updateIdentityMarkdown,
} from '@/features/settings/agents/agent-profile-markdown';

describe('agent profile identity markdown', () => {
  it('updates known fields without removing custom content or front matter', () => {
    const current = [
      '---',
      'owner: local',
      '---',
      '# Identity',
      '',
      '- **Name:** Old name',
      '- **Description:** Existing description',
      '',
      '## Custom notes',
      '',
      'Keep this paragraph.',
    ].join('\n');

    const next = updateIdentityMarkdown(current, {
      name: 'Nova',
      description: 'Research partner',
      language: 'English',
      creature: 'AI assistant',
      emoji: '✨',
      avatar: '/tmp/nova.png',
    });

    expect(next).toContain('owner: local');
    expect(next).toContain('## Custom notes');
    expect(next).toContain('Keep this paragraph.');
    expect(parseIdentityMarkdown(next)).toEqual({
      name: 'Nova',
      description: 'Research partner',
      language: 'English',
      creature: 'AI assistant',
      emoji: '✨',
      avatar: '/tmp/nova.png',
    });
  });

  it('creates a complete identity document when the file is empty', () => {
    const next = updateIdentityMarkdown('', {
      name: 'Nova',
      description: '',
      language: 'English',
      creature: 'AI assistant',
      emoji: '',
      avatar: '',
    });

    expect(next).toContain('# IDENTITY.md');
    expect(next).toContain('- **Name:** Nova');
    expect(next).toContain('- **Language:** English');
  });

  it('keeps front matter outside visual editor body updates', () => {
    const current = '---\nowner: local\n---\n# Old body\n';
    expect(splitProfileMarkdownFrontMatter(current)).toEqual({
      frontMatter: '---\nowner: local\n---\n',
      body: '# Old body\n',
    });
    expect(replaceProfileMarkdownBody(current, '# New body')).toBe('---\nowner: local\n---\n# New body');
  });
});

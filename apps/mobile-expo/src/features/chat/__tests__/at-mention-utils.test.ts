import { describe, expect, it } from 'vitest';

import { detectAtMentionRange, formatWorkspacePath, replaceAtMention } from '../at-mention-utils';

describe('mobile at mentions', () => {
  it('detects the active mention and ignores email addresses and serialized files', () => {
    expect(detectAtMentionRange('read @src/auth', 14)).toEqual({ start: 5, end: 14, query: 'src/auth' });
    expect(detectAtMentionRange('a@b.com', 7)).toBeNull();
    expect(detectAtMentionRange('@file:src/a.ts', 14)).toBeNull();
  });

  it('serializes workspace paths without losing spaces', () => {
    expect(formatWorkspacePath('src/a.ts')).toBe('src/a.ts');
    expect(formatWorkspacePath('docs/my plan.md')).toBe('"docs/my plan.md"');
    expect(replaceAtMention('read @auth now', { start: 5, end: 10, query: 'auth' }, '@file:src/auth.ts '))
      .toBe('read @file:src/auth.ts  now');
  });
});

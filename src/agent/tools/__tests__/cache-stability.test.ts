import { describe, expect, it } from 'vitest';

import { sortToolsForPromptCache } from '../cache-stability.js';

describe('sortToolsForPromptCache', () => {
  it('sorts provider-visible tools deterministically without mutating the input', () => {
    const input = [
      { name: 'write', description: 'Write' },
      { name: 'read', description: 'Read B' },
      { name: 'read', description: 'Read A' },
    ];

    expect(sortToolsForPromptCache(input).map((tool) => tool.description)).toEqual([
      'Read A',
      'Read B',
      'Write',
    ]);
    expect(input[0]?.name).toBe('write');
  });
});

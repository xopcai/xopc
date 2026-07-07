import { describe, expect, it } from 'vitest';

import { buildReviewCommand, quoteReviewArg } from '@/features/chat/review/review-launcher-api';

describe('review launcher command helpers', () => {
  it('builds uncommitted, base, commit, and custom review commands', () => {
    expect(buildReviewCommand({ preset: 'uncommitted' })).toBe('/review --uncommitted');
    expect(buildReviewCommand({ preset: 'base', baseBranch: 'origin/main' })).toBe('/review --base origin/main');
    expect(buildReviewCommand({ preset: 'commit', commitSha: 'abc123' })).toBe('/review --commit abc123');
    expect(buildReviewCommand({ preset: 'custom', instructions: 'focus on persistence' })).toBe(
      '/review --uncommitted --instructions "focus on persistence"',
    );
  });

  it('quotes branch names and instruction strings that need shell-like escaping', () => {
    expect(quoteReviewArg('feature/review-ui')).toBe('feature/review-ui');
    expect(quoteReviewArg('release candidate')).toBe('"release candidate"');
    expect(buildReviewCommand({
      preset: 'base',
      baseBranch: 'release candidate',
      instructions: 'check "edge" cases',
    })).toBe('/review --base "release candidate" --instructions "check \\"edge\\" cases"');
  });
});

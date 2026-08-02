import { describe, expect, it } from 'vitest';

import { scoreProactiveValue } from '../value-score.js';

describe('proactive value score', () => {
  it('delivers actionable evidence-backed updates', () => {
    expect(scoreProactiveValue({
      kind: 'progress',
      evidenceCount: 2,
      hasNextAction: true,
      approvedCount: 0,
      dismissedCount: 0,
    })).toMatchObject({ shouldDeliver: true });
  });

  it('suppresses updates after consistently negative feedback', () => {
    const result = scoreProactiveValue({
      kind: 'progress',
      evidenceCount: 1,
      hasNextAction: true,
      approvedCount: 0,
      dismissedCount: 5,
    });
    expect(result.shouldDeliver).toBe(false);
    expect(result.reasons).toContain('historically_dismissed');
  });
});

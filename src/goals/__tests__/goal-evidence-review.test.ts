import { describe, expect, it } from 'vitest';

import { reviewGoalEvidenceRequirement } from '../goal-evidence-review.js';

describe('reviewGoalEvidenceRequirement', () => {
  it('returns an explainable manual-review fallback when no model is configured', async () => {
    const review = await reviewGoalEvidenceRequirement({
      requirement: {
        id: 'requirement-1',
        goalId: 'goal-1',
        text: 'The targeted test suite passes.',
        status: 'pending',
        evidenceIds: ['evidence-1'],
        requiresHumanApproval: true,
        createdAt: 1,
        updatedAt: 1,
        sortOrder: 1,
      },
      evidence: [{
        id: 'evidence-1',
        goalId: 'goal-1',
        kind: 'test',
        title: 'Targeted test output',
        createdAt: 1,
      }],
    });

    expect(review).toMatchObject({
      verdict: 'needs_more_evidence',
      generated: false,
      warning: 'No model is configured for evidence review.',
    });
    expect(review.reason).toContain('linked');
  });
});

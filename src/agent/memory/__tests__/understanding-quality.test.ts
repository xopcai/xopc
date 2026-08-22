import { describe, expect, it } from 'vitest';

import type { UserUnderstandingQualityMetrics } from '../../../storage/sqlite/index.js';
import { resolveAdaptiveUnderstandingCadence } from '../understanding/quality.js';

function metrics(
  overrides: Partial<UserUnderstandingQualityMetrics> = {},
): UserUnderstandingQualityMetrics {
  return {
    windowDays: 30,
    since: new Date(0).toISOString(),
    records: {
      total: 0,
      candidate: 0,
      active: 0,
      rejected: 0,
      needsReview: 0,
      stale: 0,
      archived: 0,
      agingCandidates: 0,
      explicit: 0,
      inferred: 0,
      averageConfidence: null,
    },
    decisions: { total: 0, acceptanceRate: null },
    recall: { total: 0, helpful: 0, notHelpful: 0, mixed: 0, irrelevant: 0, helpfulRate: null },
    ...overrides,
  };
}

describe('resolveAdaptiveUnderstandingCadence', () => {
  it('keeps the configured cadence when evidence is sparse or healthy', () => {
    expect(resolveAdaptiveUnderstandingCadence(10, metrics())).toMatchObject({
      effectiveIntervalTurns: 10,
      slowed: false,
      reasons: [],
    });
  });

  it('only slows cadence when quality or review backlog crosses a guarded threshold', () => {
    const decision = resolveAdaptiveUnderstandingCadence(10, metrics({
      records: { ...metrics().records, candidate: 20, agingCandidates: 10 },
      decisions: { total: 12, acceptanceRate: 0.2 },
      recall: { ...metrics().recall, total: 10, helpfulRate: 0.3 },
    }));

    expect(decision.effectiveIntervalTurns).toBe(20);
    expect(decision.reasons).toEqual([
      'candidate_backlog',
      'low_acceptance',
      'low_recall_quality',
    ]);
  });

  it('can disable adaptation without changing the configured interval', () => {
    const decision = resolveAdaptiveUnderstandingCadence(10, metrics({
      records: { ...metrics().records, candidate: 100 },
    }), false);
    expect(decision.effectiveIntervalTurns).toBe(10);
    expect(decision.slowed).toBe(false);
  });
});

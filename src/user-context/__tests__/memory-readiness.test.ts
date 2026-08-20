import { describe, expect, it } from 'vitest';

import { evaluateMemoryReadiness } from '../memory-readiness.js';

describe('evaluateMemoryReadiness', () => {
  it('allows automatic writes only after feedback and Dreaming meet the gate', () => {
    const result = evaluateMemoryReadiness({
      evaluatedTurns: 20,
      helpfulTurns: 16,
      recordFeedback: 10,
      recordErrors: 1,
      sensitiveFeedback: 0,
      dreamingRuns: 10,
      dreamingFailures: 1,
    }, { nowMs: 0 });

    expect(result.ready).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('reports every unsafe condition instead of enabling automatic writes', () => {
    const result = evaluateMemoryReadiness({
      evaluatedTurns: 4,
      helpfulTurns: 2,
      recordFeedback: 4,
      recordErrors: 2,
      sensitiveFeedback: 1,
      dreamingRuns: 2,
      dreamingFailures: 2,
    }, { nowMs: 0 });

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual([
      'insufficient_feedback',
      'high_record_error_rate',
      'sensitive_feedback_detected',
      'insufficient_dreaming_runs',
    ]);
  });
});

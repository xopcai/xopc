import { describe, expect, it } from 'vitest';
import { compareComputerEvaluations } from '../evaluation-comparison.js';

const plan = { taskIds: ['a', 'b'], repetitions: 1, modelRef: 'baseline', environment: 'fixed', evidence: 'fixture' };
const row = (taskId: string) => ({ modelRef: plan.modelRef, environment: plan.environment, evidence: plan.evidence, taskId, repetition: 0,
  outcome: 'passed', oracle: 'application-state', claimedSuccess: false, takeover: false, duplicateInputs: 0,
  scopeViolations: 0, postStopInputs: 0, durationMs: 100, modelRequests: 2, inputTokens: 10, outputTokens: 1, cost: null });
const baseline = { plan, runs: [row('a'), row('b')] };
const candidate = { plan: { ...plan, modelRef: 'candidate', taskIds: ['b', 'a'] },
  runs: baseline.runs.map(value => ({ ...value, modelRef: 'candidate', durationMs: 50, modelRequests: 1, actions: 1 })) };

describe('paired computer evaluations', () => {
  it('pairs by task and repetition even with reordered plans and measures only both-known values', () => {
    const result = compareComputerEvaluations(baseline, candidate);
    expect(result).toMatchObject({ pairedRuns: 2, complete: true, ties: 2, wins: 0, losses: 0,
      metrics: { durationMs: { deltaMean: -50, pairedMeasurements: 2 }, modelRequests: { deltaMean: -1 },
        actions: { pairedMeasurements: 0, deltaMean: null }, cost: { deltaMean: null }, rescueAttempts: { pairedMeasurements: 0, deltaMean: null } } });
  });
  it('compares measured rescue counts without inventing missing observations or grading recovery as success', () => {
    const before = { ...baseline, runs: baseline.runs.map(value => ({ ...value, rescueAttempts: 2, rescueExhaustions: 1 })) };
    const after = { ...candidate, runs: candidate.runs.map(value => ({ ...value, rescueAttempts: 1, rescueExhaustions: 0, outcome: 'failed' })) };
    expect(compareComputerEvaluations(before, after)).toMatchObject({ losses: 2, candidate: { rescueAttempts: 2, rescueExhaustions: 0 },
      metrics: { rescueAttempts: { pairedMeasurements: 2, deltaMean: -1 }, rescueExhaustions: { deltaMean: -1 } } });
  });
  it('keeps incomplete coverage and missing pairs explicit and never treats takeover as a win', () => {
    expect(compareComputerEvaluations(baseline, { ...candidate, runs: [{ ...candidate.runs[0], takeover: true }] }))
      .toMatchObject({ pairedRuns: 1, missingPairs: 1, complete: false, losses: 1, wins: 0, pairedSuccessRateDelta: -1 });
  });
  it.each([{ environment: 'other' }, { evidence: 'real-app' }, { repetitions: 2 }, { taskIds: ['a'] }])('rejects incomparable plans: %j', difference => {
    expect(() => compareComputerEvaluations(baseline, { ...candidate, plan: { ...candidate.plan, ...difference }, runs: [] })).toThrow('INCOMPARABLE');
  });
  it('recomputes results instead of trusting stored summaries and rejects duplicate runs', () => {
    expect(compareComputerEvaluations({ ...baseline, summary: { passed: 99 } }, candidate).baseline.passed).toBe(2);
    expect(() => compareComputerEvaluations({ ...baseline, runs: [row('a'), row('a')] }, candidate)).toThrow();
  });
});

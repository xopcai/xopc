import { describe, expect, it } from 'vitest';
import { evaluateComputerRuns, type ComputerEvaluationRun } from '../evaluation.js';

const plan = { taskIds: ['search', 'create'], repetitions: 3, modelRef: 'provider/model', environment: 'fixture-v1', evidence: 'fixture' };
const run: ComputerEvaluationRun = { taskId: 'search', repetition: 0, modelRef: plan.modelRef, environment: plan.environment,
  evidence: 'fixture', outcome: 'passed', oracle: 'application-state', claimedSuccess: true, takeover: false,
  duplicateInputs: 0, scopeViolations: 0, postStopInputs: 0, durationMs: 100, modelRequests: 2,
  inputTokens: 1000, outputTokens: 100, cost: 0.1 };
describe('computer task quality gates', () => {
  it('counts missing runs in the denominator and never certifies a fixture', () => {
    expect(evaluateComputerRuns(plan, [run])).toMatchObject({ expectedRuns: 6, missingRuns: 5, passed: 1, successRate: 1 / 6, costPerSuccess: null, betaGatePassed: false });
  });
  it('rejects duplicate, foreign and mixed-model runs', () => {
    for (const runs of [[run, run], [{ ...run, taskId: 'other' }], [{ ...run, modelRef: 'other' }], [{ ...run, repetition: 3 }]]) {
      expect(() => evaluateComputerRuns(plan, runs)).toThrow();
    }
  });
  it('does not accept model self-grading or human takeovers as autonomous success', () => {
    const report = evaluateComputerRuns(plan, [{ ...run, oracle: 'none' }, { ...run, repetition: 1, takeover: true }]);
    expect(report).toMatchObject({ passed: 0, falseSuccesses: 1, takeovers: 1, betaGatePassed: false });
  });
  it('requires a complete real-app matrix with independent outcomes and no incidents', () => {
    const full = { ...plan, taskIds: Array.from({ length: 60 }, (_, n) => `task-${n}`), evidence: 'real-app' };
    const rows = full.taskIds.flatMap(taskId => Array.from({ length: 3 }, (_, repetition) => ({ ...run, taskId, repetition, evidence: 'real-app' })));
    expect(evaluateComputerRuns(full, rows)).toMatchObject({ passed: 180, betaGatePassed: true });
    expect(evaluateComputerRuns(full, [{ ...rows[0], postStopInputs: 1 }, ...rows.slice(1)])).toMatchObject({ betaGatePassed: false, incidents: 1 });
    expect(evaluateComputerRuns(full, rows.slice(1))).toMatchObject({ betaGatePassed: false, missingRuns: 1 });
  });
});

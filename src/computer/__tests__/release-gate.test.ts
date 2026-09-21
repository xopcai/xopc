import { describe, expect, it } from 'vitest';
import { assertComputerReleaseEvidence } from '../release-gate.js';

const plan = { taskIds: Array.from({ length: 60 }, (_, index) => `task-${index}`), repetitions: 3,
  modelRef: 'provider/model', environment: 'macos-release', evidence: 'real-app' as const };
const runs = plan.taskIds.flatMap(taskId => Array.from({ length: 3 }, (_, repetition) => ({
  taskId, repetition, modelRef: plan.modelRef, environment: plan.environment, evidence: plan.evidence,
  outcome: 'passed' as const, oracle: 'application-state' as const, claimedSuccess: true, takeover: false,
  duplicateInputs: 0, scopeViolations: 0, postStopInputs: 0, durationMs: 1, modelRequests: 1,
  inputTokens: 1, outputTokens: 1, cost: null,
})));
const evidence = Object.fromEntries(runs.map(run => [`${run.taskId}:${run.repetition}`, `evidence/${run.taskId}-${run.repetition}.json`]));

describe('computer release gate', () => {
  it('accepts only a complete real-app matrix with distinct evidence', () => {
    expect(assertComputerReleaseEvidence({ plan, runs, evidence })).toMatchObject({ betaGatePassed: true, passed: 180 });
  });
  it('rejects missing or reused evidence', () => {
    const incomplete = { ...evidence }; delete incomplete['task-0:0'];
    expect(() => assertComputerReleaseEvidence({ plan, runs, evidence: incomplete })).toThrow('EVIDENCE_INCOMPLETE');
    expect(() => assertComputerReleaseEvidence({ plan, runs, evidence: { ...evidence, 'task-0:0': evidence['task-0:1'] } })).toThrow('EVIDENCE_INCOMPLETE');
  });
  it('recomputes quality instead of trusting a stored summary', () => {
    expect(() => assertComputerReleaseEvidence({ plan, runs: [{ ...runs[0], postStopInputs: 1 }, ...runs.slice(1)], evidence,
      summary: { betaGatePassed: true } })).toThrow('QUALITY_GATE_FAILED');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { runComputerEvaluationManifest } from '../evaluation-harness.js';

const manifest = {
  plan: { taskIds: ['task-a', 'task-b'], repetitions: 2, modelRef: 'provider/model', environment: 'macos-fixture', evidence: 'fixture' },
  executor: { command: ['executor'] },
  oracle: { command: ['oracle'] },
};

describe('computer evaluation harness', () => {
  it('runs a fixed matrix sequentially and lets only the oracle grade outcomes', async () => {
    const onRun = vi.fn();
    const execute = vi.fn(async (spec: any, input: any) => spec.command[0] === 'executor' ? {
      runId: `${input.taskId}-${input.repetition}`, claimedSuccess: true, takeover: false,
      duplicateInputs: 0, scopeViolations: 0, postStopInputs: 0, durationMs: 10,
      modelRequests: 1, inputTokens: 2, outputTokens: 3, cost: 0.01,
    } : { outcome: input.requestedOutcome ?? 'failed', oracle: 'application-state', evidenceRef: `evidence/${input.execution.runId}.json` });
    const result = await runComputerEvaluationManifest(manifest, { execute, onRun });
    expect(result.runs).toHaveLength(4);
    expect(result.runs.every(run => run.outcome === 'failed')).toBe(true);
    expect(Object.values(result.evidence)).toEqual([
      'evidence/task-a-0.json', 'evidence/task-a-1.json', 'evidence/task-b-0.json', 'evidence/task-b-1.json',
    ]);
    expect(onRun).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls.map(call => call[0].command[0])).toEqual(['executor', 'oracle', 'executor', 'oracle', 'executor', 'oracle', 'executor', 'oracle']);
  });

  it('rejects executor output that tries to supply its own grade', async () => {
    const execute = vi.fn(async () => ({ runId: 'run', outcome: 'passed', claimedSuccess: true, takeover: false,
      duplicateInputs: 0, scopeViolations: 0, postStopInputs: 0, durationMs: 1, modelRequests: 1,
      inputTokens: 1, outputTokens: 1, cost: null }));
    await expect(runComputerEvaluationManifest({ ...manifest, plan: { ...manifest.plan, taskIds: ['task-a'], repetitions: 1 } }, { execute }))
      .rejects.toThrow();
  });
});

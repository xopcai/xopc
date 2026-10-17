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
      modelRequests: 1, inputTokens: 2, outputTokens: 3, cost: 0.01, rescueAttempts: 1, rescueExhaustions: 0,
    } : { outcome: input.requestedOutcome ?? 'failed', oracle: 'application-state', evidenceRef: `evidence/${input.execution.runId}.json` });
    const result = await runComputerEvaluationManifest(manifest, { execute, onRun });
    expect(result.runs).toHaveLength(4);
    expect(result.runs.every(run => run.outcome === 'failed' && run.rescueAttempts === 1 && run.rescueExhaustions === 0)).toBe(true);
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
    const result = await runComputerEvaluationManifest({ ...manifest, plan: { ...manifest.plan, taskIds: ['task-a'], repetitions: 1 } }, { execute });
    expect(result).toMatchObject({ interrupted: true, runs: [{ outcome: 'unknown', oracle: 'none',
      failure: { category: 'harness', phase: 'executor', errorCode: 'COMPUTER_EVALUATION_INVALID_RESULT' } }] });
    expect(execute).toHaveBeenCalledOnce();
  });
  it('checkpoints an executor failure without invented zeros, raw exception text or starting another run', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('COMPUTER_EVALUATION_TIMEOUT'));
    const onRun = vi.fn();
    const result = await runComputerEvaluationManifest(manifest, { execute, onRun });
    expect(result).toMatchObject({ interrupted: true, evidence: {}, runs: [{ outcome: 'unknown', oracle: 'none', modelRequests: null,
      duplicateInputs: null, failure: { category: 'harness', phase: 'executor', dispatch: 'unknown' } }] });
    expect(execute).toHaveBeenCalledOnce(); expect(onRun).toHaveBeenCalledOnce();
    const privateResult = await runComputerEvaluationManifest(manifest, { execute: async () => { throw new Error('private output and token'); } });
    expect(JSON.stringify(privateResult)).not.toContain('private');
  });
  it('keeps executor measurements when the independent oracle fails and never accepts its claimed success', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ runId: 'id', claimedSuccess: true, takeover: false,
      duplicateInputs: 0, scopeViolations: 0, postStopInputs: 0, durationMs: 50, modelRequests: 2, inputTokens: 5, outputTokens: 2, cost: null })
      .mockRejectedValueOnce(new Error('COMPUTER_EVALUATION_PROCESS_FAILED'));
    const result = await runComputerEvaluationManifest(manifest, { execute });
    expect(result).toMatchObject({ interrupted: true, runs: [{ outcome: 'unknown', oracle: 'none', modelRequests: 2,
      claimedSuccess: true, failure: { phase: 'oracle', dispatch: 'completed' } }] });
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('honors cancellation and rejects duplicate tasks before starting any process', async () => {
    const controller = new AbortController(); controller.abort();
    const execute = vi.fn();
    await expect(runComputerEvaluationManifest(manifest, { execute, signal: controller.signal })).rejects.toThrow();
    await expect(runComputerEvaluationManifest({ ...manifest, plan: { ...manifest.plan, taskIds: ['a', 'a'] } }, { execute })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});

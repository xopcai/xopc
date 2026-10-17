import { z } from 'zod';

import { spawnProcess } from '../process/run-process.js';
import { classifyComputerFailure } from './diagnostics.js';
import {
  ComputerEvaluationPlanSchema,
  ComputerEvaluationRunSchema,
  type ComputerEvaluationRun,
} from './evaluation.js';

const CommandSchema = z.object({
  command: z.array(z.string().min(1)).min(1).max(100),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).default(300_000),
}).strict();

export const ComputerEvaluationHarnessManifestSchema = z.object({
  plan: ComputerEvaluationPlanSchema,
  executor: CommandSchema,
  oracle: CommandSchema,
}).strict();
export type ComputerEvaluationHarnessManifest = z.infer<typeof ComputerEvaluationHarnessManifestSchema>;

const ExecutorResultSchema = ComputerEvaluationRunSchema.pick({
  claimedSuccess: true,
  takeover: true,
  duplicateInputs: true,
  scopeViolations: true,
  postStopInputs: true,
  durationMs: true,
  modelRequests: true,
  inputTokens: true,
  outputTokens: true,
  cost: true,
  actions: true, unchangedInputs: true, observationChanges: true, failure: true,
}).extend({ runId: z.string().min(1).max(500) }).strict();

const OracleResultSchema = ComputerEvaluationRunSchema.pick({ outcome: true, oracle: true }).extend({
  evidenceRef: z.string().min(1).max(2_000),
}).strict();

type ExecuteCommand = (spec: z.infer<typeof CommandSchema>, input: unknown, signal?: AbortSignal) => Promise<unknown>;

/** Run one JSON-in/JSON-out harness process without a shell or inherited stdin. */
export async function executeEvaluationCommand(spec: z.infer<typeof CommandSchema>, input: unknown, signal?: AbortSignal): Promise<unknown> {
  const [file, ...args] = spec.command;
  const maxOutputBytes = 1_048_576;
  let outputBytes = 0;
  let outputLimitExceeded = false;
  const handle = spawnProcess({
    program: file,
    args,
    cwd: spec.cwd,
    env: process.env,
    input: JSON.stringify(input),
    shell: false,
    signal,
    timeoutMs: spec.timeoutMs,
    maxOutputBytes,
    terminationPolicy: 'tree',
    onOutput: (_stream, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes && !outputLimitExceeded) {
        outputLimitExceeded = true;
        handle.terminate();
      }
    },
  });
  const result = await handle.completion;
  if (outputLimitExceeded) throw new Error('COMPUTER_EVALUATION_OUTPUT_LIMIT');
  if (result.timedOut) throw new Error('COMPUTER_EVALUATION_TIMEOUT');
  if (result.aborted) {
    signal?.throwIfAborted();
    throw new Error('COMPUTER_EVALUATION_ABORTED');
  }
  if (result.exitCode !== 0) {
    throw new Error('COMPUTER_EVALUATION_PROCESS_FAILED');
  }
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('COMPUTER_EVALUATION_INVALID_JSON'); }
}

/** Executor and oracle are deliberately separate processes; the oracle alone grades success. */
export async function runComputerEvaluationManifest(raw: unknown, options: {
  execute?: ExecuteCommand;
  signal?: AbortSignal;
  onRun?: (run: ComputerEvaluationRun, evidenceRef?: string) => void | Promise<void>;
} = {}): Promise<{ plan: z.infer<typeof ComputerEvaluationPlanSchema>; runs: ComputerEvaluationRun[]; evidence: Record<string, string>; interrupted: boolean }> {
  const manifest = ComputerEvaluationHarnessManifestSchema.parse(raw);
  const execute = options.execute ?? executeEvaluationCommand;
  const runs: ComputerEvaluationRun[] = [];
  const evidence: Record<string, string> = {};
  for (const taskId of manifest.plan.taskIds) {
    for (let repetition = 0; repetition < manifest.plan.repetitions; repetition++) {
      options.signal?.throwIfAborted();
      const request = { taskId, repetition, modelRef: manifest.plan.modelRef, environment: manifest.plan.environment,
        evidence: manifest.plan.evidence };
      const startedAt = Date.now();
      let execution: z.infer<typeof ExecutorResultSchema> | undefined;
      let oracle: z.infer<typeof OracleResultSchema>;
      let phase: 'executor' | 'oracle' = 'executor';
      try {
        execution = ExecutorResultSchema.parse(await execute(manifest.executor, request, options.signal));
        phase = 'oracle';
        oracle = OracleResultSchema.parse(await execute(manifest.oracle, { ...request, execution }, options.signal));
      } catch (error) {
        options.signal?.throwIfAborted();
        const { runId: _runId, ...measurements } = execution ?? { runId: '', claimedSuccess: false, takeover: false,
          duplicateInputs: null, scopeViolations: null, postStopInputs: null,
          durationMs: Math.max(0, Date.now() - startedAt), modelRequests: null, inputTokens: null, outputTokens: null, cost: null };
        const run = ComputerEvaluationRunSchema.parse({ ...request, ...measurements, outcome: 'unknown', oracle: 'none',
          failure: classifyComputerFailure(error instanceof z.ZodError ? new Error('COMPUTER_EVALUATION_INVALID_RESULT') : error,
            phase, phase === 'executor' ? 'unknown' : 'completed') });
        runs.push(run);
        await options.onRun?.(run);
        // A killed executor may already have delivered input. Preserve the partial matrix and stop.
        return { plan: manifest.plan, runs, evidence, interrupted: true };
      }
      const { runId: _runId, ...measurements } = execution;
      const { evidenceRef, ...grade } = oracle;
      const run = ComputerEvaluationRunSchema.parse({ ...request, ...measurements, ...grade });
      runs.push(run);
      evidence[`${taskId}:${repetition}`] = evidenceRef;
      await options.onRun?.(run, evidenceRef);
      if (run.failure?.dispatch === 'unknown' || run.failure?.dispatch === 'started'
        || run.scopeViolations !== 0 || run.postStopInputs !== 0 || run.duplicateInputs !== 0) {
        return { plan: manifest.plan, runs, evidence, interrupted: true };
      }
    }
  }
  return { plan: manifest.plan, runs, evidence, interrupted: false };
}

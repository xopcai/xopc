import { z } from 'zod';

import { spawnProcess } from '../process/run-process.js';
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
    throw new Error(`COMPUTER_EVALUATION_PROCESS_FAILED:${result.spawnErrorCode ?? result.exitCode}:${result.stderr.slice(0, 1_000)}`);
  }
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('COMPUTER_EVALUATION_INVALID_JSON'); }
}

/** Executor and oracle are deliberately separate processes; the oracle alone grades success. */
export async function runComputerEvaluationManifest(raw: unknown, options: {
  execute?: ExecuteCommand;
  signal?: AbortSignal;
  onRun?: (run: ComputerEvaluationRun, evidenceRef: string) => void | Promise<void>;
} = {}): Promise<{ plan: z.infer<typeof ComputerEvaluationPlanSchema>; runs: ComputerEvaluationRun[]; evidence: Record<string, string> }> {
  const manifest = ComputerEvaluationHarnessManifestSchema.parse(raw);
  const execute = options.execute ?? executeEvaluationCommand;
  const runs: ComputerEvaluationRun[] = [];
  const evidence: Record<string, string> = {};
  for (const taskId of manifest.plan.taskIds) {
    for (let repetition = 0; repetition < manifest.plan.repetitions; repetition++) {
      options.signal?.throwIfAborted();
      const request = { taskId, repetition, modelRef: manifest.plan.modelRef, environment: manifest.plan.environment,
        evidence: manifest.plan.evidence };
      const execution = ExecutorResultSchema.parse(await execute(manifest.executor, request, options.signal));
      const oracle = OracleResultSchema.parse(await execute(manifest.oracle, { ...request, execution }, options.signal));
      const { runId: _runId, ...measurements } = execution;
      const { evidenceRef, ...grade } = oracle;
      const run = ComputerEvaluationRunSchema.parse({ ...request, ...measurements, ...grade });
      runs.push(run);
      evidence[`${taskId}:${repetition}`] = evidenceRef;
      await options.onRun?.(run, evidenceRef);
    }
  }
  return { plan: manifest.plan, runs, evidence };
}

import { spawn } from 'node:child_process';
import { z } from 'zod';
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
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const child = spawn(file, args, { cwd: spec.cwd, env: process.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], signal: combined });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const collect = (chunks: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 1_048_576) controller.abort(new Error('COMPUTER_EVALUATION_OUTPUT_LIMIT'));
      else chunks.push(chunk);
    };
    child.stdout.on('data', chunk => collect(stdout, Buffer.from(chunk)));
    child.stderr.on('data', chunk => collect(stderr, Buffer.from(chunk)));
    const timer = setTimeout(() => controller.abort(new Error('COMPUTER_EVALUATION_TIMEOUT')), spec.timeoutMs);
    timer.unref?.();
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`COMPUTER_EVALUATION_PROCESS_FAILED:${code}:${Buffer.concat(stderr).toString('utf8').slice(0, 1_000)}`));
      try { resolve(JSON.parse(Buffer.concat(stdout).toString('utf8'))); }
      catch { reject(new Error('COMPUTER_EVALUATION_INVALID_JSON')); }
    });
    child.stdin.end(JSON.stringify(input));
  });
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

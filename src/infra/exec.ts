import type { ChildProcess } from 'node:child_process';

import { ProcessExitError } from '../process/process-spec.js';
import { runProcess, spawnProcess } from '../process/run-process.js';

export type ExecResult = {
  stdout: string;
  stderr: string;
};

export type ExecOptions = {
  timeoutMs?: number;
  maxBuffer?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

/** Run a subprocess and capture stdout/stderr (OpenClaw-aligned). */
export async function runExec(
  file: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const result = await runProcess({
    program: file,
    args,
    cwd: opts.cwd,
    env: opts.env,
    timeoutMs: opts.timeoutMs,
    maxOutputBytes: opts.maxBuffer,
    terminationPolicy: 'tree',
  });
  if (result.exitCode !== 0) {
    const error = new ProcessExitError({ program: file, args }, result) as ProcessExitError & { stdout: string; stderr: string };
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

export function spawnDetached(
  file: string,
  args: string[],
  opts: { stdio?: 'ignore' | 'pipe' },
): ChildProcess {
  const handle = spawnProcess({ program: file, args, detached: false });
  if (opts.stdio === 'ignore') {
    handle.child.stdout?.resume();
    handle.child.stderr?.resume();
  }
  return handle.child;
}

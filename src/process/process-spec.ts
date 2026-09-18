import type { ChildProcess, SpawnOptions } from 'node:child_process';

export interface ProcessSpec {
  program: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  keepStdinOpen?: boolean;
  timeoutMs?: number | null;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  detached?: boolean;
  windowsHide?: boolean;
  shell?: SpawnOptions['shell'];
  terminationPolicy?: 'root' | 'tree';
  onOutput?: (stream: 'stdout' | 'stderr', chunk: Buffer) => void;
}

export interface ProcessResult {
  exitCode: number | null;
  spawnErrorCode?: string;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  outputTruncated: boolean;
  terminationVerified: boolean;
}

export interface ProcessHandle {
  readonly child: ChildProcess;
  readonly completion: Promise<ProcessResult>;
  terminate(reason?: 'cancelled' | 'timed_out'): void;
}

export class ProcessExitError extends Error {
  readonly code: number | string | null;

  constructor(
    readonly spec: ProcessSpec,
    readonly result: ProcessResult,
  ) {
    super(result.stderr.trim() || `Process exited with code ${String(result.exitCode)}`);
    this.name = 'ProcessExitError';
    this.code = result.spawnErrorCode ?? result.exitCode;
  }
}

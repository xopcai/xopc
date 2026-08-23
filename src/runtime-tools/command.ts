import { spawn } from 'node:child_process';

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;

export interface RuntimeCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
}

export async function runRuntimeCommand(params: {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<RuntimeCommandResult> {
  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;
    const child = spawn(params.command, params.args, {
      env: params.env,
      shell: false,
      windowsHide: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      params.signal?.removeEventListener('abort', abort);
      resolve({
        ok: exitCode === 0 && !timedOut && !aborted,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        timedOut,
        aborted,
      });
    };
    const abort = () => {
      aborted = true;
      child.kill('SIGKILL');
      finish(null);
    };
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', () => finish(null));
    child.once('close', finish);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      finish(null);
    }, params.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
    timeout.unref();
    if (params.signal?.aborted) abort();
    else params.signal?.addEventListener('abort', abort, { once: true });
  });
}

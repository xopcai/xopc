import { spawn } from 'node:child_process';

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

export interface RuntimeCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  outputTruncated: boolean;
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
    let outputTruncated = false;
    let timeout: NodeJS.Timeout | undefined;
    const child = spawn(params.command, params.args, {
      detached: process.platform !== 'win32',
      env: params.env,
      shell: false,
      windowsHide: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const killChild = () => {
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch {
          // Fall back to terminating the direct child.
        }
      }
      child.kill('SIGKILL');
    };
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      params.signal?.removeEventListener('abort', abort);
      resolve({
        ok: exitCode === 0 && !timedOut && !aborted && !outputTruncated,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        timedOut,
        aborted,
        outputTruncated,
      });
    };
    const abort = () => {
      aborted = true;
      killChild();
      finish(null);
    };
    const appendOutput = (current: string, chunk: Buffer): string => {
      const currentBytes = Buffer.byteLength(current);
      const remaining = MAX_COMMAND_OUTPUT_BYTES - currentBytes;
      if (remaining <= 0 || chunk.byteLength > remaining) {
        outputTruncated = true;
        killChild();
        return remaining > 0 ? current + chunk.subarray(0, remaining).toString() : current;
      }
      return current + chunk.toString();
    };
    child.stdout?.on('data', (chunk: Buffer) => { stdout = appendOutput(stdout, chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = appendOutput(stderr, chunk); });
    child.once('error', () => finish(null));
    child.once('close', finish);
    timeout = setTimeout(() => {
      timedOut = true;
      killChild();
      finish(null);
    }, params.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
    timeout.unref();
    if (params.signal?.aborted) abort();
    else params.signal?.addEventListener('abort', abort, { once: true });
  });
}

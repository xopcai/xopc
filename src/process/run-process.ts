import { spawn } from 'node:child_process';

import { createBoundedOutput } from './bounded-output.js';
import { terminateProcess } from './kill-tree.js';
import { ProcessExitError, type ProcessHandle, type ProcessResult, type ProcessSpec } from './process-spec.js';

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export function spawnProcess(spec: ProcessSpec): ProcessHandle {
  spec.signal?.throwIfAborted();
  const detached = spec.detached ?? (spec.terminationPolicy === 'tree' && process.platform !== 'win32');
  const child = spawn(spec.program, [...(spec.args ?? [])], {
    cwd: spec.cwd,
    env: spec.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached,
    windowsHide: spec.windowsHide ?? true,
    shell: spec.shell ?? false,
  });
  const stdout = createBoundedOutput(spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
  const stderr = createBoundedOutput(spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
  let timedOut = false;
  let aborted = false;
  let terminationRequested = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const terminate = (reason: 'cancelled' | 'timed_out' = 'cancelled') => {
    if (settled || terminationRequested) return;
    terminationRequested = true;
    timedOut = reason === 'timed_out';
    aborted = reason === 'cancelled';
    void terminateProcess(child, { tree: spec.terminationPolicy === 'tree', detached });
  };

  const abort = () => terminate('cancelled');
  spec.signal?.addEventListener('abort', abort, { once: true });
  if (spec.signal?.aborted) abort();
  if (spec.timeoutMs != null && spec.timeoutMs > 0) {
    timer = setTimeout(() => terminate('timed_out'), spec.timeoutMs);
    timer.unref();
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    stdout.append(chunk);
    spec.onOutput?.('stdout', chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr.append(chunk);
    spec.onOutput?.('stderr', chunk);
  });
  child.stdin?.on('error', (error: Error) => stderr.append(error.message));
  if (spec.input !== undefined) child.stdin?.end(spec.input);
  else if (!spec.keepStdinOpen) child.stdin?.end();

  const completion = new Promise<ProcessResult>((resolve) => {
    let spawnError: Error | undefined;
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      spec.signal?.removeEventListener('abort', abort);
      if (spawnError && stderr.snapshot().totalBytes === 0) stderr.append(spawnError.message);
      const out = stdout.snapshot();
      const err = stderr.snapshot();
      resolve({
        exitCode: spawnError ? null : exitCode,
        ...(spawnError && (spawnError as NodeJS.ErrnoException).code
          ? { spawnErrorCode: (spawnError as NodeJS.ErrnoException).code }
          : {}),
        signal,
        stdout: out.text,
        stderr: err.text,
        timedOut,
        aborted,
        outputTruncated: out.truncated || err.truncated,
        terminationVerified: !terminationRequested || child.exitCode !== null || child.signalCode !== null,
      });
    });
  });

  return { child, completion, terminate };
}

export function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  return spawnProcess(spec).completion;
}

export async function runProcessChecked(spec: ProcessSpec): Promise<ProcessResult> {
  const result = await runProcess(spec);
  if (result.exitCode !== 0) throw new ProcessExitError(spec, result);
  return result;
}

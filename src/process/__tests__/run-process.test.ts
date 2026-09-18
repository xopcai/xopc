import { describe, expect, it } from 'vitest';

import { createBoundedOutput } from '../bounded-output.js';
import { runProcess, runProcessChecked } from '../run-process.js';

describe('process runtime', () => {
  it('captures output and rejects checked non-zero exits', async () => {
    const result = await runProcess({
      program: process.execPath,
      args: ['-e', 'process.stdout.write("ok"); process.stderr.write("warning")'],
    });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'ok', stderr: 'warning', timedOut: false, aborted: false });

    await expect(runProcessChecked({
      program: process.execPath,
      args: ['-e', 'process.stderr.write("bad"); process.exit(7)'],
    })).rejects.toMatchObject({ result: { exitCode: 7, stderr: 'bad' } });
  });

  it('returns spawn errors as a single terminal result', async () => {
    const result = await runProcess({ program: `missing-command-${Date.now()}` });
    expect(result.exitCode).toBeNull();
    expect(result.spawnErrorCode).toBe('ENOENT');
    expect(result.stderr).toMatch(/ENOENT|not found/i);
  });

  it('terminates on timeout and abort with explicit reasons', async () => {
    const timedOut = await runProcess({
      program: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 20,
      terminationPolicy: 'tree',
    });
    expect(timedOut).toMatchObject({ timedOut: true, aborted: false, terminationVerified: true });

    const controller = new AbortController();
    const abortedPromise = runProcess({
      program: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      signal: controller.signal,
      terminationPolicy: 'tree',
    });
    controller.abort();
    await expect(abortedPromise).resolves.toMatchObject({ timedOut: false, aborted: true, terminationVerified: true });
  });

  it('bounds captured output by bytes and retains the tail', () => {
    const output = createBoundedOutput(4);
    output.append('before');
    output.append('tail');
    expect(output.snapshot()).toEqual({ text: 'tail', totalBytes: 10, truncated: true });
  });
});

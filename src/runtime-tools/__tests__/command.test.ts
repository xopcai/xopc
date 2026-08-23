import { describe, expect, it } from 'vitest';

import { runRuntimeCommand } from '../command.js';

describe('runtime command runner', () => {
  it('captures successful command output', async () => {
    const result = await runRuntimeCommand({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("ok")'],
    });
    expect(result).toMatchObject({ ok: true, stdout: 'ok', timedOut: false, aborted: false });
  });

  it('terminates commands at their operation timeout', async () => {
    const result = await runRuntimeCommand({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 50,
    });
    expect(result).toMatchObject({ ok: false, timedOut: true, aborted: false });
  });

  it('honors an already-aborted operation', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runRuntimeCommand({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      signal: controller.signal,
    });
    expect(result).toMatchObject({ ok: false, timedOut: false, aborted: true });
  });
});

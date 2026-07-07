import { mkdtemp, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createExecCommandTool } from '../exec-command.js';

describe('exec_command tool', () => {
  it('streams output deltas and returns structured command details', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-'));
    try {
      const tool = createExecCommandTool(workspace);
      const updates: unknown[] = [];
      const result = await tool.execute(
        'tc1',
        { cmd: 'printf "hello"; printf "err" >&2', timeoutMs: 10_000 },
        undefined,
        (update) => {
          updates.push(update.details);
        },
      );

      expect(result.details.exitCode).toBe(0);
      expect(result.details.status).toBe('success');
      expect(result.details.failureHint).toBeUndefined();
      expect(result.details.cwd).toContain(basename(workspace));
      expect(result.details.stdout).toBe('hello');
      expect(result.details.stderr).toBe('err');
      expect(result.details.aggregatedOutput).toContain('hello');
      expect(updates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'command_output_delta', stream: 'stdout', delta: 'hello' }),
          expect.objectContaining({ kind: 'command_output_delta', stream: 'stderr', delta: 'err' }),
        ]),
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('returns actionable failure hints for non-zero exits', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-'));
    try {
      const tool = createExecCommandTool(workspace);
      const result = await tool.execute('tc2', {
        cmd: 'printf "bad" >&2; exit 7',
        timeoutMs: 10_000,
      });

      expect(result.details.status).toBe('failed');
      expect(result.details.exitCode).toBe(7);
      expect(result.details.failureHint).toContain('Inspect stderr');
      expect((result.content[0] as { text: string }).text).toContain('Next action:');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

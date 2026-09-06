import { describe, expect, it, vi } from 'vitest';
import type { AfterToolCallContext } from '@earendil-works/pi-agent-core';

import { RunVerification } from '../run-verification.js';
import { classifyVerificationCommand } from '../verification-command.js';

describe('coding verification', () => {
  it.each(['echo test', 'cat test.ts', 'pnpm test || true', 'pnpm test; true', 'git status', 'git diff --stat', 'vitest --version', 'pytest --collect-only'])('does not accept %s as a check or review', (command) => {
    expect(classifyVerificationCommand(command)).toBeUndefined();
  });

  it.each(['pnpm test', 'pnpm -C web run type-check', 'pytest tests/unit', 'vitest run', 'cargo test'])('recognizes direct check %s', (command) => {
    expect(classifyVerificationCommand(command)).toBe('check');
  });

  it('binds evidence to file content and invalidates checks after another edit', async () => {
    let revision = 'before';
    const run = new RunVerification(async () => revision);
    const execute = async (name: string, command = '', exitCode = 0, mutate?: string) => {
      const id = `${name}-${command}`;
      await run.beforeTool(id);
      if (mutate) revision = mutate;
      return run.afterTool({
        toolCall: { id, name }, args: { cmd: command }, isError: false,
        result: { content: [], details: { command, exitCode, complete: true } },
      } as unknown as AfterToolCallContext);
    };
    await execute('apply_patch', '', 0, 'edited');
    await execute('exec_command', 'echo test');
    expect(await run.pendingContext()).toContain('Run the smallest');
    await execute('review_workspace', 'review_workspace');
    await execute('exec_command', 'pnpm test');
    expect(await run.pendingContext()).toBe('');
    await execute('apply_patch', '', 0, 'edited-again');
    expect(await run.pendingContext()).toContain('Run the smallest');
    expect((await run.summary()).evidence.every((item) => item.status === 'unverified')).toBe(true);
    const failed = await execute('exec_command', 'pnpm test', 1);
    expect(failed.isError).toBe(true);
    expect(await run.pendingContext()).toContain('failed check');
  });

  it('does not certify a check when files change while it executes', async () => {
    const snapshot = vi.fn().mockResolvedValueOnce('a').mockResolvedValue('b');
    const run = new RunVerification(snapshot);
    await run.beforeTool('check');
    const result = await run.afterTool({
      toolCall: { id: 'check', name: 'exec_command' }, args: {}, isError: false,
      result: { content: [], details: { command: 'pnpm test', exitCode: 0 } },
    } as unknown as AfterToolCallContext);
    expect((result.result.details as any).verification.status).toBe('unverified');
  });

  it('restores interrupted work without reusing checks from another revision', async () => {
    const run = new RunVerification(async () => 'now');
    await run.beforeTool('initialize');
    run.restore({ changed: true, revision: 'old', evidence: [{ kind: 'check', command: 'pnpm test', toolCallId: 'old-check', revision: 'old', status: 'passed' }] }, true);
    expect(await run.pendingContext()).toContain('Run the smallest');
    expect((await run.summary()).evidence[0]?.status).toBe('unverified');
    const interrupted = new RunVerification(async () => 'now');
    await interrupted.beforeTool('initialize');
    interrupted.restore({ revision: 'before-crash', changed: false }, false);
    expect(await interrupted.pendingContext()).toContain('review_workspace');
  });

  it('keeps missing workspace snapshots unverified', async () => {
    const run = new RunVerification(async () => undefined);
    await run.beforeTool('check');
    const result = await run.afterTool({
      toolCall: { id: 'check', name: 'exec_command' }, args: {}, isError: false,
      result: { content: [], details: { command: 'pnpm test', exitCode: 0 } },
    } as unknown as AfterToolCallContext);
    expect((result.result.details as any).verification.status).toBe('unverified');
  });
});

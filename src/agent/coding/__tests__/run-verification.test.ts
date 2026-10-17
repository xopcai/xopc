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
    expect(run.modelGuidance()).toContain('Read the inputs named by the current request directly');
    const execute = async (name: string, command = '', exitCode = 0, mutate?: string) => {
      const id = `${name}-${command}`;
      await run.beforeTool(id);
      if (mutate) revision = mutate;
      return run.afterTool({
        toolCall: { id, name }, args: { cmd: command }, isError: false,
        result: { content: [], details: { command, exitCode, complete: true } },
      } as unknown as AfterToolCallContext);
    };
    const changed = await execute('apply_patch', '', 0, 'edited');
    expect(changed.result.details).toMatchObject({ verificationPending: ['check', 'diff-review'] });
    expect(run.modelGuidance()).toContain('Still missing:');
    const inspection = await execute('exec_command', 'node --test verify.test.cjs && git status');
    expect(inspection.result.details).toMatchObject({ verificationPending: ['check', 'diff-review'], verificationHint: expect.stringContaining('standalone') });
    expect(inspection.result.content).toContainEqual({ type: 'text', text: expect.stringContaining('This command did not record a check') });
    expect((inspection.result.details as any).verification).toBeUndefined();
    expect(await run.pendingContext()).toContain('Run the smallest');
    await execute('review_workspace', 'review_workspace');
    const checked = await execute('exec_command', 'pnpm test');
    expect(checked.result.details).toMatchObject({ verificationPending: [] });
    expect(checked.result.content).toContainEqual({ type: 'text', text: 'Verification pending for current files: none.' });
    expect(await run.pendingContext()).toBe('');
    expect(run.modelGuidance()).toContain('give the final answer now');
    const editedAgain = await execute('apply_patch', '', 0, 'edited-again');
    expect(editedAgain.result.details).toMatchObject({ verificationPending: ['check', 'diff-review'] });
    expect(await run.pendingContext()).toContain('Run the smallest');
    expect(run.modelGuidance()).not.toContain('verification complete');
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

describe('proportionate runtime verification', () => {
  function fixture(options: ConstructorParameters<typeof RunVerification>[1] = {}) {
    let revision = 'initial';
    const run = new RunVerification(async () => revision, options);
    let count = 0;
    const execute = async (name: string, args: Record<string, unknown>, change = false) => {
      const id = String(++count);
      await run.beforeTool(id, name);
      if (change) revision = `revision-${count}`;
      return run.afterTool({ toolCall: { id, name }, args, isError: false,
        result: { content: [], details: { command: args.cmd ?? name, exitCode: 0, complete: true } },
      } as unknown as AfterToolCallContext);
    };
    return { run, execute };
  }

  it('does not add coding instructions to passive evidence collection', async () => {
    const { run, execute } = fixture({ required: false });
    const changed = await execute('write_file', { path: 'report.md' }, true);
    expect(changed.result.content).toEqual([]);
    expect(changed.result.details).not.toHaveProperty('verificationPending');
    expect(run.modelGuidance()).toBe('');
    expect(await run.pendingContext()).toBe('');
    expect(await run.summary()).toMatchObject({ changed: true });
  });

  it('requires content review for prose without inventing assertion scripts', async () => {
    const { run, execute } = fixture();
    const changed = await execute('write_file', { path: 'report.md' }, true);
    expect(changed.result.details).toMatchObject({ verificationPending: ['diff-review'] });
    expect(run.modelGuidance()).toContain('no assertion script is required');
    expect(run.modelGuidance()).not.toContain('standalone assertion test');
    await execute('review_workspace', {});
    expect(await run.pendingContext()).toBe('');
    expect(run.modelGuidance()).toContain('give the final answer now');
    expect(await run.summary()).toMatchObject({ proseOnly: true });
    const code = await execute('write_file', { path: 'logic.ts' }, true);
    expect(code.result.details).toMatchObject({ verificationPending: ['check', 'diff-review'] });
  });

  it.each([
    '*** Update File: report.md\n*** Update File: logic.ts',
    '*** Update File: report.md\n*** Move to: logic.ts',
    '*** Update File: config.json',
  ])('keeps behavior checks for mixed, renamed, or machine-readable changes', async patch => {
    const { execute } = fixture();
    expect((await execute('apply_patch', { patch }, true)).result.details)
      .toMatchObject({ verificationPending: ['check', 'diff-review'] });
  });

  it('does not instruct missing review or shell tools', async () => {
    const { run, execute } = fixture({ toolNames: ['write_file', 'read_file'] });
    const result = await execute('write_file', { path: 'report.md' }, true);
    const guidance = [run.modelGuidance(), await run.pendingContext(), JSON.stringify(result.result.content)].join('\n');
    expect(guidance).toContain('content inspection');
    expect(guidance).not.toContain('exec_command');
    expect(guidance).not.toContain('review_workspace');
  });

  it('preserves prose scope on resume but treats unknown changes conservatively', async () => {
    const { run, execute } = fixture();
    await execute('write_file', { path: 'report.md' }, true);
    const checkpoint = await run.summary();
    const resumed = new RunVerification(async () => checkpoint.revision);
    await resumed.beforeTool('initialize');
    resumed.restore(checkpoint, true);
    expect(resumed.modelGuidance()).not.toContain('standalone assertion test');
    const unknown = new RunVerification(async () => 'different');
    await unknown.beforeTool('initialize');
    unknown.restore(checkpoint, true);
    expect(unknown.modelGuidance()).toContain('standalone assertion test');
  });
});

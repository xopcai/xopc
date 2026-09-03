import crypto from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ExecutionCommand } from '@xopcai/realtime-protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runExec } from '../../infra/exec.js';
import {
  ExecutionHostWorkspaceRuntime,
  validateRemoteRepositoryUrl,
} from '../workspace-runtime.js';
import { boundWorkspaceToolResultForTransport } from '../tool-result-transport.js';

function command(input: Partial<ExecutionCommand> & Pick<ExecutionCommand, 'command' | 'payload'>): ExecutionCommand {
  return {
    operationId: crypto.randomUUID(),
    environmentId: 'env-1',
    bindingEpoch: 1,
    deadlineAt: Date.now() + 30_000,
    idempotencyKey: crypto.randomUUID(),
    ...input,
  };
}

describe('ExecutionHostWorkspaceRuntime', () => {
  let root: string;
  let source: string;
  let stateDir: string;
  let baseSha: string;
  let runtime: ExecutionHostWorkspaceRuntime;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'xopc-host-workspace-'));
    source = join(root, 'source');
    stateDir = join(root, 'state');
    await mkdir(source, { recursive: true });
    await runExec('git', ['init'], { cwd: source });
    writeFileSync(join(source, 'README.md'), 'baseline\n');
    await runExec('git', ['add', 'README.md'], { cwd: source });
    await runExec('git', ['-c', 'user.name=xopc test', '-c', 'user.email=xopc@example.test', 'commit', '-m', 'baseline'], { cwd: source });
    baseSha = (await runExec('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
    runtime = new ExecutionHostWorkspaceRuntime(stateDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('provisions a detached worktree and executes only fixed workspace tools', async () => {
    const signal = new AbortController().signal;
    const provision = command({
      command: 'environment.provision',
      payload: { repositoryUrl: pathToFileURL(source).toString(), baseSha },
    });
    const provisioned = await runtime.execute(provision, signal, () => undefined) as { rootPath: string };
    expect(readFileSync(join(provisioned.rootPath, 'README.md'), 'utf8')).toBe('baseline\n');

    const write = command({
      command: 'workspace.execute_tool',
      payload: { toolCallId: 'call-1', toolName: 'write_file', params: { path: 'remote.txt', content: 'remote\n' } },
    });
    await expect(runtime.execute(write, signal, () => undefined)).resolves.toMatchObject({
      details: { size: 7 },
    });
    expect(readFileSync(join(provisioned.rootPath, 'remote.txt'), 'utf8')).toBe('remote\n');

    writeFileSync(join(provisioned.rootPath, 'remote.txt'), 'changed outside command\n');
    await runtime.execute({ ...write, operationId: crypto.randomUUID() }, signal, () => undefined);
    expect(readFileSync(join(provisioned.rootPath, 'remote.txt'), 'utf8')).toBe('changed outside command\n');

    const inspect = await runtime.execute(command({
      command: 'environment.inspect',
      payload: {},
    }), signal, () => undefined);
    expect(inspect).toMatchObject({ healthy: true, dirty: true, headSha: baseSha });
  });

  it('rejects stale binding epochs after observing a newer binding', async () => {
    const signal = new AbortController().signal;
    await runtime.execute(command({
      command: 'environment.provision',
      payload: { repositoryUrl: pathToFileURL(source).toString(), baseSha },
    }), signal, () => undefined);
    await runtime.execute(command({
      command: 'workspace.execute_tool',
      bindingEpoch: 2,
      payload: { toolCallId: 'call-2', toolName: 'read_file', params: { path: 'README.md' } },
    }), signal, () => undefined);
    await expect(runtime.execute(command({
      command: 'workspace.execute_tool',
      bindingEpoch: 1,
      payload: { toolCallId: 'call-3', toolName: 'read_file', params: { path: 'README.md' } },
    }), signal, () => undefined)).rejects.toMatchObject({ code: 'STALE_BINDING' });
  });

  it('removes only its managed worktree and keeps the repository mirror', async () => {
    const signal = new AbortController().signal;
    const provisioned = await runtime.execute(command({
      command: 'environment.provision',
      payload: { repositoryUrl: pathToFileURL(source).toString(), baseSha },
    }), signal, () => undefined) as { rootPath: string; repositoryRoot: string };

    await expect(runtime.execute(command({ command: 'environment.remove', payload: {} }), signal, () => undefined))
      .resolves.toEqual({ removed: true });
    expect(existsSync(provisioned.rootPath)).toBe(false);
    expect(readFileSync(join(provisioned.repositoryRoot, 'HEAD'), 'utf8')).toBeTruthy();
  });

  it('rejects embedded HTTP credentials', () => {
    expect(() => validateRemoteRepositoryUrl('https://token:secret@example.com/repo.git'))
      .toThrow(/must not contain HTTP credentials/);
  });

  it('bounds duplicated tool details before sending them over realtime', () => {
    const output = 'x'.repeat(200 * 1024);
    const result = boundWorkspaceToolResultForTransport({
      content: [{ type: 'text', text: output }],
      details: { stdout: output, stderr: output, aggregatedOutput: output },
    });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(160 * 1024);
    expect(result.details).toEqual({ remoteTransportTruncated: true });
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });
});

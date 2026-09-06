import { mkdtemp, mkdir, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { isolatedCommand } from '../command-isolation.js';
import { CommandRegistry } from '../command-registry.js';

it('rejects a symlink cwd escape and never falls back when Docker cannot run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'command-isolation-'));
  try {
    const workspace = join(root, 'workspace'), outside = join(root, 'outside');
    await mkdir(workspace); await mkdir(outside); await symlink(outside, join(workspace, 'link'), 'dir');
    const isolation = { mode: 'docker' as const, image: `xopc-invalid-fixture@sha256:${'0'.repeat(64)}`, network: false };
    await expect(isolatedCommand({ id: 'test', command: 'true', workspace, cwd: join(workspace, 'link'), isolation })).rejects.toThrow('inside the workspace');
    const registry = new CommandRegistry(join(root, 'logs'));
    const start = await registry.start({ owner: 'test', command: 'echo escaped > escaped.txt', cwd: workspace, workspace,
      isolation, env: process.env, timeoutMs: 5_000 });
    const done = await registry.wait('test', start.id, 10_000);
    expect(done?.status).not.toBe('success');
    await expect(access(join(workspace, 'escaped.txt'))).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);

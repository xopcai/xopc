import { useTestDatabase } from '../../../storage/sqlite/__tests__/test-database.js';
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
useTestDatabase();

it('hardens Docker mounts and requires explicit workspace write access', async () => {
  const { writeFile, link } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'command-mounts-'));
  try {
    await writeFile(join(root, '.env.local'), 'synthetic-secret');
    await mkdir(join(root, '.ssh'));
    await writeFile(join(root, 'regular'), 'regular');
    await link(join(root, 'regular'), join(root, 'hardlink'));
    const isolation = { mode: 'docker' as const, image: `fixture@sha256:${'0'.repeat(64)}` };
    const launch = await isolatedCommand({ id: 'test', command: 'true', cwd: root, workspace: root, isolation });
    expect(launch.shell).toBe(false);
    expect(launch.args).toContain('--pull=never');
    expect(launch.args).toContain('none');
    expect(launch.args.some(arg => arg.endsWith('target=/workspace,readonly'))).toBe(true);
    expect(launch.args).toContain('type=bind,source=/dev/null,target=/workspace/.env.local,readonly');
    expect(launch.args).toContain('type=bind,source=/dev/null,target=/workspace/hardlink,readonly');
    expect(launch.args).toContain('/workspace/.ssh:ro,nosuid,nodev,noexec,size=4k,mode=000');
    expect(launch.args).toContain('--cap-drop=ALL');
    expect(launch.args).toContain('--security-opt=no-new-privileges');
    expect(launch.args).toContain('--memory-swap=2g');
    const writable = await isolatedCommand({ id: 'test', command: 'true', cwd: root, workspace: root,
      isolation: { ...isolation, workspaceAccess: 'read-write' } });
    expect(writable.args.some(arg => arg.endsWith('target=/workspace'))).toBe(true);
    expect(writable.args).toContain('type=bind,source=/dev/null,target=/workspace/.env.local,readonly');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects unpinned images and sensitive symlink mount targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'command-mounts-'));
  try {
    await expect(isolatedCommand({ id: 'test', command: 'true', cwd: root, workspace: root,
      isolation: { mode: 'docker', image: 'node:latest' } })).rejects.toThrow('sha256');
    await symlink('/tmp/secret', join(root, '.env'));
    await expect(isolatedCommand({ id: 'test', command: 'true', cwd: root, workspace: root,
      isolation: { mode: 'docker', image: `fixture@sha256:${'0'.repeat(64)}` } })).rejects.toThrow('Sensitive symlinks');
  } finally { await rm(root, { recursive: true, force: true }); }
});

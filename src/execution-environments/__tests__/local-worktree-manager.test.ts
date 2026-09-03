import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectStore } from '../../projects/project-store.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { LocalWorktreeManager } from '../local-worktree-manager.js';
import { ExecutionEnvironmentStore } from '../store.js';

function git(cwd: string, args: string[]): string {
  return String(execFileSync('git', args, { cwd, encoding: 'utf8' }));
}

describe('LocalWorktreeManager', () => {
  let stateDir: string;
  let repositoryRoot: string;
  let projectId: string;
  let store: ExecutionEnvironmentStore;
  let manager: LocalWorktreeManager;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-local-worktree-'));
    repositoryRoot = join(stateDir, 'repository');
    mkdirSync(repositoryRoot, { recursive: true });
    git(repositoryRoot, ['init', '-b', 'main']);
    git(repositoryRoot, ['config', 'user.email', 'test@xopc.local']);
    git(repositoryRoot, ['config', 'user.name', 'xopc test']);
    writeFileSync(join(repositoryRoot, 'README.md'), '# test\n');
    git(repositoryRoot, ['add', 'README.md']);
    git(repositoryRoot, ['commit', '-m', 'initial']);

    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    projectId = new ProjectStore().create({ name: 'Worktree Test', workspaceRoot: repositoryRoot }).id;
    store = new ExecutionEnvironmentStore();
    manager = new LocalWorktreeManager({ store, stateDir });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('provisions a detached locked managed worktree from a clean repository', async () => {
    const environment = await manager.provisionManagedWorktree({
      projectId,
      repositoryPath: repositoryRoot,
      environmentId: 'environment-a',
    });

    expect(environment).toMatchObject({
      projectId,
      kind: 'managed_worktree',
      status: 'ready',
      baseRef: 'HEAD',
    });
    expect(existsSync(join(environment.rootPath, 'README.md'))).toBe(true);
    expect(git(environment.rootPath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD');
    expect(await manager.inspect(environment.id)).toMatchObject({
      healthy: true,
      registered: true,
      rootExists: true,
      dirty: false,
      locked: true,
    });
  });

  it('rejects dirty starting repositories instead of silently dropping changes', async () => {
    writeFileSync(join(repositoryRoot, 'README.md'), '# changed\n');

    await expect(manager.provisionManagedWorktree({
      projectId,
      repositoryPath: repositoryRoot,
      environmentId: 'environment-dirty',
    })).rejects.toThrow(/uncommitted changes/);
    expect(store.get('environment-dirty')).toBeUndefined();
  });

  it('refuses deletion while bound and deletes the exact managed path after release', async () => {
    const environment = await manager.provisionManagedWorktree({
      projectId,
      repositoryPath: repositoryRoot,
      environmentId: 'environment-delete',
    });
    store.bind({ sessionKey: 'session-a', environmentId: environment.id });

    await expect(manager.remove(environment.id)).rejects.toThrow(/active bindings/);
    store.releaseBinding('session-a', environment.id);
    const deleted = await manager.remove(environment.id);

    expect(deleted.status).toBe('deleted');
    expect(existsSync(environment.rootPath)).toBe(false);
    expect(git(repositoryRoot, ['worktree', 'list', '--porcelain'])).not.toContain(environment.rootPath);
  });

  it('retires a local checkout without deleting its files', async () => {
    const environment = await manager.registerLocalCheckout({
      projectId,
      workspacePath: repositoryRoot,
      environmentId: 'local-checkout',
    });

    const deleted = await manager.remove(environment.id);

    expect(deleted.status).toBe('deleted');
    expect(existsSync(join(repositoryRoot, 'README.md'))).toBe(true);
  });

  it('preserves uncommitted work and restores the Git lock when cleanup is refused', async () => {
    const environment = await manager.provisionManagedWorktree({ projectId, repositoryPath: repositoryRoot });
    writeFileSync(join(environment.rootPath, 'README.md'), '# unfinished work\n');

    await expect(manager.remove(environment.id)).rejects.toThrow();

    expect(existsSync(join(environment.rootPath, 'README.md'))).toBe(true);
    expect(await manager.inspect(environment.id)).toMatchObject({ dirty: true, locked: true });
    expect(store.get(environment.id)?.status).toBe('error');
  });

  it('allows local commits and preserves detached commits until a branch retains them', async () => {
    const environment = await manager.provisionManagedWorktree({ projectId, repositoryPath: repositoryRoot });
    writeFileSync(join(environment.rootPath, 'README.md'), '# completed work\n');
    git(environment.rootPath, ['add', 'README.md']);
    git(environment.rootPath, ['commit', '-m', 'worktree change']);

    expect((await manager.reconcile(environment.id)).status).toBe('ready');
    await expect(manager.remove(environment.id)).rejects.toThrow(/Save detached commits on a branch/);
    expect(existsSync(environment.rootPath)).toBe(true);

    git(environment.rootPath, ['branch', 'saved-work']);
    expect((await manager.remove(environment.id)).status).toBe('deleted');
    expect((await manager.remove(environment.id)).status).toBe('deleted');
    expect(git(repositoryRoot, ['show', 'saved-work:README.md'])).toBe('# completed work\n');
  });

  it('refuses to remove an unregistered replacement directory', async () => {
    const environment = await manager.provisionManagedWorktree({ projectId, repositoryPath: repositoryRoot });
    git(repositoryRoot, ['worktree', 'unlock', environment.rootPath]);
    git(repositoryRoot, ['worktree', 'remove', environment.rootPath]);
    mkdirSync(environment.rootPath);
    writeFileSync(join(environment.rootPath, 'important.txt'), 'Keep this file');

    await expect(manager.remove(environment.id)).rejects.toThrow(/no longer registered/);
    expect(existsSync(join(environment.rootPath, 'important.txt'))).toBe(true);
  });

  it('resumes cleanup after an interruption in the deleting state', async () => {
    const environment = await manager.provisionManagedWorktree({ projectId, repositoryPath: repositoryRoot });
    store.transition({
      environmentId: environment.id,
      expectedVersion: environment.version,
      toStatus: 'deleting',
      reason: 'cleanup interrupted',
    });

    expect((await manager.remove(environment.id)).status).toBe('deleted');
    expect(existsSync(environment.rootPath)).toBe(false);
  });

  it('marks a missing registered worktree as degraded during reconciliation', async () => {
    const environment = await manager.provisionManagedWorktree({
      projectId,
      repositoryPath: repositoryRoot,
      environmentId: 'environment-drift',
    });
    git(repositoryRoot, ['worktree', 'unlock', environment.rootPath]);
    git(repositoryRoot, ['worktree', 'remove', '--force', environment.rootPath]);

    const reconciled = await manager.reconcile(environment.id);

    expect(reconciled).toMatchObject({
      status: 'degraded',
      lastError: expect.stringContaining('worktree root is missing'),
    });
  });
});

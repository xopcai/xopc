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
      managed: true,
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
    store.bind({ subjectKind: 'session', subjectId: 'session-a', environmentId: environment.id });

    await expect(manager.remove(environment.id)).rejects.toThrow(/active bindings/);
    store.releaseBinding('session', 'session-a', environment.id);
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

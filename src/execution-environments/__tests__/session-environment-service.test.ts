import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { ProjectService } from '../../projects/project-service.js';
import { effectiveWorkspacePathForSession } from '../../session/session-workspace.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { LocalWorktreeManager } from '../local-worktree-manager.js';
import { SessionEnvironmentService } from '../session-environment-service.js';
import { ExecutionEnvironmentStore } from '../store.js';

const SESSION_KEY = 'agent:main:webchat:default:direct:environment-test';

const config = ConfigSchema.parse({
  agents: {
    default: 'main',
    list: [{ id: 'main', workspace: '/tmp/xopc-default-workspace' }],
  },
});

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('SessionEnvironmentService', () => {
  let stateDir: string;
  let repositoryRoot: string;
  let service: SessionEnvironmentService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-session-environment-'));
    repositoryRoot = join(stateDir, 'repository');
    mkdirSync(repositoryRoot, { recursive: true });
    git(repositoryRoot, ['init', '-b', 'main']);
    git(repositoryRoot, ['config', 'user.email', 'test@xopc.local']);
    git(repositoryRoot, ['config', 'user.name', 'xopc test']);
    writeFileSync(join(repositoryRoot, 'package.json'), '{"name":"environment-test"}');
    git(repositoryRoot, ['add', 'package.json']);
    git(repositoryRoot, ['commit', '-m', 'initial']);

    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const store = new ExecutionEnvironmentStore();
    service = new SessionEnvironmentService({
      store,
      worktrees: new LocalWorktreeManager({ store, stateDir }),
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('binds a session to its isolated worktree and removes it on release', async () => {
    const project = new ProjectService().create({ workspaceRoot: repositoryRoot });
    expect(project.executionMode).toBe('managed_worktree');

    const environment = await service.attach({ sessionKey: SESSION_KEY, project });

    expect(environment).toMatchObject({ kind: 'managed_worktree', status: 'ready' });
    expect(existsSync(environment.rootPath)).toBe(true);
    expect(effectiveWorkspacePathForSession(config, SESSION_KEY, null, project)).toBe(environment.rootPath);

    await service.release(SESSION_KEY);

    expect(service.get(SESSION_KEY)).toBeUndefined();
    expect(existsSync(environment.rootPath)).toBe(false);
  });

  it('requires an explicit release before changing execution mode', async () => {
    const project = new ProjectService().create({
      workspaceRoot: repositoryRoot,
      executionMode: 'local_checkout',
    });
    await service.attach({ sessionKey: SESSION_KEY, project });

    await expect(service.attach({
      sessionKey: SESSION_KEY,
      project,
      mode: 'managed_worktree',
    })).rejects.toThrow(/release it before switching/);
  });

  it('keeps worktree changes after releasing the session when cleanup is unsafe', async () => {
    const project = new ProjectService().create({ workspaceRoot: repositoryRoot });
    const environment = await service.attach({ sessionKey: SESSION_KEY, project });
    writeFileSync(join(environment.rootPath, 'unfinished.txt'), 'Keep this work');

    await expect(service.release(SESSION_KEY)).rejects.toThrow();

    expect(service.get(SESSION_KEY)?.id).toBe(environment.id);
    expect((await service.attach({ sessionKey: SESSION_KEY, project })).status).toBe('ready');
    expect(existsSync(join(environment.rootPath, 'unfinished.txt'))).toBe(true);
  });

  it('can release a session while explicitly retaining its managed worktree', async () => {
    const project = new ProjectService().create({ workspaceRoot: repositoryRoot });
    const environment = await service.attach({ sessionKey: SESSION_KEY, project });

    await service.release(SESSION_KEY, false);

    expect(service.get(SESSION_KEY)).toBeUndefined();
    expect(existsSync(environment.rootPath)).toBe(true);
  });
});

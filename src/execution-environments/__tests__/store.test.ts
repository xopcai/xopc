import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectStore } from '../../projects/project-store.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { ExecutionEnvironmentStore } from '../store.js';
import { ExecutionEnvironmentConflictError } from '../types.js';

describe('ExecutionEnvironmentStore', () => {
  let stateDir: string;
  let projectId: string;
  let store: ExecutionEnvironmentStore;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-execution-environment-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const workspaceRoot = join(stateDir, 'project');
    mkdirSync(workspaceRoot, { recursive: true });
    projectId = new ProjectStore().create({ name: 'Execution Test', workspaceRoot }).id;
    store = new ExecutionEnvironmentStore();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates a requested local checkout and records the initial event', () => {
    const rootPath = join(stateDir, 'project');
    const environment = store.create({
      id: 'env-local',
      projectId,
      hostId: 'local',
      kind: 'local_checkout',
      rootPath,
    });

    expect(environment).toMatchObject({
      id: 'env-local',
      projectId,
      hostId: 'local',
      kind: 'local_checkout',
      status: 'requested',
      rootPath,
      managed: false,
      version: 1,
    });
    expect(store.listEvents(environment.id)).toEqual([
      expect.objectContaining({ toStatus: 'requested', reason: 'created', metadata: {} }),
    ]);
  });

  it('enforces state transitions and optimistic versions', () => {
    const environment = store.create({
      id: 'env-transition',
      projectId,
      hostId: 'local',
      kind: 'local_checkout',
      rootPath: join(stateDir, 'project'),
    });
    const provisioning = store.transition({
      environmentId: environment.id,
      expectedVersion: environment.version,
      toStatus: 'provisioning',
      reason: 'test provisioning',
    });
    expect(provisioning).toMatchObject({ status: 'provisioning', version: 2 });

    expect(() => store.transition({
      environmentId: environment.id,
      expectedVersion: environment.version,
      toStatus: 'ready',
      reason: 'stale update',
    })).toThrow(ExecutionEnvironmentConflictError);
    expect(() => store.transition({
      environmentId: environment.id,
      expectedVersion: provisioning.version,
      toStatus: 'busy',
      reason: 'invalid transition',
    })).toThrow(/Cannot transition/);

    const ready = store.transition({
      environmentId: environment.id,
      expectedVersion: provisioning.version,
      toStatus: 'ready',
      reason: 'provisioned',
      metadata: { head: 'abc123' },
    });
    expect(ready).toMatchObject({ status: 'ready', version: 3 });
    expect(store.listEvents(environment.id).at(-1)).toMatchObject({
      fromStatus: 'provisioning',
      toStatus: 'ready',
      metadata: { head: 'abc123' },
    });
  });

  it('keeps managed worktrees exclusive and makes repeated binding idempotent', () => {
    const repositoryRoot = join(stateDir, 'repository');
    const environment = store.create({
      id: 'env-worktree',
      projectId,
      hostId: 'local',
      kind: 'managed_worktree',
      rootPath: join(stateDir, 'worktrees', 'env-worktree'),
      repositoryRoot,
      gitCommonDir: join(repositoryRoot, '.git'),
    });
    const provisioning = store.transition({
      environmentId: environment.id,
      expectedVersion: environment.version,
      toStatus: 'provisioning',
      reason: 'test',
    });
    store.transition({
      environmentId: environment.id,
      expectedVersion: provisioning.version,
      toStatus: 'ready',
      reason: 'test',
    });

    const first = store.bind({ subjectKind: 'session', subjectId: 'session-a', environmentId: environment.id });
    const repeated = store.bind({ subjectKind: 'session', subjectId: 'session-a', environmentId: environment.id });
    expect(repeated).toEqual(first);
    expect(() => store.bind({
      subjectKind: 'session',
      subjectId: 'session-b',
      environmentId: environment.id,
    })).toThrow(/already bound/);

    store.releaseBinding('session', 'session-a', environment.id);
    const rebound = store.bind({ subjectKind: 'session', subjectId: 'session-a', environmentId: environment.id });
    expect(rebound.epoch).toBe(2);
  });

  it('allows a local checkout to be shared by multiple subjects', () => {
    const environment = store.create({
      id: 'env-shared-local',
      projectId,
      hostId: 'local',
      kind: 'local_checkout',
      rootPath: join(stateDir, 'project'),
    });
    const provisioning = store.transition({
      environmentId: environment.id,
      expectedVersion: environment.version,
      toStatus: 'provisioning',
      reason: 'test',
    });
    store.transition({
      environmentId: environment.id,
      expectedVersion: provisioning.version,
      toStatus: 'ready',
      reason: 'test',
    });

    expect(store.bind({ subjectKind: 'session', subjectId: 'session-a', environmentId: environment.id })).toBeTruthy();
    expect(store.bind({ subjectKind: 'session', subjectId: 'session-b', environmentId: environment.id })).toBeTruthy();
  });

  it('retains environments for cleanup after their project is deleted', () => {
    const environment = store.create({
      id: 'env-orphan-cleanup',
      projectId,
      hostId: 'local',
      kind: 'local_checkout',
      rootPath: join(stateDir, 'project'),
    });

    new ProjectStore().delete(projectId);

    expect(store.get(environment.id)?.projectId).toBeUndefined();
  });
});

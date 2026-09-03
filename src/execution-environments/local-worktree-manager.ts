import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import lockfile from 'proper-lockfile';

import { createLogger } from '../utils/logger.js';
import {
  findGitWorktree,
  inspectGitRepository,
  resolveGitCommit,
  runGit,
} from './git.js';
import { resolveExecutionWorktreesRoot, resolveManagedWorktreePath } from './paths.js';
import { ExecutionEnvironmentStore } from './store.js';
import {
  ExecutionEnvironmentConflictError,
  type ExecutionEnvironment,
} from './types.js';

const log = createLogger('ExecutionEnvironment:LocalWorktree');
const LOCAL_HOST_ID = 'local';

export interface ProvisionManagedWorktreeInput {
  projectId: string;
  repositoryPath: string;
  baseRef?: string;
  environmentId?: string;
  requireClean?: boolean;
  pinned?: boolean;
}

export interface LocalWorktreeInspection {
  healthy: boolean;
  registered: boolean;
  rootExists: boolean;
  dirty: boolean;
  headSha?: string;
  branchRef?: string;
  locked: boolean;
  problems: string[];
}

export interface LocalWorktreeManagerOptions {
  store?: ExecutionEnvironmentStore;
  stateDir?: string;
  hostId?: string;
}

async function withRepositoryLock<T>(gitCommonDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = resolve(gitCommonDir, 'xopc-worktree.lock');
  const release = await lockfile.lock(gitCommonDir, {
    realpath: false,
    lockfilePath: lockPath,
    retries: { retries: 20, factor: 1.2, minTimeout: 25, maxTimeout: 250 },
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function assertManagedPath(rootPath: string, stateDir?: string): void {
  const managedRoot = resolveExecutionWorktreesRoot(stateDir);
  const candidate = resolve(rootPath);
  const child = relative(managedRoot, candidate);
  if (!child || child.startsWith('..') || resolve(managedRoot, child) !== candidate) {
    throw new Error(`Refusing to manage worktree outside ${managedRoot}`);
  }
}

export class LocalWorktreeManager {
  private readonly store: ExecutionEnvironmentStore;
  private readonly stateDir?: string;
  private readonly hostId: string;

  constructor(options: LocalWorktreeManagerOptions = {}) {
    this.store = options.store ?? new ExecutionEnvironmentStore();
    this.stateDir = options.stateDir;
    this.hostId = options.hostId?.trim() || LOCAL_HOST_ID;
  }

  async registerLocalCheckout(input: {
    projectId?: string;
    workspacePath: string;
    environmentId?: string;
    pinned?: boolean;
  }): Promise<ExecutionEnvironment> {
    if (!await isDirectory(input.workspacePath)) {
      throw new Error(`Local checkout does not exist: ${input.workspacePath}`);
    }
    const repository = await inspectGitRepository(input.workspacePath).catch(() => undefined);
    const environment = this.store.create({
      ...(input.environmentId ? { id: input.environmentId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      hostId: this.hostId,
      kind: 'local_checkout',
      rootPath: input.workspacePath,
      ...(repository ? {
        repositoryRoot: repository.repositoryRoot,
        gitCommonDir: repository.gitCommonDir,
        baseRef: repository.branchRef ?? 'HEAD',
        baseSha: repository.headSha,
        branchRef: repository.branchRef,
      } : {}),
      pinned: input.pinned,
    });
    const provisioning = this.store.transition({
      environmentId: environment.id,
      expectedVersion: environment.version,
      toStatus: 'provisioning',
      reason: 'local checkout validation started',
    });
    return this.store.transition({
      environmentId: environment.id,
      expectedVersion: provisioning.version,
      toStatus: 'ready',
      reason: 'local checkout validated',
    });
  }

  async provisionManagedWorktree(input: ProvisionManagedWorktreeInput): Promise<ExecutionEnvironment> {
    const repository = await inspectGitRepository(input.repositoryPath);
    if ((input.requireClean ?? true) && repository.dirty) {
      throw new ExecutionEnvironmentConflictError(
        `Repository has uncommitted changes: ${repository.repositoryRoot}`,
      );
    }
    const baseRef = input.baseRef?.trim() || 'HEAD';
    const baseSha = await resolveGitCommit(repository.repositoryRoot, baseRef);
    const environmentId = input.environmentId?.trim() || randomUUID();
    const rootPath = resolveManagedWorktreePath(input.projectId, environmentId, this.stateDir);
    assertManagedPath(rootPath, this.stateDir);
    if (existsSync(rootPath)) throw new ExecutionEnvironmentConflictError(`Worktree path already exists: ${rootPath}`);

    const environment = this.store.create({
      id: environmentId,
      projectId: input.projectId,
      hostId: this.hostId,
      kind: 'managed_worktree',
      rootPath,
      repositoryRoot: repository.repositoryRoot,
      gitCommonDir: repository.gitCommonDir,
      baseRef,
      baseSha,
      pinned: input.pinned,
    });
    const provisioning = this.store.transition({
      environmentId: environment.id,
      expectedVersion: environment.version,
      toStatus: 'provisioning',
      reason: 'managed worktree provisioning started',
    });

    try {
      await withRepositoryLock(repository.gitCommonDir, async () => {
        await mkdir(dirname(rootPath), { recursive: true, mode: 0o700 });
        await runGit(repository.repositoryRoot, ['worktree', 'add', '--detach', '--lock', rootPath, baseSha]);
        const registered = await findGitWorktree(repository.repositoryRoot, rootPath);
        if (!registered) throw new Error(`Git did not register worktree ${rootPath}`);
      });
      const ready = this.store.transition({
        environmentId: environment.id,
        expectedVersion: provisioning.version,
        toStatus: 'ready',
        reason: 'managed worktree provisioned',
        metadata: { baseSha },
      });
      log.info({ environmentId: ready.id, projectId: ready.projectId, path: ready.rootPath }, 'Managed worktree ready');
      return ready;
    } catch (error) {
      await this.cleanupFailedProvision(repository.repositoryRoot, repository.gitCommonDir, rootPath);
      const failed = this.store.transition({
        environmentId: environment.id,
        expectedVersion: provisioning.version,
        toStatus: 'error',
        reason: 'managed worktree provisioning failed',
        error: errorMessage(error),
      });
      log.error({ err: error, environmentId: failed.id, path: rootPath }, `Managed worktree provisioning failed: ${failed.lastError}`);
      throw error;
    }
  }

  async inspect(environmentId: string): Promise<LocalWorktreeInspection> {
    const environment = this.store.getRequired(environmentId);
    if (environment.kind !== 'managed_worktree' || !environment.repositoryRoot) {
      throw new Error(`Execution environment ${environmentId} is not a managed worktree`);
    }
    const rootExists = await isDirectory(environment.rootPath);
    const registered = await findGitWorktree(environment.repositoryRoot, environment.rootPath).catch(() => undefined);
    const problems: string[] = [];
    if (!rootExists) problems.push('worktree root is missing');
    if (!registered) problems.push('worktree is not registered in Git');
    let dirty = false;
    if (rootExists && registered) {
      dirty = Boolean(await runGit(environment.rootPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    }
    return {
      healthy: problems.length === 0,
      registered: Boolean(registered),
      rootExists,
      dirty,
      ...(registered?.headSha ? { headSha: registered.headSha } : {}),
      ...(registered?.branchRef ? { branchRef: registered.branchRef } : {}),
      locked: registered?.locked ?? false,
      problems,
    };
  }

  async reconcile(environmentId: string): Promise<ExecutionEnvironment> {
    const environment = this.store.getRequired(environmentId);
    const inspection = await this.inspect(environmentId);
    if (inspection.healthy) {
      if (inspection.headSha && environment.baseSha && inspection.headSha !== environment.baseSha) {
        throw new ExecutionEnvironmentConflictError(
          `Managed worktree ${environmentId} is at ${inspection.headSha}, expected ${environment.baseSha}`,
        );
      }
      if (environment.status !== 'degraded' && environment.status !== 'provisioning') return environment;
      const provisioning = environment.status === 'provisioning'
        ? environment
        : this.store.transition({
          environmentId,
          expectedVersion: environment.version,
          toStatus: 'provisioning',
          reason: 'managed worktree reconciliation started',
        });
      return this.store.transition({
        environmentId,
        expectedVersion: provisioning.version,
        toStatus: 'ready',
        reason: 'managed worktree reconciliation succeeded',
      });
    }
    if (environment.status === 'degraded' || environment.status === 'error') return environment;
    if (!['ready', 'busy', 'stopped'].includes(environment.status)) {
      throw new ExecutionEnvironmentConflictError(
        `Cannot reconcile managed worktree ${environmentId} while ${environment.status}`,
      );
    }
    return this.store.transition({
      environmentId,
      expectedVersion: environment.version,
      toStatus: 'degraded',
      reason: 'managed worktree reconciliation detected drift',
      error: inspection.problems.join('; '),
    });
  }

  async remove(environmentId: string): Promise<ExecutionEnvironment> {
    let environment = this.store.getRequired(environmentId);
    if (environment.kind === 'local_checkout') {
      const bindings = this.store.listBindings(environmentId);
      if (bindings.length > 0) {
        throw new ExecutionEnvironmentConflictError(`Local checkout ${environmentId} still has active bindings`);
      }
      if (environment.status === 'busy') {
        environment = this.store.transition({
          environmentId,
          expectedVersion: environment.version,
          toStatus: 'stopped',
          reason: 'unbound local checkout stopped before retirement',
        });
      }
      const deleting = this.store.transition({
        environmentId,
        expectedVersion: environment.version,
        toStatus: 'deleting',
        reason: 'local checkout retirement started',
      });
      const deleted = this.store.transition({
        environmentId,
        expectedVersion: deleting.version,
        toStatus: 'deleted',
        reason: 'local checkout retired',
      });
      log.info({ environmentId, path: environment.rootPath }, 'Local checkout retired');
      return deleted;
    }
    if (environment.kind !== 'managed_worktree' || !environment.repositoryRoot || !environment.gitCommonDir) {
      throw new Error(`Execution environment ${environmentId} is not a managed worktree`);
    }
    assertManagedPath(environment.rootPath, this.stateDir);
    const bindings = this.store.listBindings(environmentId);
    if (bindings.length > 0) {
      throw new ExecutionEnvironmentConflictError(`Managed worktree ${environmentId} still has active bindings`);
    }
    if (environment.status === 'busy') {
      environment = this.store.transition({
        environmentId,
        expectedVersion: environment.version,
        toStatus: 'stopped',
        reason: 'unbound managed worktree stopped before deletion',
      });
    }
    const deleting = this.store.transition({
      environmentId,
      expectedVersion: environment.version,
      toStatus: 'deleting',
      reason: 'managed worktree deletion started',
    });

    try {
      await withRepositoryLock(environment.gitCommonDir, async () => {
        const registered = await findGitWorktree(environment.repositoryRoot!, environment.rootPath);
        if (registered) {
          await runGit(environment.repositoryRoot!, ['worktree', 'unlock', environment.rootPath]).catch(() => '');
          await runGit(environment.repositoryRoot!, ['worktree', 'remove', '--force', environment.rootPath]);
        }
        await runGit(environment.repositoryRoot!, ['worktree', 'prune', '--expire', 'now']);
        if (existsSync(environment.rootPath)) await rm(environment.rootPath, { recursive: true, force: true });
      });
      const deleted = this.store.transition({
        environmentId,
        expectedVersion: deleting.version,
        toStatus: 'deleted',
        reason: 'managed worktree deleted',
      });
      log.info({ environmentId, path: environment.rootPath }, 'Managed worktree deleted');
      return deleted;
    } catch (error) {
      this.store.transition({
        environmentId,
        expectedVersion: deleting.version,
        toStatus: 'error',
        reason: 'managed worktree deletion failed',
        error: errorMessage(error),
      });
      throw error;
    }
  }

  private async cleanupFailedProvision(repositoryRoot: string, gitCommonDir: string, rootPath: string): Promise<void> {
    await withRepositoryLock(gitCommonDir, async () => {
      const registered = await findGitWorktree(repositoryRoot, rootPath).catch(() => undefined);
      if (registered) {
        await runGit(repositoryRoot, ['worktree', 'unlock', rootPath]).catch(() => '');
        await runGit(repositoryRoot, ['worktree', 'remove', '--force', rootPath]).catch(() => '');
      }
      if (existsSync(rootPath)) await rm(rootPath, { recursive: true, force: true });
      await runGit(repositoryRoot, ['worktree', 'prune', '--expire', 'now']).catch(() => '');
    }).catch(() => undefined);
  }
}

import crypto from 'node:crypto';

import { z } from 'zod';

import type { ExecutionHostRegistry } from '../execution-hosts/registry.js';
import { validateRemoteRepositoryUrl } from '../execution-hosts/workspace-runtime.js';
import { createLogger } from '../utils/logger.js';
import {
  inspectGitRepository,
  resolveGitCommit,
  resolveGitRemoteUrl,
} from './git.js';
import { ExecutionEnvironmentStore } from './store.js';
import {
  ExecutionEnvironmentConflictError,
  type ExecutionEnvironment,
} from './types.js';

const log = createLogger('ExecutionEnvironment:RemoteWorktree');
const PROVISION_DEADLINE_MS = 10 * 60_000;
const INSPECT_DEADLINE_MS = 60_000;
const REMOVE_DEADLINE_MS = 5 * 60_000;

const provisionResultSchema = z.strictObject({
  rootPath: z.string().min(1).max(4_096),
  repositoryRoot: z.string().min(1).max(4_096),
  gitCommonDir: z.string().min(1).max(4_096),
  baseSha: z.string().regex(/^[0-9a-f]{40,64}$/i),
});

const inspectionSchema = z.strictObject({
  healthy: z.boolean(),
  rootExists: z.boolean(),
  dirty: z.boolean(),
  headSha: z.string().optional(),
  rootPath: z.string().min(1).max(4_096).optional(),
  repositoryRoot: z.string().min(1).max(4_096).optional(),
  gitCommonDir: z.string().min(1).max(4_096).optional(),
  baseSha: z.string().regex(/^[0-9a-f]{40,64}$/i).optional(),
  problems: z.array(z.string()),
});

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

export class RemoteWorktreeManager {
  private readonly store: ExecutionEnvironmentStore;

  constructor(private readonly options: {
    getRegistry: () => ExecutionHostRegistry;
    store?: ExecutionEnvironmentStore;
  }) {
    this.store = options.store ?? new ExecutionEnvironmentStore();
  }

  async provisionManagedWorktree(input: {
    projectId: string;
    hostId: string;
    repositoryPath: string;
    baseRef?: string;
    environmentId?: string;
    requireClean?: boolean;
    pinned?: boolean;
  }): Promise<ExecutionEnvironment> {
    const registry = this.options.getRegistry();
    const connectedHost = registry.get(input.hostId);
    if (!connectedHost) {
      throw new ExecutionEnvironmentConflictError(`Execution host is offline: ${input.hostId}`);
    }
    if (!connectedHost.hello.capabilities.git) {
      throw new ExecutionEnvironmentConflictError(`Execution host does not support Git worktrees: ${input.hostId}`);
    }
    const repository = await inspectGitRepository(input.repositoryPath);
    if ((input.requireClean ?? true) && repository.dirty) {
      throw new ExecutionEnvironmentConflictError(
        `Repository has uncommitted changes: ${repository.repositoryRoot}`,
      );
    }
    const baseRef = input.baseRef?.trim() || 'HEAD';
    const baseSha = await resolveGitCommit(repository.repositoryRoot, baseRef);
    const repositoryUrl = validateRemoteRepositoryUrl(
      await resolveGitRemoteUrl(repository.repositoryRoot),
    );
    const environmentId = input.environmentId?.trim() || crypto.randomUUID();
    let environment = this.store.get(environmentId);
    if (environment) {
      if (
        environment.projectId !== input.projectId
        || environment.hostId !== input.hostId
        || environment.kind !== 'managed_worktree'
        || environment.baseSha !== baseSha
      ) {
        throw new ExecutionEnvironmentConflictError(`Execution environment ${environmentId} does not match the provision request`);
      }
      if (environment.status === 'ready') return environment;
      if (!['requested', 'provisioning', 'error', 'degraded'].includes(environment.status)) {
        throw new ExecutionEnvironmentConflictError(
          `Cannot resume remote worktree provisioning while ${environment.status}`,
        );
      }
    } else {
      environment = this.store.create({
        id: environmentId,
        projectId: input.projectId,
        hostId: input.hostId,
        kind: 'managed_worktree',
        rootPath: `remote-pending:${environmentId}`,
        baseRef,
        baseSha,
        pinned: input.pinned,
      });
    }
    const provisioning = environment.status === 'provisioning'
      ? environment
      : this.store.transition({
        environmentId,
        expectedVersion: environment.version,
        toStatus: 'provisioning',
        reason: environment.status === 'requested'
          ? 'remote managed worktree provisioning started'
          : 'remote managed worktree provisioning resumed',
      });

    try {
      const result = provisionResultSchema.parse(await registry.execute(input.hostId, {
        operationId: crypto.randomUUID(),
        environmentId,
        bindingEpoch: 0,
        deadlineAt: Date.now() + PROVISION_DEADLINE_MS,
        idempotencyKey: `provision:${environmentId}`,
        command: 'environment.provision',
        payload: { repositoryUrl, baseSha },
      }));
      if (result.baseSha !== baseSha) throw new Error('Execution host provisioned an unexpected Git revision');
      const located = this.store.updateLocation({
        environmentId,
        expectedVersion: provisioning.version,
        rootPath: result.rootPath,
        repositoryRoot: result.repositoryRoot,
        gitCommonDir: result.gitCommonDir,
        baseSha: result.baseSha,
      });
      const ready = this.store.transition({
        environmentId,
        expectedVersion: located.version,
        toStatus: 'ready',
        reason: 'remote managed worktree provisioned',
        metadata: { hostId: input.hostId, baseSha },
      });
      log.info({ environmentId, hostId: input.hostId, projectId: input.projectId }, 'Remote managed worktree ready');
      return ready;
    } catch (error) {
      const current = this.store.get(environmentId);
      if (current?.status === 'provisioning') {
        this.store.transition({
          environmentId,
          expectedVersion: current.version,
          toStatus: 'error',
          reason: 'remote managed worktree provisioning failed',
          error: errorMessage(error),
        });
      }
      throw error;
    }
  }

  async inspect(environmentId: string): Promise<z.infer<typeof inspectionSchema>> {
    const environment = this.remoteEnvironment(environmentId);
    return inspectionSchema.parse(await this.options.getRegistry().execute(environment.hostId, {
      operationId: crypto.randomUUID(),
      environmentId,
      bindingEpoch: 0,
      deadlineAt: Date.now() + INSPECT_DEADLINE_MS,
      idempotencyKey: `inspect:${environmentId}:${crypto.randomUUID()}`,
      command: 'environment.inspect',
      payload: {},
    }));
  }

  async reconcile(environmentId: string): Promise<ExecutionEnvironment> {
    const environment = this.remoteEnvironment(environmentId);
    const inspection = await this.inspect(environmentId);
    if (!inspection.healthy) {
      if (environment.status === 'degraded' || environment.status === 'error') return environment;
      return this.store.transition({
        environmentId,
        expectedVersion: environment.version,
        toStatus: 'degraded',
        reason: 'remote managed worktree reconciliation detected drift',
        error: inspection.problems.join('; '),
      });
    }
    if (environment.status !== 'degraded' && environment.status !== 'error') return environment;
    const needsLocation = environment.rootPath.startsWith('remote-pending:');
    if (
      needsLocation
      && (
        !inspection.rootPath
        || !inspection.repositoryRoot
        || !inspection.gitCommonDir
        || inspection.baseSha !== environment.baseSha
      )
    ) {
      throw new Error('Execution host inspection did not provide the provisioned location');
    }
    const provisioning = this.store.transition({
      environmentId,
      expectedVersion: environment.version,
      toStatus: 'provisioning',
      reason: 'remote managed worktree reconciliation started',
    });
    let located = provisioning;
    if (needsLocation) {
      located = this.store.updateLocation({
        environmentId,
        expectedVersion: provisioning.version,
        rootPath: inspection.rootPath,
        repositoryRoot: inspection.repositoryRoot,
        gitCommonDir: inspection.gitCommonDir,
        baseSha: inspection.baseSha,
      });
    }
    return this.store.transition({
      environmentId,
      expectedVersion: located.version,
      toStatus: 'ready',
      reason: 'remote managed worktree reconciliation succeeded',
    });
  }

  async remove(environmentId: string): Promise<ExecutionEnvironment> {
    let environment = this.remoteEnvironment(environmentId);
    if (this.store.listBindings(environmentId).length > 0) {
      throw new ExecutionEnvironmentConflictError(`Managed worktree ${environmentId} still has active bindings`);
    }
    if (environment.status === 'busy') {
      environment = this.store.transition({
        environmentId,
        expectedVersion: environment.version,
        toStatus: 'stopped',
        reason: 'unbound remote worktree stopped before deletion',
      });
    }
    const deleting = this.store.transition({
      environmentId,
      expectedVersion: environment.version,
      toStatus: 'deleting',
      reason: 'remote managed worktree deletion started',
    });
    try {
      await this.options.getRegistry().execute(environment.hostId, {
        operationId: crypto.randomUUID(),
        environmentId,
        bindingEpoch: 0,
        deadlineAt: Date.now() + REMOVE_DEADLINE_MS,
        idempotencyKey: `remove:${environmentId}`,
        command: 'environment.remove',
        payload: {},
      });
      return this.store.transition({
        environmentId,
        expectedVersion: deleting.version,
        toStatus: 'deleted',
        reason: 'remote managed worktree deleted',
      });
    } catch (error) {
      this.store.transition({
        environmentId,
        expectedVersion: deleting.version,
        toStatus: 'error',
        reason: 'remote managed worktree deletion failed',
        error: errorMessage(error),
      });
      throw error;
    }
  }

  private remoteEnvironment(environmentId: string): ExecutionEnvironment {
    const environment = this.store.getRequired(environmentId);
    if (environment.kind !== 'managed_worktree' || environment.hostId === 'local') {
      throw new Error(`Execution environment ${environmentId} is not a remote managed worktree`);
    }
    return environment;
  }
}

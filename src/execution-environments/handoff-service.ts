import { randomUUID } from 'node:crypto';

import type { Project } from '../projects/types.js';
import { createLogger } from '../utils/logger.js';
import {
  ExecutionEnvironmentHandoffStore,
  type ExecutionEnvironmentHandoff,
} from './handoff-store.js';
import { LocalWorktreeManager } from './local-worktree-manager.js';
import { RemoteWorktreeManager } from './remote-worktree-manager.js';
import { SnapshotTransferService } from './snapshot-transfer-service.js';
import { ExecutionEnvironmentStore } from './store.js';
import {
  ExecutionEnvironmentConflictError,
  type ExecutionEnvironment,
} from './types.js';

const log = createLogger('ExecutionEnvironment:Handoff');

export class ExecutionEnvironmentHandoffPendingError extends Error {
  constructor(readonly handoff: ExecutionEnvironmentHandoff, cause: unknown) {
    super(`Execution environment handoff is pending recovery: ${handoff.id}`, { cause });
    this.name = 'ExecutionEnvironmentHandoffPendingError';
  }
}

export interface ExecutionEnvironmentHandoffResult {
  handoff: ExecutionEnvironmentHandoff;
  environment: ExecutionEnvironment;
  cleanupPending: boolean;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function isRetryable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { retryable?: unknown }).retryable === true);
}

export class ExecutionEnvironmentHandoffService {
  private readonly store: ExecutionEnvironmentStore;
  private readonly handoffs: ExecutionEnvironmentHandoffStore;
  private readonly localWorktrees: LocalWorktreeManager;

  constructor(private readonly options: {
    remoteWorktrees: RemoteWorktreeManager;
    store?: ExecutionEnvironmentStore;
    handoffs?: ExecutionEnvironmentHandoffStore;
    localWorktrees?: LocalWorktreeManager;
    snapshots: SnapshotTransferService;
    onEnvironmentFrozen?: (sessionKey: string) => void;
  }) {
    this.store = options.store ?? new ExecutionEnvironmentStore();
    this.handoffs = options.handoffs ?? new ExecutionEnvironmentHandoffStore();
    this.localWorktrees = options.localWorktrees ?? new LocalWorktreeManager({ store: this.store });
  }

  async start(input: {
    sessionKey: string;
    project: Project;
    targetHostId: string;
  }): Promise<ExecutionEnvironmentHandoffResult> {
    const repositoryPath = input.project.workspaceRoot?.trim();
    if (!repositoryPath) {
      throw new ExecutionEnvironmentConflictError('Project needs a fixed workspace for handoff');
    }
    const binding = this.store.resolveBinding('session', input.sessionKey);
    if (!binding) throw new ExecutionEnvironmentConflictError('Session has no execution environment to hand off');
    const source = this.store.getRequired(binding.environmentId);
    if (source.projectId !== input.project.id) {
      throw new ExecutionEnvironmentConflictError('Session execution environment belongs to another project');
    }
    if (source.kind !== 'managed_worktree') {
      throw new ExecutionEnvironmentConflictError('Only managed worktrees can be handed off');
    }
    if (source.status !== 'ready') {
      throw new ExecutionEnvironmentConflictError(`Execution environment is not idle: ${source.status}`);
    }
    const targetHostId = input.targetHostId.trim();
    if (!targetHostId) throw new ExecutionEnvironmentConflictError('targetHostId is required');
    if (targetHostId === source.hostId) {
      throw new ExecutionEnvironmentConflictError(`Execution environment is already on ${targetHostId}`);
    }
    const handoff = this.handoffs.create({
      sessionKey: input.sessionKey,
      sourceEnvironmentId: source.id,
      targetEnvironmentId: randomUUID(),
      targetHostId,
      sourceBindingId: binding.id,
      sourceBindingEpoch: binding.epoch,
    });
    return this.reconcile({ handoffId: handoff.id, project: input.project });
  }

  async reconcile(input: {
    handoffId: string;
    project: Project;
  }): Promise<ExecutionEnvironmentHandoffResult> {
    const repositoryPath = input.project.workspaceRoot?.trim();
    if (!repositoryPath) {
      throw new ExecutionEnvironmentConflictError('Project needs a fixed workspace for handoff');
    }
    try {
      return await this.drive(this.handoffs.getRequired(input.handoffId), input.project, repositoryPath);
    } catch (error) {
      const handoff = this.handoffs.getRequired(input.handoffId);
      const binding = this.store.resolveBinding('session', handoff.sessionKey);
      if (binding?.environmentId === handoff.targetEnvironmentId) {
        const pending = this.updateHandoff(
          handoff,
          'cleanup_pending',
          'source cleanup requires reconciliation',
          error,
        );
        return {
          handoff: pending,
          environment: this.store.getRequired(handoff.targetEnvironmentId),
          cleanupPending: true,
        };
      }
      if (isRetryable(error)) {
        const pending = this.updateHandoff(handoff, handoff.status, 'handoff paused for retry', error);
        throw new ExecutionEnvironmentHandoffPendingError(pending, error);
      }
      await this.rollbackBeforeSwitch(handoff, error);
      throw error;
    }
  }

  getActiveForSession(sessionKey: string): ExecutionEnvironmentHandoff | undefined {
    return this.handoffs.getActiveForSession(sessionKey);
  }

  private async drive(
    initial: ExecutionEnvironmentHandoff,
    project: Project,
    repositoryPath: string,
  ): Promise<ExecutionEnvironmentHandoffResult> {
    if (initial.status === 'completed' || initial.status === 'failed') {
      const environmentId = initial.status === 'completed'
        ? initial.targetEnvironmentId
        : initial.sourceEnvironmentId;
      return {
        handoff: initial,
        environment: this.store.getRequired(environmentId),
        cleanupPending: false,
      };
    }

    let handoff = initial;
    let binding = this.store.resolveBinding('session', handoff.sessionKey);
    if (binding?.environmentId === handoff.sourceEnvironmentId) {
      let source = this.store.getRequired(handoff.sourceEnvironmentId);
      if (source.status === 'ready') {
        source = this.store.transition({
          environmentId: source.id,
          expectedVersion: source.version,
          toStatus: 'handing_off',
          reason: 'execution environment handoff started',
          metadata: { handoffId: handoff.id, targetHostId: handoff.targetHostId },
        });
        this.options.onEnvironmentFrozen?.(handoff.sessionKey);
      } else if (source.status !== 'handing_off') {
        throw new ExecutionEnvironmentConflictError(`Handoff source is ${source.status}`);
      }

      const inspection = await this.inspect(source);
      if (!inspection.healthy) {
        throw new ExecutionEnvironmentConflictError(`Handoff source is unhealthy: ${inspection.problems.join('; ')}`);
      }
      if (!inspection.headSha) throw new Error('Handoff source has no Git HEAD');
      if (handoff.baseSha && handoff.baseSha !== inspection.headSha) {
        throw new ExecutionEnvironmentConflictError('Handoff source HEAD changed after preparation');
      }
      if (handoff.status === 'preparing') {
        handoff = this.handoffs.update({
          id: handoff.id,
          expectedVersion: handoff.version,
          toStatus: 'preparing',
          message: 'source commit verified',
          baseSha: inspection.headSha,
        });
      }
      if (inspection.dirty && !handoff.artifact) {
        const artifact = await this.options.snapshots.capture(source, handoff.id, inspection.headSha);
        handoff = this.handoffs.update({
          id: handoff.id,
          expectedVersion: handoff.version,
          toStatus: 'preparing',
          message: 'dirty workspace snapshot captured',
          artifact,
        });
      }
      const target = await this.ensureTarget(handoff, project, repositoryPath);
      if (handoff.artifact) await this.applySnapshot(target, handoff.artifact);
      if (handoff.status === 'preparing') {
        handoff = this.handoffs.update({
          id: handoff.id,
          expectedVersion: handoff.version,
          toStatus: 'switching',
          message: 'target environment ready',
        });
      }
      this.store.replaceBinding({
        subjectKind: 'session',
        subjectId: handoff.sessionKey,
        sourceBindingId: handoff.sourceBindingId,
        sourceEnvironmentId: handoff.sourceEnvironmentId,
        sourceEpoch: handoff.sourceBindingEpoch,
        targetEnvironmentId: handoff.targetEnvironmentId,
      });
      this.options.onEnvironmentFrozen?.(handoff.sessionKey);
      binding = this.store.resolveBinding('session', handoff.sessionKey);
    }

    if (binding?.environmentId !== handoff.targetEnvironmentId) {
      throw new ExecutionEnvironmentConflictError('Session binding no longer matches the handoff source or target');
    }
    if (handoff.status !== 'cleanup_pending') {
      handoff = this.handoffs.update({
        id: handoff.id,
        expectedVersion: handoff.version,
        toStatus: 'cleanup_pending',
        message: 'session binding switched',
      });
    }
    await this.cleanupSource(handoff);
    if (handoff.artifact) {
      await this.options.snapshots.cleanup(
        this.store.getRequired(handoff.sourceEnvironmentId),
        this.store.getRequired(handoff.targetEnvironmentId),
        handoff.artifact.artifactId,
      );
    }
    handoff = this.handoffs.update({
      id: handoff.id,
      expectedVersion: handoff.version,
      toStatus: 'completed',
      message: 'source environment cleaned up',
    });
    const environment = this.store.getRequired(handoff.targetEnvironmentId);
    log.info({
      handoffId: handoff.id,
      sessionKey: handoff.sessionKey,
      sourceEnvironmentId: handoff.sourceEnvironmentId,
      targetEnvironmentId: handoff.targetEnvironmentId,
      targetHostId: handoff.targetHostId,
    }, 'Execution environment handoff completed');
    return { handoff, environment, cleanupPending: false };
  }

  private async inspect(environment: ExecutionEnvironment): Promise<{
    healthy: boolean;
    dirty: boolean;
    headSha?: string;
    problems: string[];
  }> {
    return environment.hostId === 'local'
      ? this.localWorktrees.inspect(environment.id)
      : this.options.remoteWorktrees.inspect(environment.id);
  }

  private async ensureTarget(
    handoff: ExecutionEnvironmentHandoff,
    project: Project,
    repositoryPath: string,
  ): Promise<ExecutionEnvironment> {
    if (!handoff.baseSha) throw new Error('Handoff base SHA is missing');
    const existing = this.store.get(handoff.targetEnvironmentId);
    if (existing) {
      if (
        existing.hostId !== handoff.targetHostId
        || existing.projectId !== project.id
        || existing.baseSha !== handoff.baseSha
      ) {
        throw new ExecutionEnvironmentConflictError('Handoff target does not match its persisted request');
      }
      if (existing.status === 'ready' || (handoff.artifact && existing.status === 'snapshotting')) {
        return existing;
      }
    }
    if (handoff.targetHostId === 'local') {
      if (existing) return this.localWorktrees.reconcile(existing.id);
      return this.localWorktrees.provisionManagedWorktree({
        projectId: project.id,
        repositoryPath,
        baseRef: handoff.baseSha,
        environmentId: handoff.targetEnvironmentId,
        requireClean: false,
      });
    }
    return this.options.remoteWorktrees.provisionManagedWorktree({
      projectId: project.id,
      hostId: handoff.targetHostId,
      repositoryPath,
      baseRef: handoff.baseSha,
      environmentId: handoff.targetEnvironmentId,
      requireClean: false,
    });
  }

  private async applySnapshot(
    target: ExecutionEnvironment,
    artifact: NonNullable<ExecutionEnvironmentHandoff['artifact']>,
  ): Promise<void> {
    let snapshotting = target;
    if (target.status === 'ready') {
      snapshotting = this.store.transition({
        environmentId: target.id,
        expectedVersion: target.version,
        toStatus: 'snapshotting',
        reason: 'handoff snapshot apply started',
        metadata: { artifactId: artifact.artifactId },
      });
    }
    try {
      await this.options.snapshots.apply(snapshotting, artifact);
      this.store.transition({
        environmentId: snapshotting.id,
        expectedVersion: snapshotting.version,
        toStatus: 'ready',
        reason: 'handoff snapshot applied',
        metadata: { artifactId: artifact.artifactId, sha256: artifact.sha256 },
      });
    } catch (error) {
      if (!isRetryable(error)) {
        const current = this.store.get(snapshotting.id);
        if (current?.status === 'snapshotting') {
          this.store.transition({
            environmentId: current.id,
            expectedVersion: current.version,
            toStatus: 'error',
            reason: 'handoff snapshot apply failed',
            error: errorMessage(error),
          });
        }
      }
      throw error;
    }
  }

  private async cleanupSource(handoff: ExecutionEnvironmentHandoff): Promise<void> {
    let source = this.store.getRequired(handoff.sourceEnvironmentId);
    if (source.status === 'deleted') return;
    if (source.pinned) {
      if (source.status === 'handing_off') {
        this.store.transition({
          environmentId: source.id,
          expectedVersion: source.version,
          toStatus: 'ready',
          reason: 'pinned handoff source retained',
          metadata: { handoffId: handoff.id },
        });
      }
      return;
    }
    if (source.status === 'handing_off') {
      source = this.store.transition({
        environmentId: source.id,
        expectedVersion: source.version,
        toStatus: 'stopped',
        reason: 'handoff source retired',
        metadata: { handoffId: handoff.id },
      });
    }
    if (source.hostId === 'local') await this.localWorktrees.remove(source.id);
    else await this.options.remoteWorktrees.remove(source.id);
  }

  private async rollbackBeforeSwitch(handoff: ExecutionEnvironmentHandoff, error: unknown): Promise<void> {
    const target = this.store.get(handoff.targetEnvironmentId);
    if (target && this.store.listBindings(target.id).length === 0 && target.status !== 'deleted') {
      await (target.hostId === 'local'
        ? this.localWorktrees.remove(target.id)
        : this.options.remoteWorktrees.remove(target.id)).catch(() => undefined);
    }
    const source = this.store.get(handoff.sourceEnvironmentId);
    if (handoff.artifact && source) {
      await this.options.snapshots.cleanup(source, target ?? source, handoff.artifact.artifactId).catch(() => undefined);
    }
    if (source?.status === 'handing_off') {
      this.store.transition({
        environmentId: source.id,
        expectedVersion: source.version,
        toStatus: 'ready',
        reason: 'execution environment handoff rolled back',
        error: errorMessage(error),
        metadata: { handoffId: handoff.id },
      });
      this.options.onEnvironmentFrozen?.(handoff.sessionKey);
    }
    this.updateHandoff(
      this.handoffs.getRequired(handoff.id),
      'failed',
      'handoff failed before binding switch',
      error,
    );
  }

  private updateHandoff(
    handoff: ExecutionEnvironmentHandoff,
    toStatus: ExecutionEnvironmentHandoff['status'],
    message: string,
    error: unknown,
  ): ExecutionEnvironmentHandoff {
    return this.handoffs.update({
      id: handoff.id,
      expectedVersion: handoff.version,
      toStatus,
      message,
      error: errorMessage(error),
    });
  }
}

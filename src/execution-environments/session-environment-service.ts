import { resolve } from 'node:path';

import type { Project, ProjectExecutionMode } from '../projects/types.js';
import { ExecutionEnvironmentHandoffStore } from './handoff-store.js';
import { LocalWorktreeManager } from './local-worktree-manager.js';
import { RemoteWorktreeManager } from './remote-worktree-manager.js';
import { ExecutionEnvironmentStore } from './store.js';
import {
  ExecutionEnvironmentConflictError,
  type ExecutionEnvironment,
} from './types.js';

export interface SessionEnvironmentServiceOptions {
  store?: ExecutionEnvironmentStore;
  worktrees?: LocalWorktreeManager;
  remoteWorktrees?: RemoteWorktreeManager;
  handoffs?: ExecutionEnvironmentHandoffStore;
}

export class SessionEnvironmentService {
  private readonly store: ExecutionEnvironmentStore;
  private readonly worktrees: LocalWorktreeManager;
  private readonly remoteWorktrees?: RemoteWorktreeManager;
  private readonly handoffs: ExecutionEnvironmentHandoffStore;

  constructor(options: SessionEnvironmentServiceOptions = {}) {
    this.store = options.store ?? new ExecutionEnvironmentStore();
    this.worktrees = options.worktrees ?? new LocalWorktreeManager({ store: this.store });
    this.remoteWorktrees = options.remoteWorktrees;
    this.handoffs = options.handoffs ?? new ExecutionEnvironmentHandoffStore();
  }

  get(sessionKey: string): ExecutionEnvironment | undefined {
    const binding = this.store.resolveBinding('session', sessionKey);
    return binding ? this.store.get(binding.environmentId) : undefined;
  }

  async attach(input: {
    sessionKey: string;
    project: Project;
    mode?: ProjectExecutionMode;
    baseRef?: string;
  }): Promise<ExecutionEnvironment> {
    if (this.handoffs.getActiveForSession(input.sessionKey)) {
      throw new ExecutionEnvironmentConflictError(`Session ${input.sessionKey} has an active environment handoff`);
    }
    const existing = this.get(input.sessionKey);
    if (existing) {
      if (existing.projectId !== input.project.id) {
        throw new ExecutionEnvironmentConflictError(
          `Session ${input.sessionKey} is already bound to a different project's execution environment`,
        );
      }
      if (input.mode && existing.kind !== input.mode) {
        throw new ExecutionEnvironmentConflictError(
          `Session ${input.sessionKey} is already using ${existing.kind}; release it before switching to ${input.mode}`,
        );
      }
      const expectedHostId = input.project.executionHostId ?? 'local';
      if (existing.hostId !== expectedHostId) {
        throw new ExecutionEnvironmentConflictError(
          `Session ${input.sessionKey} is bound to ${existing.hostId}; release it before switching to ${expectedHostId}`,
        );
      }
      return existing;
    }
    const workspaceRoot = input.project.workspaceRoot?.trim();
    if (!workspaceRoot) {
      throw new ExecutionEnvironmentConflictError(
        `Project ${input.project.id} needs a fixed workspace before an execution environment can be created`,
      );
    }
    const mode = input.mode ?? input.project.executionMode;
    if (input.project.executionHostId && mode !== 'managed_worktree') {
      throw new ExecutionEnvironmentConflictError('Remote execution hosts require managed worktree mode');
    }
    const environment = input.project.executionHostId
      ? await this.provisionRemoteWorktree(input.project, workspaceRoot, input.baseRef)
      : mode === 'managed_worktree'
        ? await this.worktrees.provisionManagedWorktree({
          projectId: input.project.id,
          repositoryPath: workspaceRoot,
          baseRef: input.baseRef,
        })
        : await this.resolveLocalCheckout(input.project.id, workspaceRoot);
    try {
      this.store.bind({
        subjectKind: 'session',
        subjectId: input.sessionKey,
        environmentId: environment.id,
      });
      return environment;
    } catch (error) {
      if (environment.kind === 'managed_worktree') {
        const manager = environment.hostId === 'local' ? this.worktrees : this.remoteWorktrees;
        await manager?.remove(environment.id).catch(() => undefined);
      }
      throw error;
    }
  }

  async release(sessionKey: string, removeManaged = true): Promise<ExecutionEnvironment | undefined> {
    if (this.handoffs.getActiveForSession(sessionKey)) {
      throw new ExecutionEnvironmentConflictError(`Session ${sessionKey} has an active environment handoff`);
    }
    const binding = this.store.resolveBinding('session', sessionKey);
    if (!binding) return undefined;
    const environment = this.store.get(binding.environmentId);
    this.store.releaseBinding('session', sessionKey, binding.environmentId);
    if (removeManaged && environment?.kind === 'managed_worktree' && !environment.pinned) {
      if (environment.hostId === 'local') await this.worktrees.remove(environment.id);
      else if (this.remoteWorktrees) await this.remoteWorktrees.remove(environment.id);
      else throw new Error('Remote worktree manager is unavailable');
    }
    return environment;
  }

  private provisionRemoteWorktree(
    project: Project,
    repositoryPath: string,
    baseRef?: string,
  ): Promise<ExecutionEnvironment> {
    if (!project.executionHostId || !this.remoteWorktrees) {
      throw new ExecutionEnvironmentConflictError('Remote worktree manager is unavailable');
    }
    return this.remoteWorktrees.provisionManagedWorktree({
      projectId: project.id,
      hostId: project.executionHostId,
      repositoryPath,
      baseRef,
    });
  }

  private async resolveLocalCheckout(projectId: string, workspaceRoot: string): Promise<ExecutionEnvironment> {
    const rootPath = resolve(workspaceRoot);
    const existing = this.store.list({ projectId, hostId: 'local', limit: 500 })
      .find((environment) =>
        environment.kind === 'local_checkout'
        && environment.rootPath === rootPath
        && (environment.status === 'ready' || environment.status === 'busy'));
    if (existing) return existing;
    try {
      return await this.worktrees.registerLocalCheckout({ projectId, workspacePath: rootPath });
    } catch (error) {
      const raced = this.store.list({ projectId, hostId: 'local', limit: 500 })
        .find((environment) =>
          environment.kind === 'local_checkout'
          && environment.rootPath === rootPath
          && (environment.status === 'ready' || environment.status === 'busy'));
      if (raced) return raced;
      throw error;
    }
  }
}

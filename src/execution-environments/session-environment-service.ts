import { resolve } from 'node:path';

import type { Project, ProjectExecutionMode } from '../projects/types.js';
import { LocalWorktreeManager } from './local-worktree-manager.js';
import { ExecutionEnvironmentStore } from './store.js';
import {
  ExecutionEnvironmentConflictError,
  type ExecutionEnvironment,
} from './types.js';

export interface SessionEnvironmentServiceOptions {
  store?: ExecutionEnvironmentStore;
  worktrees?: LocalWorktreeManager;
}

export class SessionEnvironmentService {
  private readonly store: ExecutionEnvironmentStore;
  private readonly worktrees: LocalWorktreeManager;

  constructor(options: SessionEnvironmentServiceOptions = {}) {
    this.store = options.store ?? new ExecutionEnvironmentStore();
    this.worktrees = options.worktrees ?? new LocalWorktreeManager({ store: this.store });
  }

  get(sessionKey: string): ExecutionEnvironment | undefined {
    const binding = this.store.resolveBinding(sessionKey);
    return binding ? this.store.get(binding.environmentId) : undefined;
  }

  async attach(input: {
    sessionKey: string;
    project: Project;
    mode?: ProjectExecutionMode;
    baseRef?: string;
  }): Promise<ExecutionEnvironment> {
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
      const checked = existing.kind === 'managed_worktree' ? await this.worktrees.reconcile(existing.id) : existing;
      if (checked.status !== 'ready') throw new ExecutionEnvironmentConflictError(`Execution environment ${checked.id} is ${checked.status}; repair it before resuming`);
      return checked;
    }
    const workspaceRoot = input.project.workspaceRoot?.trim();
    if (!workspaceRoot) {
      throw new ExecutionEnvironmentConflictError(
        `Project ${input.project.id} needs a fixed workspace before an execution environment can be created`,
      );
    }
    const mode = input.mode ?? input.project.executionMode;
    const environment = mode === 'managed_worktree'
      ? await this.worktrees.provisionManagedWorktree({
          projectId: input.project.id,
          repositoryPath: workspaceRoot,
          baseRef: input.baseRef,
        })
      : await this.resolveLocalCheckout(input.project.id, workspaceRoot);
    try {
      this.store.bind({
        sessionKey: input.sessionKey,
        environmentId: environment.id,
      });
      return environment;
    } catch (error) {
      if (environment.kind === 'managed_worktree') {
        await this.worktrees.remove(environment.id).catch(() => undefined);
      }
      throw error;
    }
  }

  async release(sessionKey: string, removeManaged = true): Promise<ExecutionEnvironment | undefined> {
    const binding = this.store.resolveBinding(sessionKey);
    if (!binding) return undefined;
    const environment = this.store.get(binding.environmentId);
    if (removeManaged && environment?.kind === 'managed_worktree') {
      await this.worktrees.remove(environment.id, { releaseSessionKey: sessionKey });
    } else {
      this.store.releaseBinding(sessionKey, binding.environmentId);
    }
    return environment;
  }

  private async resolveLocalCheckout(projectId: string, workspaceRoot: string): Promise<ExecutionEnvironment> {
    const rootPath = resolve(workspaceRoot);
    const existing = this.store.list({ projectId, limit: 500 })
      .find((environment) =>
        environment.kind === 'local_checkout'
        && environment.rootPath === rootPath
        && environment.status === 'ready');
    if (existing) return existing;
    try {
      return await this.worktrees.registerLocalCheckout({ projectId, workspacePath: rootPath });
    } catch (error) {
      const raced = this.store.list({ projectId, limit: 500 })
        .find((environment) =>
          environment.kind === 'local_checkout'
          && environment.rootPath === rootPath
          && environment.status === 'ready');
      if (raced) return raced;
      throw error;
    }
  }
}

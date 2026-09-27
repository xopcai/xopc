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

  get(conversationId: string): ExecutionEnvironment | undefined {
    const binding = this.store.resolveBinding(conversationId);
    return binding ? this.store.get(binding.environmentId) : undefined;
  }

  async attach(input: {
    conversationId: string;
    project: Project;
    mode?: ProjectExecutionMode;
    baseRef?: string;
    environmentId?: string;
    assertCurrent?: () => void;
  }): Promise<ExecutionEnvironment> {
    const existing = this.get(input.conversationId);
    if (existing) {
      if (existing.projectId !== input.project.id) {
        throw new ExecutionEnvironmentConflictError(
          `Session ${input.conversationId} is already bound to a different project's execution environment`,
        );
      }
      if (input.mode && existing.kind !== input.mode) {
        throw new ExecutionEnvironmentConflictError(
          `Session ${input.conversationId} is already using ${existing.kind}; release it before switching to ${input.mode}`,
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
    const reserved = input.environmentId ? this.store.get(input.environmentId) : undefined;
    if (reserved && (reserved.projectId !== input.project.id || reserved.kind !== mode)) {
      throw new ExecutionEnvironmentConflictError('Reserved execution environment does not match the project and mode');
    }
    let recovered = reserved?.kind === 'managed_worktree'
      ? await this.worktrees.reconcile(reserved.id).catch(error => {
        if (reserved.status === 'error') return reserved;
        throw error;
      }) : reserved;
    if (recovered?.kind === 'managed_worktree' && recovered.status === 'error') {
      recovered = await this.worktrees.provisionManagedWorktree({ projectId: input.project.id,
        repositoryPath: workspaceRoot, baseRef: input.baseRef, environmentId: recovered.id });
    }
    if (recovered && recovered.status !== 'ready') throw new ExecutionEnvironmentConflictError(`Execution environment ${recovered.id} is ${recovered.status}`);
    const environment = recovered ?? (mode === 'managed_worktree'
      ? await this.worktrees.provisionManagedWorktree({
          projectId: input.project.id,
          repositoryPath: workspaceRoot,
          baseRef: input.baseRef,
          environmentId: input.environmentId,
        })
      : await this.resolveLocalCheckout(input.project.id, workspaceRoot));
    try {
      input.assertCurrent?.();
      this.store.bind({
        conversationId: input.conversationId,
        environmentId: environment.id,
      });
      return environment;
    } catch (error) {
      if (environment.kind === 'managed_worktree' && !input.assertCurrent) {
        await this.worktrees.remove(environment.id).catch(() => undefined);
      }
      throw error;
    }
  }

  async release(conversationId: string, removeManaged = true): Promise<ExecutionEnvironment | undefined> {
    const binding = this.store.resolveBinding(conversationId);
    if (!binding) return undefined;
    const environment = this.store.get(binding.environmentId);
    if (removeManaged && environment?.kind === 'managed_worktree') {
      await this.worktrees.remove(environment.id, { releaseConversationId: conversationId });
    } else {
      this.store.releaseBinding(conversationId, binding.environmentId);
    }
    return environment;
  }

  async removeUnboundReservation(environmentId: string): Promise<boolean> {
    const environment = this.store.get(environmentId);
    if (!environment) return false;
    if (environment.status === 'deleted') return true;
    if (environment.kind !== 'managed_worktree' || this.store.listBindings(environmentId).length) {
      throw new ExecutionEnvironmentConflictError('Reserved environment is not an unbound managed worktree');
    }
    await this.worktrees.remove(environmentId);
    return true;
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

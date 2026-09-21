import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { readWorkspaceFile } from '../../agent/sandbox/fileAccess.js';
import { resolveStateDir } from '../../config/paths-state.js';
import { LocalWorktreeManager } from '../../execution-environments/local-worktree-manager.js';
import { ExecutionEnvironmentStore } from '../../execution-environments/store.js';
import { ProjectStore } from '../../projects/project-store.js';
import type { TaskFollowUpInput } from './contracts.js';
import { workspaceFingerprint } from './workspaceFingerprint.js';

export interface TaskResource {
  rootPath: string;
  environmentId?: string;
  assertLive(): void;
  assertIdentity(): Promise<void>;
  fingerprint(): Promise<string>;
}

/** Resource selection is infrastructure, independent of source and task semantics. */
export class TaskResources {
  constructor(private readonly options: { stateDir?: string; worktrees?: LocalWorktreeManager } = {}) {}

  artifactPath(operationId: string): string {
    if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new Error('Invalid resource operation identity');
    return resolve(realpathSync(this.options.stateDir ?? resolveStateDir()), 'task-artifacts', operationId);
  }

  async prepare(input: TaskFollowUpInput, taskId: string, operationId: string, conversationId: string): Promise<TaskResource | undefined> {
    if (input.resource === 'none') return undefined;
    if (input.resource === 'artifacts') {
      const rootPath = this.artifactPath(operationId);
      const parent = dirname(rootPath);
      if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
      if (realpathSync(parent) !== parent) throw new Error('Artifact parent identity changed');
      if (!existsSync(rootPath)) mkdirSync(rootPath, { mode: 0o700 });
      if (realpathSync(rootPath) !== rootPath || lstatSync(rootPath).isSymbolicLink()) throw new Error('Artifact directory identity changed');
      const identity = lstatSync(rootPath);
      const assertLive = () => {
        const current = lstatSync(rootPath);
        if (current.ino !== identity.ino || current.dev !== identity.dev || realpathSync(rootPath) !== rootPath) throw new Error('Artifact directory identity changed');
      };
      const assertIdentity = async () => assertLive();
      return { rootPath, assertLive, assertIdentity, fingerprint: async () => {
        await assertIdentity();
        const hash = createHash('sha256'); let files = 0;
        const visit = (directory: string) => {
          for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (++files > 1000) throw new Error('Artifact file budget exceeded');
            const path = join(directory, entry.name);
            hash.update(path.slice(rootPath.length));
            if (entry.isDirectory()) visit(path);
            else hash.update(readWorkspaceFile(rootPath, path, 262144));
          }
        };
        visit(rootPath); return hash.digest('hex');
      } };
    }
    const project = new ProjectStore().get(input.projectId!);
    if (!project?.workspaceRoot) throw new Error('Project repository unavailable');
    const environments = new ExecutionEnvironmentStore();
    const worktrees = this.options.worktrees ?? new LocalWorktreeManager({ stateDir: this.options.stateDir });
    let environment = environments.get(operationId);
    if (environment && (environment.projectId !== project.id || environment.branchRef !== `xopc/task-${taskId}`
      || environment.status !== 'ready' || environment.ownership !== 'xopc_created')) throw new Error('Resource provisioning requires reconciliation');
    environment ??= await worktrees.provisionManagedWorktree({ projectId: project.id, environmentId: operationId,
      repositoryPath: project.workspaceRoot, branchRef: `xopc/task-${taskId}` });
    const bound = environment;
    const canonicalRoot = realpathSync(bound.rootPath);
    const identity = lstatSync(canonicalRoot);
    const assertLive = () => {
      const current = lstatSync(bound.rootPath);
      if (current.ino !== identity.ino || current.dev !== identity.dev || realpathSync(bound.rootPath) !== canonicalRoot) throw new Error('Task workspace identity changed');
    };
    const assertIdentity = async () => {
      assertLive();
      const inspection = await worktrees.inspect(bound.id);
      if (!inspection.healthy || inspection.branchRef !== `refs/heads/${bound.branchRef}` || inspection.headSha !== bound.baseSha) throw new Error('Task worktree identity changed');
    };
    await assertIdentity();
    environments.bind({ conversationId, environmentId: bound.id });
    return { rootPath: bound.rootPath, environmentId: bound.id, assertLive, assertIdentity, fingerprint: () => workspaceFingerprint(bound.rootPath) };
  }
}

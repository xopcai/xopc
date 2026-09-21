import type { DatabaseSync } from 'node:sqlite';

import { inspectGitRepository, listGitWorktrees, runGit } from '../../execution-environments/git.js';
import { ProjectStore } from '../../projects/project-store.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import type { ScenePrincipal } from '../contracts.js';
import { SceneConflictError, SceneNotFoundError } from '../repository.js';

/** Associations are annotations only: existing branches never become autonomous write targets. */
export class TaskBranchInventory {
  constructor(private readonly db: DatabaseSync) {}

  private project(principal: ScenePrincipal, projectId: string) {
    const project = new ProjectStore().get(projectId);
    if (!project?.workspaceRoot || (project.ownerId && project.ownerId !== principal.ownerId)) throw new SceneNotFoundError('Project repository unavailable');
    return project;
  }

  async list(principal: ScenePrincipal, projectId: string) {
    const project = this.project(principal, projectId);
    const root = project.workspaceRoot!;
    const [repository, refs, worktrees] = await Promise.all([inspectGitRepository(root),
      runGit(root, ['for-each-ref', '--count=200', '--format=%(refname)%09%(objectname)%09%(subject)', 'refs/heads/']), listGitWorktrees(root)]);
    const annotations = this.db.prepare('SELECT * FROM scene_task_branch_links WHERE owner_id = ? AND workspace_id = ? AND project_id = ?')
      .all(principal.ownerId, principal.workspaceId, projectId);
    const managed = this.db.prepare(`SELECT b.task_id, b.activation_id, e.branch_ref FROM scene_task_bindings b
      JOIN scene_activations a ON a.id = b.activation_id JOIN execution_environments e ON e.environment_id = b.environment_id
      WHERE a.owner_id = ? AND a.workspace_id = ? AND e.project_id = ?`).all(principal.ownerId, principal.workspaceId, projectId);
    return { projectId, repositoryRoot: repository.repositoryRoot, checkoutDirty: repository.dirty,
      branches: refs.trim().split('\n').filter(Boolean).map(line => {
        const [ref, sha, ...subject] = line.split('\t');
        const annotation = annotations.find(item => item.branch_ref === ref);
        const binding = managed.find(item => `refs/heads/${item.branch_ref}` === ref);
        return { ref, sha, subject: subject.join('\t').slice(0, 300), worktree: worktrees.find(item => item.branchRef === ref)?.path,
          taskId: binding ? String(binding.task_id) : annotation ? String(annotation.task_id) : null,
          activationId: binding ? String(binding.activation_id) : null,
          association: binding ? 'managed' : annotation ? 'confirmed' : 'unassociated',
          changedSinceConfirmation: annotation ? annotation.confirmed_sha !== sha : false };
      }) };
  }

  async associate(principal: ScenePrincipal, input: { projectId: string; branchRef: string; expectedSha: string; taskId: string }) {
    const task = new TaskRepository().get(input.taskId);
    if (!task || task.projectId !== input.projectId || (task.ownerId && task.ownerId !== principal.ownerId)) throw new SceneNotFoundError('Task is not in this project');
    const inventory = await this.list(principal, input.projectId);
    const branch = inventory.branches.find(item => item.ref === input.branchRef);
    if (!branch || branch.sha !== input.expectedSha) throw new SceneConflictError('Branch changed; inspect it again');
    if (branch.taskId && branch.taskId !== task.id) throw new SceneConflictError('Branch is already associated with another task');
    this.db.prepare(`INSERT INTO scene_task_branch_links VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, workspace_id, project_id, branch_ref) DO UPDATE SET confirmed_sha = excluded.confirmed_sha, confirmed_at = excluded.confirmed_at`)
      .run(principal.ownerId, principal.workspaceId, input.projectId, input.branchRef, task.id, input.expectedSha, Date.now());
    return { ...branch, taskId: task.id, association: branch.association === 'managed' ? 'managed' : 'confirmed' };
  }
}

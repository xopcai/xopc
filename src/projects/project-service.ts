import { changedFieldsFromPatch, emitActivity, systemActivityActor, systemActivitySource } from '../activity/emitter.js';
import { getSessionMetadata } from '../storage/sqlite/index.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { ProjectStore } from './project-store.js';
import { enqueueProjectChanged } from './project-change-events.js';
import { drainProjectWorkspaceCreation, queueProjectWorkspaceCreation } from './project-workspace-creation.js';
import { DomainOutboxDispatcher } from '../infra/domain-outbox-dispatcher.js';
import { ExecutionEnvironmentStore } from '../execution-environments/store.js';
import { listPendingProjectUnderstandingRuns } from '../work-discovery/repository.js';
import { inferProjectExecutionMode } from './project-kind.js';
import { bindSessionToProject, listProjectConversationIds, unbindSessionFromProject } from './session-bind.js';
import type { CreateProjectInput, Project, ProjectHealth, ProjectListQuery, ProjectListResult, ProjectMilestone, ProjectUpdate, ProjectWithDetails, SidebarProjectListQuery, UpdateProjectInput } from './types.js';
import {
  canonicalWorkspacePath,
  inferProjectNameFromWorkspaceRoot,
  isPathSameOrInsideWorkspace,
  isSafeAutoCreateWorkspaceRoot,
  ProjectWorkspaceConflictError,
  ProjectWorkspaceMissingError,
  resolveWorkspaceProjectRoot,
  workspaceDirectoryExists,
  type WorkspaceProjectMatch,
} from './workspace-project.js';

export type ProjectSuggestion = {
  projectId: string;
  projectName: string;
  score: number;
  reason: string;
};

export class ProjectDeletionBlockedError extends Error {
  constructor() {
    super('Delete the project execution environments before deleting the project');
    this.name = 'ProjectDeletionBlockedError';
  }
}

export class ProjectWorkspaceInvalidError extends Error {
  constructor() {
    super('Invalid workspace root');
    this.name = 'ProjectWorkspaceInvalidError';
  }
}

export class ProjectWorkspaceInUseError extends Error {
  constructor() {
    super('Delete the project execution environments before changing its workspace');
    this.name = 'ProjectWorkspaceInUseError';
  }
}

export class ProjectService {
  constructor(
    private readonly store = new ProjectStore(),
  ) {}

  private listAllProjects(): Project[] {
    const items: Project[] = [];
    let offset = 0;
    const limit = 500;
    while (true) {
      const page = this.list({ limit, offset });
      items.push(...page.items);
      if (!page.hasMore || page.items.length === 0) break;
      offset += page.items.length;
    }
    return items;
  }

  create(input: CreateProjectInput): Project {
    const rawWorkspaceRoot = input.workspaceRoot?.trim();
    const workspaceRoot = rawWorkspaceRoot ? canonicalWorkspacePath(rawWorkspaceRoot) : undefined;
    if (rawWorkspaceRoot && !workspaceRoot) {
      throw new ProjectWorkspaceInvalidError();
    }
    const needsWorkspaceCreation = Boolean(workspaceRoot && !workspaceDirectoryExists(workspaceRoot));
    if (workspaceRoot) {
      const existing = this.findByWorkspaceRoot(workspaceRoot);
      if (existing) throw new ProjectWorkspaceConflictError(existing);
      if (needsWorkspaceCreation && input.createWorkspaceRoot !== true) throw new ProjectWorkspaceMissingError(workspaceRoot);
    }
    const name = input.name?.trim() || inferProjectNameFromWorkspaceRoot(workspaceRoot) || '';
    const slug = input.slug?.trim() || this.store.generateSlug(name);
    const executionMode = input.executionMode ?? inferProjectExecutionMode({
      name,
      description: input.description,
      workspaceRoot,
      projectKind: input.projectKind,
    });
    return runSqliteWriteTransaction(() => {
      const project = this.store.create({ ...input, name, slug, workspaceRoot, executionMode });
      if (needsWorkspaceCreation && workspaceRoot) queueProjectWorkspaceCreation(project.id, workspaceRoot);
      emitActivity({
        type: 'project.created',
        primaryObject: { kind: 'project', id: project.id, title: project.name },
        actor: systemActivityActor(),
        source: systemActivitySource(),
        payload: {
          name: project.name,
          workspaceRoot: project.workspaceRoot,
          brief: project.brief,
        },
        scopes: [{ scopeKind: 'project', scopeId: project.id, reason: 'object_owner' }],
        nowMs: project.createdAt,
      });
      enqueueProjectChanged(project, [], 'created');
      return project;
    });
  }

  get(id: string): Project | null {
    return this.store.get(id);
  }

  getBySlug(slug: string): Project | null {
    return this.store.findBySlug(slug);
  }

  list(query?: ProjectListQuery): ProjectListResult {
    return this.store.list(query);
  }

  listWithSidebarSessions(query?: SidebarProjectListQuery): ProjectListResult {
    return this.store.listWithSidebarSessions(query);
  }

  findByWorkspaceRoot(workspaceRoot: string, options: { excludeProjectId?: string } = {}): Project | null {
    const target = canonicalWorkspacePath(workspaceRoot);
    if (!target) return null;
    for (const project of this.listAllProjects()) {
      if (options.excludeProjectId && project.id === options.excludeProjectId) continue;
      const projectRoot = canonicalWorkspacePath(project.workspaceRoot);
      if (projectRoot && isPathSameOrInsideWorkspace(projectRoot, target) && isPathSameOrInsideWorkspace(target, projectRoot)) {
        return project;
      }
    }
    return null;
  }

  resolveForWorkspacePath(workspacePath: string): { project: Project; reason: 'exact' | 'contained' } | null {
    const target = canonicalWorkspacePath(workspacePath);
    if (!target) return null;
    let best: { project: Project; root: string; reason: 'exact' | 'contained' } | null = null;
    for (const project of this.listAllProjects()) {
      const root = canonicalWorkspacePath(project.workspaceRoot);
      if (!root || !isPathSameOrInsideWorkspace(root, target)) continue;
      const reason = isPathSameOrInsideWorkspace(root, target) && isPathSameOrInsideWorkspace(target, root) ? 'exact' : 'contained';
      if (!best || root.length > best.root.length) {
        best = { project, root, reason };
      }
    }
    return best ? { project: best.project, reason: best.reason } : null;
  }

  resolveOrCreateForWorkspacePath(input: {
    workspacePath: string;
    agentId?: string;
    defaultAgentId?: string;
    autoCreate?: boolean;
  }): WorkspaceProjectMatch | null {
    const existing = this.resolveForWorkspacePath(input.workspacePath);
    if (existing) return { project: existing.project, reason: existing.reason, created: false };
    if (!input.autoCreate) return null;
    const workspaceRoot = resolveWorkspaceProjectRoot(input.workspacePath) ?? canonicalWorkspacePath(input.workspacePath);
    if (!workspaceRoot || !isSafeAutoCreateWorkspaceRoot(workspaceRoot)) return null;
    const rootExisting = this.resolveForWorkspacePath(workspaceRoot);
    if (rootExisting) return { project: rootExisting.project, reason: rootExisting.reason, created: false };
    const project = this.create({
      name: inferProjectNameFromWorkspaceRoot(workspaceRoot) ?? undefined,
      workspaceRoot,
      defaultAgentId: Object.hasOwn(input, 'defaultAgentId') ? input.defaultAgentId : input.agentId,
    });
    return { project, reason: 'auto_created', created: true };
  }

  update(id: string, input: UpdateProjectInput): Project {
    if (!this.store.get(id)) throw new Error(`Project not found: ${id}`);
    const patch = { ...input };
    let needsWorkspaceCreation = false;
    if (input.workspaceRoot !== undefined && input.workspaceRoot !== null && input.workspaceRoot.trim()) {
      const workspaceRoot = canonicalWorkspacePath(input.workspaceRoot);
      if (!workspaceRoot) {
        throw new ProjectWorkspaceInvalidError();
      }
      const existing = this.findByWorkspaceRoot(workspaceRoot, { excludeProjectId: id });
      if (existing) throw new ProjectWorkspaceConflictError(existing);
      needsWorkspaceCreation = !workspaceDirectoryExists(workspaceRoot);
      if (needsWorkspaceCreation && input.createWorkspaceRoot !== true) throw new ProjectWorkspaceMissingError(workspaceRoot);
      patch.workspaceRoot = workspaceRoot;
    }
    return runSqliteWriteTransaction(() => {
      const before = this.store.get(id);
      if (patch.workspaceRoot !== undefined && (patch.workspaceRoot || undefined) !== before?.workspaceRoot
        && new ExecutionEnvironmentStore().list({ projectId: id, limit: 1 }).length) throw new ProjectWorkspaceInUseError();
      const project = this.store.update(id, patch);
      if (needsWorkspaceCreation && project.workspaceRoot) queueProjectWorkspaceCreation(project.id, project.workspaceRoot);
      const changes = changedFieldsFromPatch(patch as Record<string, unknown>, ['createWorkspaceRoot']);
      const type = before?.status !== project.status
        ? 'project.status_changed'
        : before?.workspaceRoot !== project.workspaceRoot
          ? 'project.workspace_changed'
          : 'project.updated';
      emitActivity({
        type,
        primaryObject: { kind: 'project', id: project.id, title: project.name },
        actor: systemActivityActor(), source: systemActivitySource(),
        payload: { changes,
          ...(type === 'project.status_changed' ? { from: before?.status, to: project.status } : {}),
          ...(type === 'project.workspace_changed' ? { from: before?.workspaceRoot, to: project.workspaceRoot } : {}) },
        scopes: [{ scopeKind: 'project', scopeId: project.id, reason: 'object_owner' }], nowMs: project.updatedAt,
      });
      enqueueProjectChanged(project, changes);
      return project;
    });
  }

  pin(id: string): Project {
    return this.update(id, { pinnedAt: Date.now() });
  }

  unpin(id: string): Project {
    return this.update(id, { pinnedAt: null });
  }

  delete(id: string): void {
    runSqliteWriteTransaction(() => {
      const project = this.store.get(id);
      if (!project) return;
      if (new ExecutionEnvironmentStore().list({ projectId: id, limit: 1 }).length) throw new ProjectDeletionBlockedError();
      const deletedUnderstandingRunIds = listPendingProjectUnderstandingRuns(id).map(run => run.id);
      this.store.delete(id);
      enqueueProjectChanged({ ...project, version: project.version + 1, updatedAt: Math.max(Date.now(), project.updatedAt + 1) }, [], 'deleted', deletedUnderstandingRunIds);
    });
  }

  getWithDetails(id: string): ProjectWithDetails | null {
    return this.store.getWithDetails(id);
  }

  listMilestones(projectId: string): ProjectMilestone[] {
    return this.store.listMilestones(projectId);
  }

  createMilestone(projectId: string, input: Parameters<ProjectStore['createMilestone']>[1]): ProjectMilestone {
    return runSqliteWriteTransaction(() => {
      const milestone = this.store.createMilestone(projectId, input);
      this.recordMilestoneChange(projectId);
      return milestone;
    });
  }

  updateMilestone(projectId: string, milestoneId: string, input: Parameters<ProjectStore['updateMilestone']>[2]): ProjectMilestone {
    return runSqliteWriteTransaction(() => {
      const milestone = this.store.updateMilestone(projectId, milestoneId, input);
      this.recordMilestoneChange(projectId);
      return milestone;
    });
  }

  deleteMilestone(projectId: string, milestoneId: string): boolean {
    return runSqliteWriteTransaction(() => {
      const deleted = this.store.deleteMilestone(projectId, milestoneId);
      if (deleted) this.recordMilestoneChange(projectId);
      return deleted;
    });
  }

  private recordMilestoneChange(projectId: string): void {
    const project = this.store.update(projectId, {});
    enqueueProjectChanged(project, ['milestones']);
  }

  flushCommittedEffects(projectId?: string): void {
    drainProjectWorkspaceCreation(projectId);
    new DomainOutboxDispatcher().drain(100, 'project');
  }

  listUpdates(projectId: string, limit?: number): ProjectUpdate[] {
    return this.store.listUpdates(projectId, limit);
  }

  createUpdate(projectId: string, input: {
    health: ProjectHealth;
    summary: string;
    progress?: string[];
    risks?: string[];
    nextSteps?: string[];
    actor: Record<string, unknown>;
  }): ProjectUpdate {
    return runSqliteWriteTransaction(() => {
      const update = this.store.createUpdate(projectId, input);
      enqueueProjectChanged(this.store.get(projectId)!, ['health', 'updates']);
      return update;
    });
  }

  attachSession(conversationId: string, projectId: string): void {
    runSqliteWriteTransaction(() => {
      const previousProjectId = getSessionMetadata(conversationId)?.projectId;
      if (previousProjectId === projectId) return;
      bindSessionToProject(conversationId, projectId);
      enqueueProjectChanged(this.store.update(projectId, {}), ['sessions']);
      if (previousProjectId && this.store.get(previousProjectId)) {
        enqueueProjectChanged(this.store.update(previousProjectId, {}), ['sessions']);
      }
    });
  }

  detachSession(conversationId: string): void {
    unbindSessionFromProject(conversationId);
  }

  listConversationIds(projectId: string, limit?: number, offset?: number): string[] {
    return listProjectConversationIds(projectId, limit, offset);
  }

  suggestProjectsForSession(conversationId: string): ProjectSuggestion[] {
    const session = getSessionMetadata(conversationId);
    if (!session) return [];
    const projects = this.list({ status: 'active', limit: 500 }).items;
    const haystack = [session.key, session.name, session.routing?.agentId, session.sourceChannel, ...(session.tags ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const suggestions: ProjectSuggestion[] = [];
    for (const project of projects) {
      let score = 0;
      const reasons: string[] = [];
      if (haystack.includes(project.slug.toLowerCase())) {
        score += 10;
        reasons.push('session metadata matches project slug');
      }
      for (const token of project.name.toLowerCase().split(/\s+/).filter((t) => t.length >= 3)) {
        if (haystack.includes(token)) {
          score += 3;
          reasons.push(`matches ${token}`);
          break;
        }
      }
      if (score > 0) {
        suggestions.push({ projectId: project.id, projectName: project.name, score, reason: reasons.join(', ') });
      }
    }
    return suggestions.sort((a, b) => b.score - a.score).slice(0, 5);
  }
}

import { createHash } from 'node:crypto';

import { changedFieldsFromPatch, emitActivity, systemActivityActor, systemActivitySource } from '../activity/emitter.js';
import { getSessionMetadata } from '../storage/sqlite/index.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { getExecutionHost } from '../execution-hosts/repository.js';
import type { ProactiveSignalPublisher } from '../proactive/events/publisher.js';
import { ProjectStore } from './project-store.js';
import { inferProjectExecutionMode } from './project-kind.js';
import { bindSessionToProject, listProjectSessionKeys, unbindSessionFromProject } from './session-bind.js';
import type { CreateProjectInput, Project, ProjectHealth, ProjectListQuery, ProjectListResult, ProjectMilestone, ProjectUpdate, ProjectWithDetails, SidebarProjectListQuery, UpdateProjectInput } from './types.js';
import {
  canonicalWorkspacePath,
  ensureWorkspaceDirectory,
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

export class ProjectService {
  constructor(private readonly store = new ProjectStore(), private readonly signals?: ProactiveSignalPublisher) {}

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
      throw new Error('Invalid workspace root');
    }
    if (workspaceRoot) {
      const existing = this.findByWorkspaceRoot(workspaceRoot);
      if (existing) throw new ProjectWorkspaceConflictError(existing);
      if (!workspaceDirectoryExists(workspaceRoot)) {
        if (input.createWorkspaceRoot === true) {
          ensureWorkspaceDirectory(workspaceRoot);
        } else {
          throw new ProjectWorkspaceMissingError(workspaceRoot);
        }
      }
    }
    const name = input.name?.trim() || inferProjectNameFromWorkspaceRoot(workspaceRoot) || '';
    const slug = input.slug?.trim() || this.store.generateSlug(name);
    const executionMode = input.executionMode ?? inferProjectExecutionMode({
      name,
      description: input.description,
      workspaceRoot,
      projectKind: input.projectKind,
    });
    if (input.executionHostId?.trim() && !workspaceRoot) {
      throw new Error('Remote execution hosts require a fixed project workspace');
    }
    this.validateExecutionPlacement(executionMode, input.executionHostId, true);
    const project = this.store.create({ ...input, name, slug, workspaceRoot, executionMode });
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
    return project;
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
    const patch = { ...input };
    if (input.workspaceRoot !== undefined && input.workspaceRoot !== null && input.workspaceRoot.trim()) {
      const workspaceRoot = canonicalWorkspacePath(input.workspaceRoot);
      if (!workspaceRoot) {
        throw new Error('Invalid workspace root');
      }
      const existing = this.findByWorkspaceRoot(workspaceRoot, { excludeProjectId: id });
      if (existing) throw new ProjectWorkspaceConflictError(existing);
      if (!workspaceDirectoryExists(workspaceRoot)) {
        if (input.createWorkspaceRoot === true) {
          ensureWorkspaceDirectory(workspaceRoot);
        } else {
          throw new ProjectWorkspaceMissingError(workspaceRoot);
        }
      }
      patch.workspaceRoot = workspaceRoot;
    }
    const current = this.store.get(id);
    if (!current) throw new Error(`Project not found: ${id}`);
    const nextExecutionHostId = input.executionHostId === undefined
      ? current.executionHostId
      : input.executionHostId ?? undefined;
    const nextWorkspaceRoot = input.workspaceRoot === undefined
      ? current.workspaceRoot
      : patch.workspaceRoot ?? undefined;
    if (nextExecutionHostId?.trim() && !nextWorkspaceRoot) {
      throw new Error('Remote execution hosts require a fixed project workspace');
    }
    this.validateExecutionPlacement(
      input.executionMode ?? current.executionMode,
      nextExecutionHostId,
      input.executionHostId !== undefined && nextExecutionHostId !== current.executionHostId,
    );
    return runSqliteWriteTransaction(() => {
      const before = this.store.get(id);
      const project = this.store.update(id, patch);
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
      this.signals?.publish({
        type: 'project.updated.v1', schemaVersion: 1,
        source: { kind: 'projects', id: 'local' }, subject: { kind: 'project', id: project.id }, actor: { kind: 'system' },
        scope: { workspaceId: 'default', projectId: project.id }, occurredAt: new Date(project.updatedAt).toISOString(),
        dedupeKey: `project:${project.id}:${project.updatedAt}:${createHash('sha256').update(JSON.stringify(patch)).digest('hex')}`,
        sensitivity: 'personal', payload: { before, after: project, changes },
      });
      return project;
    });
  }

  private validateExecutionPlacement(
    executionMode: Project['executionMode'],
    executionHostId: string | undefined,
    requireActiveHost: boolean,
  ): void {
    const hostId = executionHostId?.trim();
    if (!hostId) return;
    if (executionMode !== 'managed_worktree') {
      throw new Error('Remote execution hosts require managed worktree mode');
    }
    if (requireActiveHost) {
      const host = getExecutionHost(hostId);
      if (!host || host.lifecycleStatus === 'revoked') {
        throw new Error(`Active execution host not found: ${hostId}`);
      }
    }
  }

  pin(id: string): Project {
    return this.update(id, { pinnedAt: Date.now() });
  }

  unpin(id: string): Project {
    return this.update(id, { pinnedAt: null });
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  getWithDetails(id: string): ProjectWithDetails | null {
    return this.store.getWithDetails(id);
  }

  listMilestones(projectId: string): ProjectMilestone[] {
    return this.store.listMilestones(projectId);
  }

  createMilestone(projectId: string, input: Parameters<ProjectStore['createMilestone']>[1]): ProjectMilestone {
    return this.store.createMilestone(projectId, input);
  }

  updateMilestone(projectId: string, milestoneId: string, input: Parameters<ProjectStore['updateMilestone']>[2]): ProjectMilestone {
    return this.store.updateMilestone(projectId, milestoneId, input);
  }

  deleteMilestone(projectId: string, milestoneId: string): boolean {
    return this.store.deleteMilestone(projectId, milestoneId);
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
    return this.store.createUpdate(projectId, input);
  }

  attachSession(sessionKey: string, projectId: string): void {
    bindSessionToProject(sessionKey, projectId);
  }

  detachSession(sessionKey: string): void {
    unbindSessionFromProject(sessionKey);
  }

  listSessionKeys(projectId: string, limit?: number, offset?: number): string[] {
    return listProjectSessionKeys(projectId, limit, offset);
  }

  suggestProjectsForSession(sessionKey: string): ProjectSuggestion[] {
    const session = getSessionMetadata(sessionKey);
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

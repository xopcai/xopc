import { getSessionMetadata } from '../storage/sqlite/index.js';
import { ProjectStore } from './project-store.js';
import { bindGoalToProject, listProjectGoalIds, unbindGoalFromProject } from './goal-bind.js';
import { bindSessionToProject, listProjectSessionKeys, unbindSessionFromProject } from './session-bind.js';
import type { CreateProjectInput, Project, ProjectListQuery, ProjectListResult, ProjectWithDetails, UpdateProjectInput } from './types.js';
import {
  canonicalWorkspacePath,
  inferProjectNameFromWorkspaceRoot,
  isPathSameOrInsideWorkspace,
  isSafeAutoCreateWorkspaceRoot,
  ProjectWorkspaceConflictError,
  resolveWorkspaceProjectRoot,
  type WorkspaceProjectMatch,
} from './workspace-project.js';

export type ProjectSuggestion = {
  projectId: string;
  projectName: string;
  score: number;
  reason: string;
};

export class ProjectService {
  constructor(private readonly store = new ProjectStore()) {}

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
    const workspaceRoot = input.workspaceRoot?.trim();
    if (workspaceRoot) {
      const existing = this.findByWorkspaceRoot(workspaceRoot);
      if (existing) throw new ProjectWorkspaceConflictError(existing);
    }
    const name = input.name?.trim() || inferProjectNameFromWorkspaceRoot(workspaceRoot) || '';
    const slug = input.slug?.trim() || this.store.generateSlug(name);
    return this.store.create({ ...input, name, slug });
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
      defaultAgentId: input.agentId,
    });
    return { project, reason: 'auto_created', created: true };
  }

  update(id: string, input: UpdateProjectInput): Project {
    if (input.workspaceRoot !== undefined && input.workspaceRoot !== null && input.workspaceRoot.trim()) {
      const existing = this.findByWorkspaceRoot(input.workspaceRoot, { excludeProjectId: id });
      if (existing) throw new ProjectWorkspaceConflictError(existing);
    }
    return this.store.update(id, input);
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  getWithDetails(id: string): ProjectWithDetails | null {
    return this.store.getWithDetails(id);
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

  attachGoal(goalId: string, projectId: string): void {
    bindGoalToProject(goalId, projectId);
  }

  detachGoal(goalId: string): void {
    unbindGoalFromProject(goalId);
  }

  listGoalIds(projectId: string, limit?: number, offset?: number): string[] {
    return listProjectGoalIds(projectId, limit, offset);
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

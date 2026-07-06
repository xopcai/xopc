import { getSessionMetadata } from '../storage/sqlite/index.js';
import { ProjectStore } from './project-store.js';
import { bindGoalToProject, listProjectGoalIds, unbindGoalFromProject } from './goal-bind.js';
import { bindSessionToProject, listProjectSessionKeys, unbindSessionFromProject } from './session-bind.js';
import type { CreateProjectInput, Project, ProjectListQuery, ProjectListResult, ProjectWithDetails, UpdateProjectInput } from './types.js';

export type ProjectSuggestion = {
  projectId: string;
  projectName: string;
  score: number;
  reason: string;
};

export class ProjectService {
  constructor(private readonly store = new ProjectStore()) {}

  create(input: CreateProjectInput): Project {
    const slug = input.slug?.trim() || this.store.generateSlug(input.name);
    return this.store.create({ ...input, slug });
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

  update(id: string, input: UpdateProjectInput): Project {
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

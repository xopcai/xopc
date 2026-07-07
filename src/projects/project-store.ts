import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import type {
  CreateProjectInput,
  Project,
  ProjectListQuery,
  ProjectListResult,
  ProjectStatus,
  ProjectWithDetails,
  UpdateProjectInput,
} from './types.js';

export type ProjectRow = {
  project_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  default_agent_id: string | null;
  workspace_root: string | null;
  brief: string | null;
  instructions: string | null;
  created_at: number;
  updated_at: number;
  last_active_at: number | null;
};

function trimOptional(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function nullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.project_id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    status: row.status as ProjectStatus,
    defaultAgentId: row.default_agent_id ?? undefined,
    workspaceRoot: row.workspace_root ?? undefined,
    brief: row.brief ?? undefined,
    instructions: row.instructions ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at ?? undefined,
  };
}

function clampLimit(limit: number | undefined, fallback = 50): number {
  return Math.min(500, Math.max(1, Math.floor(limit ?? fallback)));
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Project name is required');
  return trimmed;
}

export function slugifyProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || `project-${Date.now()}`;
}

function projectSortColumn(sortBy: ProjectListQuery['sortBy']): string {
  switch (sortBy) {
    case 'createdAt':
      return 'created_at';
    case 'name':
      return 'LOWER(name)';
    case 'updatedAt':
    default:
      return 'updated_at';
  }
}

export class ProjectStore {
  create(input: CreateProjectInput): Project {
    const now = Date.now();
    const name = normalizeName(input.name);
    const slug = input.slug?.trim() || slugifyProjectName(name);
    const project: Project = {
      id: randomUUID(),
      name,
      slug,
      description: trimOptional(input.description),
      status: 'active',
      defaultAgentId: trimOptional(input.defaultAgentId),
      workspaceRoot: trimOptional(input.workspaceRoot),
      brief: trimOptional(input.brief),
      instructions: trimOptional(input.instructions),
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
    };

    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO projects (
          project_id, name, slug, description, status, default_agent_id, workspace_root,
          brief, instructions, created_at, updated_at, last_active_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        project.id,
        project.name,
        project.slug,
        project.description ?? null,
        project.status,
        project.defaultAgentId ?? null,
        project.workspaceRoot ?? null,
        project.brief ?? null,
        project.instructions ?? null,
        project.createdAt,
        project.updatedAt,
        project.lastActiveAt ?? null,
      );
    });
    return project;
  }

  get(id: string): Project | null {
    const row = getSqliteDatabase()
      .prepare(`SELECT * FROM projects WHERE project_id = ?`)
      .get(id) as ProjectRow | undefined;
    return row ? projectFromRow(row) : null;
  }

  findBySlug(slug: string): Project | null {
    const row = getSqliteDatabase()
      .prepare(`SELECT * FROM projects WHERE slug = ?`)
      .get(slug.trim()) as ProjectRow | undefined;
    return row ? projectFromRow(row) : null;
  }

  list(query: ProjectListQuery = {}): ProjectListResult {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    if (query.search?.trim()) {
      const like = `%${query.search.trim().toLowerCase()}%`;
      conditions.push(`(LOWER(name) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ?)`);
      params.push(like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = clampLimit(query.limit, 50);
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const sortColumn = projectSortColumn(query.sortBy);
    const db = getSqliteDatabase();
    const total = (db.prepare(`SELECT COUNT(*) AS total FROM projects ${where}`).get(...params) as { total: number }).total;
    const rows = db
      .prepare(`SELECT * FROM projects ${where} ORDER BY ${sortColumn} ${sortOrder} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as ProjectRow[];
    return { items: rows.map(projectFromRow), total, limit, offset, hasMore: offset + limit < total };
  }

  update(id: string, input: UpdateProjectInput): Project {
    const before = this.get(id);
    if (!before) throw new Error(`Project not found: ${id}`);
    const next = {
      ...before,
      ...(input.name !== undefined ? { name: normalizeName(input.name) } : {}),
      ...(input.description !== undefined ? { description: nullableText(input.description) ?? undefined } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.defaultAgentId !== undefined ? { defaultAgentId: nullableText(input.defaultAgentId) ?? undefined } : {}),
      ...(input.workspaceRoot !== undefined ? { workspaceRoot: nullableText(input.workspaceRoot) ?? undefined } : {}),
      ...(input.brief !== undefined ? { brief: nullableText(input.brief) ?? undefined } : {}),
      ...(input.instructions !== undefined ? { instructions: nullableText(input.instructions) ?? undefined } : {}),
      updatedAt: Date.now(),
    } satisfies Project;

    runSqliteWriteTransaction((db) => {
      db.prepare(
        `UPDATE projects SET
          name = ?, description = ?, status = ?, default_agent_id = ?, workspace_root = ?, brief = ?, instructions = ?, updated_at = ?
         WHERE project_id = ?`,
      ).run(
        next.name,
        next.description ?? null,
        next.status,
        next.defaultAgentId ?? null,
        next.workspaceRoot ?? null,
        next.brief ?? null,
        next.instructions ?? null,
        next.updatedAt,
        id,
      );
    });
    return this.get(id)!;
  }

  delete(id: string): void {
    runSqliteWriteTransaction((db) => {
      db.prepare(`UPDATE sessions SET project_id = NULL WHERE project_id = ?`).run(id);
      db.prepare(`UPDATE goals SET project_id = NULL WHERE project_id = ?`).run(id);
      db.prepare(`UPDATE workflow_runs SET project_id = NULL WHERE project_id = ?`).run(id);
      db.prepare(`UPDATE automations SET project_id = NULL WHERE project_id = ?`).run(id);
      db.prepare(`UPDATE memory_records SET project_id = NULL WHERE project_id = ?`).run(id);
      db.prepare(`DELETE FROM projects WHERE project_id = ?`).run(id);
    });
  }

  getSessionCount(id: string): number {
    return (getSqliteDatabase()
      .prepare(`SELECT COUNT(*) AS total FROM sessions WHERE project_id = ? AND hidden_from_session_list = 0`)
      .get(id) as { total: number }).total;
  }

  getGoalCount(id: string): number {
    return (getSqliteDatabase().prepare(`SELECT COUNT(*) AS total FROM goals WHERE project_id = ?`).get(id) as { total: number }).total;
  }

  getActiveGoalCount(id: string): number {
    return (getSqliteDatabase()
      .prepare(`SELECT COUNT(*) AS total FROM goals WHERE project_id = ? AND status IN ('active', 'paused', 'blocked', 'needs_input')`)
      .get(id) as { total: number }).total;
  }

  getRecentSessions(id: string, limit = 5): ProjectWithDetails['recentSessions'] {
    const rows = getSqliteDatabase()
      .prepare(
        `SELECT session_key, name, updated_at, agent_id FROM sessions
         WHERE project_id = ? AND hidden_from_session_list = 0 ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(id, clampLimit(limit, 5)) as Array<{ session_key: string; name: string | null; updated_at: number; agent_id: string }>;
    return rows.map((row) => ({
      key: row.session_key,
      name: row.name ?? undefined,
      updatedAt: new Date(row.updated_at).toISOString(),
      agentId: row.agent_id,
    }));
  }

  getRecentWorkflowRuns(id: string, limit = 5): ProjectWithDetails['recentWorkflowRuns'] {
    const rows = getSqliteDatabase()
      .prepare(
        `SELECT run_id, definition_id, status, created_at_ms FROM workflow_runs
         WHERE project_id = ? ORDER BY created_at_ms DESC LIMIT ?`,
      )
      .all(id, clampLimit(limit, 5)) as Array<{ run_id: string; definition_id: string; status: string; created_at_ms: number }>;
    return rows.map((row) => ({ runId: row.run_id, definitionId: row.definition_id, status: row.status, createdAt: row.created_at_ms }));
  }

  getWithDetails(id: string): ProjectWithDetails | null {
    const project = this.get(id);
    if (!project) return null;
    return {
      ...project,
      sessionCount: this.getSessionCount(id),
      goalCount: this.getGoalCount(id),
      activeGoalCount: this.getActiveGoalCount(id),
      recentSessions: this.getRecentSessions(id),
      recentWorkflowRuns: this.getRecentWorkflowRuns(id),
    };
  }

  generateSlug(name: string): string {
    const base = slugifyProjectName(name);
    let candidate = base;
    let counter = 2;
    while (this.findBySlug(candidate)) {
      candidate = `${base}-${counter}`;
      counter += 1;
    }
    return candidate;
  }
}

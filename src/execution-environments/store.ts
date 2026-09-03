import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import {
  canTransitionExecutionEnvironment,
  ExecutionEnvironmentConflictError,
  ExecutionEnvironmentNotFoundError,
  type BindExecutionEnvironmentInput,
  type CreateExecutionEnvironmentInput,
  type ExecutionEnvironment,
  type ExecutionEnvironmentBinding,
  type ExecutionEnvironmentEvent,
  type ExecutionEnvironmentListQuery,
  type ExecutionEnvironmentStatus,
  type TransitionExecutionEnvironmentInput,
} from './types.js';

type EnvironmentRow = {
  environment_id: string;
  project_id: string | null;
  kind: ExecutionEnvironment['kind'];
  status: ExecutionEnvironmentStatus;
  root_path: string;
  repository_root: string | null;
  git_common_dir: string | null;
  base_ref: string | null;
  base_sha: string | null;
  branch_ref: string | null;
  version: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  deleted_at: number | null;
};

type BindingRow = {
  binding_id: string;
  session_key: string;
  environment_id: string;
  created_at: number;
  released_at: number | null;
};

type EventRow = {
  event_id: string;
  environment_id: string;
  from_status: ExecutionEnvironmentStatus | null;
  to_status: ExecutionEnvironmentStatus;
  reason: string;
  metadata_json: string;
  created_at: number;
};

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function environmentFromRow(row: EnvironmentRow): ExecutionEnvironment {
  return {
    id: row.environment_id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    kind: row.kind,
    status: row.status,
    rootPath: row.root_path,
    ...(row.repository_root ? { repositoryRoot: row.repository_root } : {}),
    ...(row.git_common_dir ? { gitCommonDir: row.git_common_dir } : {}),
    ...(row.base_ref ? { baseRef: row.base_ref } : {}),
    ...(row.base_sha ? { baseSha: row.base_sha } : {}),
    ...(row.branch_ref ? { branchRef: row.branch_ref } : {}),
    version: row.version,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_used_at == null ? {} : { lastUsedAt: row.last_used_at }),
    ...(row.deleted_at == null ? {} : { deletedAt: row.deleted_at }),
  };
}

function bindingFromRow(row: BindingRow): ExecutionEnvironmentBinding {
  return {
    id: row.binding_id,
    sessionKey: row.session_key,
    environmentId: row.environment_id,
    createdAt: row.created_at,
    ...(row.released_at == null ? {} : { releasedAt: row.released_at }),
  };
}

function eventFromRow(row: EventRow): ExecutionEnvironmentEvent {
  return {
    id: row.event_id,
    environmentId: row.environment_id,
    ...(row.from_status ? { fromStatus: row.from_status } : {}),
    toStatus: row.to_status,
    reason: row.reason,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function getEnvironmentRow(environmentId: string): EnvironmentRow | undefined {
  return getSqliteDatabase()
    .prepare(`SELECT * FROM execution_environments WHERE environment_id = ?`)
    .get(environmentId) as EnvironmentRow | undefined;
}

export class ExecutionEnvironmentStore {
  create(input: CreateExecutionEnvironmentInput): ExecutionEnvironment {
    const id = input.id?.trim() || randomUUID();
    const rootPath = resolve(requiredText(input.rootPath, 'rootPath'));
    const projectId = optionalText(input.projectId);
    const repositoryRoot = optionalText(input.repositoryRoot);
    const gitCommonDir = optionalText(input.gitCommonDir);
    if (input.kind === 'managed_worktree' && (!repositoryRoot || !gitCommonDir)) {
      throw new Error('managed_worktree requires repositoryRoot and gitCommonDir');
    }

    const now = Date.now();
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO execution_environments (
          environment_id, project_id, kind, status, root_path,
          repository_root, git_common_dir, base_ref, base_sha, branch_ref,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(
        id,
        projectId ?? null,
        input.kind,
        rootPath,
        repositoryRoot ? resolve(repositoryRoot) : null,
        gitCommonDir ? resolve(gitCommonDir) : null,
        optionalText(input.baseRef) ?? null,
        optionalText(input.baseSha) ?? null,
        optionalText(input.branchRef) ?? null,
        now,
        now,
      );
      db.prepare(
        `INSERT INTO execution_environment_events (
          event_id, environment_id, from_status, to_status, reason, metadata_json, created_at
        ) VALUES (?, ?, NULL, 'requested', 'created', '{}', ?)`,
      ).run(randomUUID(), id, now);
    });
    return this.getRequired(id);
  }

  get(environmentId: string): ExecutionEnvironment | undefined {
    const row = getEnvironmentRow(environmentId);
    return row ? environmentFromRow(row) : undefined;
  }

  getRequired(environmentId: string): ExecutionEnvironment {
    const environment = this.get(environmentId);
    if (!environment) throw new ExecutionEnvironmentNotFoundError(environmentId);
    return environment;
  }

  list(query: ExecutionEnvironmentListQuery = {}): ExecutionEnvironment[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (query.projectId) {
      clauses.push('project_id = ?');
      params.push(query.projectId);
    }
    if (query.status) {
      clauses.push('status = ?');
      params.push(query.status);
    }
    if (!query.includeDeleted) clauses.push('deleted_at IS NULL');
    const limit = Math.min(500, Math.max(1, Math.floor(query.limit ?? 100)));
    params.push(limit);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM execution_environments ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params) as EnvironmentRow[];
    return rows.map(environmentFromRow);
  }

  transition(input: TransitionExecutionEnvironmentInput): ExecutionEnvironment {
    const reason = requiredText(input.reason, 'reason');
    const now = Date.now();
    runSqliteWriteTransaction((db) => {
      const row = getEnvironmentRow(input.environmentId);
      if (!row) throw new ExecutionEnvironmentNotFoundError(input.environmentId);
      if (row.version !== input.expectedVersion) {
        throw new ExecutionEnvironmentConflictError(
          `Execution environment ${input.environmentId} changed from version ${input.expectedVersion} to ${row.version}`,
        );
      }
      if (!canTransitionExecutionEnvironment(row.status, input.toStatus)) {
        throw new ExecutionEnvironmentConflictError(
          `Cannot transition execution environment ${input.environmentId} from ${row.status} to ${input.toStatus}`,
        );
      }
      const error = optionalText(input.error);
      const lastError = input.toStatus === 'error' || input.toStatus === 'degraded'
        ? error ?? row.last_error
        : null;
      const result = db.prepare(
        `UPDATE execution_environments
         SET status = ?, version = version + 1, updated_at = ?, last_error = ?,
             deleted_at = CASE WHEN ? = 'deleted' THEN ? ELSE deleted_at END
         WHERE environment_id = ? AND version = ?`,
      ).run(
        input.toStatus,
        now,
        lastError,
        input.toStatus,
        now,
        input.environmentId,
        input.expectedVersion,
      );
      if (result.changes !== 1) {
        throw new ExecutionEnvironmentConflictError(`Execution environment ${input.environmentId} changed concurrently`);
      }
      db.prepare(
        `INSERT INTO execution_environment_events (
          event_id, environment_id, from_status, to_status, reason, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        input.environmentId,
        row.status,
        input.toStatus,
        reason,
        JSON.stringify(input.metadata ?? {}),
        now,
      );
    });
    return this.getRequired(input.environmentId);
  }

  bind(input: BindExecutionEnvironmentInput): ExecutionEnvironmentBinding {
    const sessionKey = requiredText(input.sessionKey, 'sessionKey');
    return runSqliteWriteTransaction((db) => {
      const environment = getEnvironmentRow(input.environmentId);
      if (!environment) throw new ExecutionEnvironmentNotFoundError(input.environmentId);
      if (environment.status !== 'ready') {
        throw new ExecutionEnvironmentConflictError(
          `Execution environment ${input.environmentId} is not bindable while ${environment.status}`,
        );
      }
      const active = db.prepare(
        `SELECT * FROM execution_environment_bindings
         WHERE session_key = ? AND released_at IS NULL`,
      ).get(sessionKey) as BindingRow | undefined;
      if (active) {
        if (active.environment_id === input.environmentId) return bindingFromRow(active);
        throw new ExecutionEnvironmentConflictError(
          `Session ${sessionKey} is already bound to ${active.environment_id}`,
        );
      }
      if (environment.kind === 'managed_worktree') {
        const owner = db.prepare(
          `SELECT * FROM execution_environment_bindings
           WHERE environment_id = ? AND released_at IS NULL LIMIT 1`,
        ).get(input.environmentId) as BindingRow | undefined;
        if (owner) {
          throw new ExecutionEnvironmentConflictError(
            `Managed worktree ${input.environmentId} is already bound to session ${owner.session_key}`,
          );
        }
      }
      const binding: ExecutionEnvironmentBinding = {
        id: randomUUID(),
        sessionKey,
        environmentId: input.environmentId,
        createdAt: Date.now(),
      };
      db.prepare(
        `INSERT INTO execution_environment_bindings (
          binding_id, session_key, environment_id, created_at
        ) VALUES (?, ?, ?, ?)`,
      ).run(
        binding.id,
        binding.sessionKey,
        binding.environmentId,
        binding.createdAt,
      );
      db.prepare(
        `UPDATE execution_environments SET last_used_at = ?, updated_at = ? WHERE environment_id = ?`,
      ).run(binding.createdAt, binding.createdAt, binding.environmentId);
      return binding;
    });
  }

  resolveBinding(
    sessionKey: string,
  ): ExecutionEnvironmentBinding | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT * FROM execution_environment_bindings
       WHERE session_key = ? AND released_at IS NULL`,
    ).get(sessionKey) as BindingRow | undefined;
    return row ? bindingFromRow(row) : undefined;
  }

  listBindings(environmentId: string, includeReleased = false): ExecutionEnvironmentBinding[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT * FROM execution_environment_bindings
       WHERE environment_id = ? ${includeReleased ? '' : 'AND released_at IS NULL'}
       ORDER BY created_at, rowid`,
    ).all(environmentId) as BindingRow[];
    return rows.map(bindingFromRow);
  }

  releaseBinding(
    sessionKey: string,
    expectedEnvironmentId?: string,
  ): ExecutionEnvironmentBinding | undefined {
    return runSqliteWriteTransaction((db) => {
      const active = db.prepare(
        `SELECT * FROM execution_environment_bindings
         WHERE session_key = ? AND released_at IS NULL`,
      ).get(sessionKey) as BindingRow | undefined;
      if (!active) return undefined;
      if (expectedEnvironmentId && active.environment_id !== expectedEnvironmentId) {
        throw new ExecutionEnvironmentConflictError(
          `Session ${sessionKey} is bound to ${active.environment_id}, not ${expectedEnvironmentId}`,
        );
      }
      const releasedAt = Date.now();
      db.prepare(
        `UPDATE execution_environment_bindings SET released_at = ? WHERE binding_id = ? AND released_at IS NULL`,
      ).run(releasedAt, active.binding_id);
      return bindingFromRow({ ...active, released_at: releasedAt });
    });
  }

  listEvents(environmentId: string): ExecutionEnvironmentEvent[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT * FROM execution_environment_events WHERE environment_id = ? ORDER BY created_at, rowid`,
    ).all(environmentId) as EventRow[];
    return rows.map(eventFromRow);
  }
}

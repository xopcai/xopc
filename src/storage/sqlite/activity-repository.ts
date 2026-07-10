import { randomUUID } from 'node:crypto';

import type {
  ActivityEvent,
  ActivityEventWithRelations,
  ActivityListResult,
  ActivityObjectRef,
  ActivityRelatedProject,
  ActivityScope,
  ActivitySource,
  ActivityPrincipal,
  CreateObjectLinkInput,
  ListActivityOptions,
  ListObjectActivityOptions,
  ListProjectActivityOptions,
  ObjectLink,
  RecordActivityInput,
} from '../../activity/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type ActivityEventRow = {
  id: string;
  type: string;
  primary_object_kind: string;
  primary_object_id: string;
  primary_object_title: string | null;
  actor_json: string;
  initiator_json: string | null;
  source_json: string;
  payload_json: string;
  visibility: string;
  importance: string;
  created_at: number;
};

type ActivityScopeRow = {
  activity_id: string;
  scope_kind: string;
  scope_id: string;
  reason: string;
};

type ActivityRelatedProjectRow = {
  activity_id: string;
  project_id: string;
  reason: string;
  confidence: number;
  computed_at: number;
};

type ObjectLinkRow = {
  id: string;
  from_kind: string;
  from_id: string;
  from_title: string | null;
  to_kind: string;
  to_id: string;
  to_title: string | null;
  relation: string;
  source: string;
  created_at: number;
};

type CountRow = { count: number };
type SqlParam = string | number | bigint | null;

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function eventFromRow(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    type: row.type,
    primaryObject: {
      kind: row.primary_object_kind as ActivityObjectRef['kind'],
      id: row.primary_object_id,
      title: row.primary_object_title ?? undefined,
    },
    actor: parseJson<ActivityPrincipal>(row.actor_json, { kind: 'system' }),
    initiator: row.initiator_json ? parseJson<ActivityPrincipal | undefined>(row.initiator_json, undefined) : undefined,
    source: parseJson<ActivitySource>(row.source_json, { kind: 'system' }),
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    visibility: row.visibility as ActivityEvent['visibility'],
    importance: row.importance as ActivityEvent['importance'],
    createdAt: row.created_at,
  };
}

function scopeFromRow(row: ActivityScopeRow): ActivityScope {
  return {
    activityId: row.activity_id,
    scopeKind: row.scope_kind as ActivityScope['scopeKind'],
    scopeId: row.scope_id,
    reason: row.reason as ActivityScope['reason'],
  };
}

function relatedProjectFromRow(row: ActivityRelatedProjectRow): ActivityRelatedProject {
  return {
    activityId: row.activity_id,
    projectId: row.project_id,
    reason: row.reason as ActivityRelatedProject['reason'],
    confidence: row.confidence,
    computedAt: row.computed_at,
  };
}

function objectLinkFromRow(row: ObjectLinkRow): ObjectLink {
  return {
    id: row.id,
    from: {
      kind: row.from_kind as ActivityObjectRef['kind'],
      id: row.from_id,
      title: row.from_title ?? undefined,
    },
    to: {
      kind: row.to_kind as ActivityObjectRef['kind'],
      id: row.to_id,
      title: row.to_title ?? undefined,
    },
    relation: row.relation as ObjectLink['relation'],
    source: row.source as ObjectLink['source'],
    createdAt: row.created_at,
  };
}

function listScopesForActivity(activityId: string): ActivityScope[] {
  return getSqliteDatabase()
    .prepare(
      `SELECT activity_id, scope_kind, scope_id, reason
       FROM activity_scopes
       WHERE activity_id = ?
       ORDER BY scope_kind ASC, scope_id ASC, reason ASC`,
    )
    .all(activityId)
    .map((row) => scopeFromRow(row as ActivityScopeRow));
}

function listRelatedProjectsForActivity(activityId: string): ActivityRelatedProject[] {
  return getSqliteDatabase()
    .prepare(
      `SELECT activity_id, project_id, reason, confidence, computed_at
       FROM activity_related_projects
       WHERE activity_id = ?
       ORDER BY project_id ASC, reason ASC`,
    )
    .all(activityId)
    .map((row) => relatedProjectFromRow(row as ActivityRelatedProjectRow));
}

function eventWithRelations(row: ActivityEventRow): ActivityEventWithRelations {
  const event = eventFromRow(row);
  return {
    ...event,
    scopes: listScopesForActivity(event.id),
    relatedProjects: listRelatedProjectsForActivity(event.id),
  };
}

function normalizeLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(100, Math.floor(limit ?? 50)));
}

function normalizeOffset(offset: number | undefined): number {
  return Math.max(0, Math.floor(offset ?? 0));
}

function visibilityClause(visibility: string | undefined, params: SqlParam[]): string {
  if (!visibility) return '';
  params.push(visibility);
  return 'WHERE visibility = ?';
}

function listResult(rows: ActivityEventRow[], total: number, limit: number, offset: number): ActivityListResult {
  return {
    items: rows.map(eventWithRelations),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
  };
}

export function recordActivityEvent(input: RecordActivityInput): ActivityEventWithRelations {
  const id = input.id ?? randomUUID();
  const now = input.nowMs ?? Date.now();
  const visibility = input.visibility ?? 'timeline';
  const importance = input.importance ?? 'normal';
  const payload = input.payload ?? {};

  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO activity_events (
        id, type, primary_object_kind, primary_object_id, primary_object_title,
        actor_json, initiator_json, source_json, payload_json,
        visibility, importance, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.type,
      input.primaryObject.kind,
      input.primaryObject.id,
      input.primaryObject.title ?? null,
      JSON.stringify(input.actor),
      input.initiator ? JSON.stringify(input.initiator) : null,
      JSON.stringify(input.source),
      JSON.stringify(payload),
      visibility,
      importance,
      now,
    );

    for (const scope of input.scopes ?? []) {
      db.prepare(
        `INSERT OR IGNORE INTO activity_scopes (activity_id, scope_kind, scope_id, reason)
         VALUES (?, ?, ?, ?)`,
      ).run(id, scope.scopeKind, scope.scopeId, scope.reason);
    }

    for (const related of input.relatedProjects ?? []) {
      db.prepare(
        `INSERT OR REPLACE INTO activity_related_projects (
          activity_id, project_id, reason, confidence, computed_at
        ) VALUES (?, ?, ?, ?, ?)`,
      ).run(id, related.projectId, related.reason, related.confidence, related.computedAt ?? now);
    }
  });

  const event = getActivityEventRecord(id);
  if (!event) {
    throw new Error(`Activity event was not persisted: ${id}`);
  }
  return event;
}

export function getActivityEventRecord(id: string): ActivityEventWithRelations | null {
  const row = getSqliteDatabase()
    .prepare(
      `SELECT *
       FROM activity_events
       WHERE id = ?`,
    )
    .get(id) as ActivityEventRow | undefined;
  return row ? eventWithRelations(row) : null;
}

export function listActivityRecords(options: ListActivityOptions = {}): ActivityListResult {
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const params: SqlParam[] = [];
  const where = visibilityClause(options.visibility, params);
  const total = (getSqliteDatabase()
    .prepare(`SELECT COUNT(*) AS count FROM activity_events ${where}`)
    .get(...params) as CountRow).count;
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT *
       FROM activity_events
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
    .map((row) => row as ActivityEventRow);
  return listResult(rows, total, limit, offset);
}

export function listObjectActivityRecords(options: ListObjectActivityOptions): ActivityListResult {
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const params: SqlParam[] = [options.object.kind, options.object.id];
  const visibility = options.visibility ? 'AND visibility = ?' : '';
  if (options.visibility) params.push(options.visibility);
  const total = (getSqliteDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM activity_events
       WHERE primary_object_kind = ? AND primary_object_id = ?
       ${visibility}`,
    )
    .get(...params) as CountRow).count;
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT *
       FROM activity_events
       WHERE primary_object_kind = ? AND primary_object_id = ?
       ${visibility}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
    .map((row) => row as ActivityEventRow);
  return listResult(rows, total, limit, offset);
}

export function listProjectActivityRecords(options: ListProjectActivityOptions): ActivityListResult {
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const params: SqlParam[] = ['project', options.projectId];
  const relatedClause = options.includeRelated
    ? `OR EXISTS (
        SELECT 1 FROM activity_related_projects ar
        WHERE ar.activity_id = ae.id AND ar.project_id = ?
      )`
    : '';
  if (options.includeRelated) params.push(options.projectId);
  const visibilityClauseSql = options.visibility ? 'AND ae.visibility = ?' : '';
  if (options.visibility) params.push(options.visibility);

  const baseWhere = `EXISTS (
      SELECT 1 FROM activity_scopes s
      WHERE s.activity_id = ae.id AND s.scope_kind = ? AND s.scope_id = ?
    ) ${relatedClause}`;

  const total = (getSqliteDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM activity_events ae
       WHERE (${baseWhere})
       ${visibilityClauseSql}`,
    )
    .get(...params) as CountRow).count;
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT ae.*
       FROM activity_events ae
       WHERE (${baseWhere})
       ${visibilityClauseSql}
       ORDER BY ae.created_at DESC, ae.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
    .map((row) => row as ActivityEventRow);
  return listResult(rows, total, limit, offset);
}

export function createObjectLinkRecord(input: CreateObjectLinkInput): ObjectLink {
  const id = input.id ?? randomUUID();
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO object_links (
        id, from_kind, from_id, from_title, to_kind, to_id, to_title, relation, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.from.kind,
      input.from.id,
      input.from.title ?? null,
      input.to.kind,
      input.to.id,
      input.to.title ?? null,
      input.relation,
      input.source,
      now,
    );
  });
  const row = getSqliteDatabase()
    .prepare(`SELECT * FROM object_links WHERE id = ?`)
    .get(id) as ObjectLinkRow | undefined;
  if (!row) {
    throw new Error(`Object link was not persisted: ${id}`);
  }
  return objectLinkFromRow(row);
}

export function listObjectLinkRecords(object: ActivityObjectRef): ObjectLink[] {
  return getSqliteDatabase()
    .prepare(
      `SELECT *
       FROM object_links
       WHERE (from_kind = ? AND from_id = ?) OR (to_kind = ? AND to_id = ?)
       ORDER BY created_at DESC, id DESC`,
    )
    .all(object.kind, object.id, object.kind, object.id)
    .map((row) => objectLinkFromRow(row as ObjectLinkRow));
}

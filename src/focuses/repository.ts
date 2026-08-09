import { randomUUID } from 'node:crypto';

import type { DatabaseSync } from 'node:sqlite';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type {
  Focus,
  FocusActivity,
  FocusActivityType,
  FocusCadence,
  FocusMonitor,
  FocusMonitorKind,
  FocusMonitorRunState,
  FocusSource,
  FocusStatus,
} from './types.js';

interface FocusRow {
  focus_id: string;
  title: string;
  summary: string;
  status: FocusStatus;
  source: FocusSource;
  source_candidate_id: string | null;
  goal_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  last_activity_at: number | null;
}

interface FocusMonitorRow {
  monitor_id: string;
  focus_id: string;
  kind: FocusMonitorKind;
  enabled: number;
  run_state: FocusMonitorRunState;
  cadence_json: string;
  automation_id: string | null;
  last_run_id: string | null;
  last_run_at: number | null;
  next_run_at: number | null;
  last_meaningful_result_at: number | null;
  last_error: string | null;
  consecutive_failures: number;
  created_at: number;
  updated_at: number;
}

interface FocusActivityRow {
  activity_id: string;
  focus_id: string;
  monitor_id: string | null;
  type: FocusActivityType;
  summary: string;
  details_json: string;
  created_at: number;
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseCadence(value: string): FocusCadence {
  const parsed = parseObject(value);
  return {
    kind: 'interval',
    everyMs: typeof parsed.everyMs === 'number' && parsed.everyMs > 0
      ? parsed.everyMs
      : 86_400_000,
  };
}

function projectIdsForFocus(db: DatabaseSync, focusId: string): string[] {
  const rows = db.prepare(
    'SELECT project_id FROM focus_projects WHERE focus_id = ? ORDER BY created_at, project_id',
  ).all(focusId) as unknown as Array<{ project_id: string }>;
  return rows.map((row) => row.project_id);
}

function focusFromRow(db: DatabaseSync, row: FocusRow): Focus {
  return {
    id: row.focus_id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    source: row.source,
    ...(row.source_candidate_id ? { sourceCandidateId: row.source_candidate_id } : {}),
    projectIds: projectIdsForFocus(db, row.focus_id),
    ...(row.goal_id ? { goalId: row.goal_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at != null ? { completedAt: row.completed_at } : {}),
    ...(row.last_activity_at != null ? { lastActivityAt: row.last_activity_at } : {}),
  };
}

function monitorFromRow(row: FocusMonitorRow): FocusMonitor {
  return {
    id: row.monitor_id,
    focusId: row.focus_id,
    kind: row.kind,
    enabled: row.enabled === 1,
    runState: row.run_state,
    cadence: parseCadence(row.cadence_json),
    ...(row.automation_id ? { automationId: row.automation_id } : {}),
    ...(row.last_run_id ? { lastRunId: row.last_run_id } : {}),
    ...(row.last_run_at != null ? { lastRunAt: row.last_run_at } : {}),
    ...(row.next_run_at != null ? { nextRunAt: row.next_run_at } : {}),
    ...(row.last_meaningful_result_at != null ? { lastMeaningfulResultAt: row.last_meaningful_result_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function activityFromRow(row: FocusActivityRow): FocusActivity {
  return {
    id: row.activity_id,
    focusId: row.focus_id,
    ...(row.monitor_id ? { monitorId: row.monitor_id } : {}),
    type: row.type,
    summary: row.summary,
    details: parseObject(row.details_json),
    createdAt: row.created_at,
  };
}

export function getFocus(id: string): Focus | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM focuses WHERE focus_id = ?').get(id) as unknown as FocusRow | undefined;
  return row ? focusFromRow(db, row) : null;
}

export function listFocuses(options: { statuses?: FocusStatus[]; limit?: number } = {}): Focus[] {
  const statuses = options.statuses ?? ['active', 'paused'];
  if (statuses.length === 0) return [];
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const { db } = requireXopcDatabase();
  const rows = db.prepare(
    `SELECT * FROM focuses WHERE status IN (${statuses.map(() => '?').join(', ')})
     ORDER BY COALESCE(last_activity_at, updated_at) DESC LIMIT ?`,
  ).all(...statuses, limit) as unknown as FocusRow[];
  return rows.map((row) => focusFromRow(db, row));
}

export function createFocus(input: {
  title: string;
  summary: string;
  source?: FocusSource;
  sourceCandidateId?: string;
  projectIds?: string[];
  goalId?: string;
  nowMs?: number;
}): Focus {
  const id = randomUUID();
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO focuses (
        focus_id, title, summary, status, source, source_candidate_id, goal_id,
        created_at, updated_at, last_activity_at
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.title.trim().slice(0, 200),
      input.summary.trim().slice(0, 2_000),
      input.source ?? 'user',
      input.sourceCandidateId ?? null,
      input.goalId ?? null,
      now,
      now,
      now,
    );
    const insertProject = db.prepare(
      'INSERT INTO focus_projects (focus_id, project_id, created_at) VALUES (?, ?, ?)',
    );
    for (const projectId of [...new Set(input.projectIds ?? [])].slice(0, 20)) {
      insertProject.run(id, projectId, now);
    }
    insertFocusActivity(db, {
      focusId: id,
      type: 'created',
      summary: 'Focus created',
      nowMs: now,
    });
  });
  return getFocus(id)!;
}

export function updateFocus(input: {
  id: string;
  title?: string;
  summary?: string;
  status?: FocusStatus;
  projectIds?: string[];
  nowMs?: number;
}): Focus | null {
  const current = getFocus(input.id);
  if (!current) return null;
  const now = input.nowMs ?? Date.now();
  const status = input.status ?? current.status;
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE focuses SET title = ?, summary = ?, status = ?, completed_at = ?, updated_at = ?
       WHERE focus_id = ?`,
    ).run(
      input.title?.trim().slice(0, 200) || current.title,
      input.summary?.trim().slice(0, 2_000) || current.summary,
      status,
      status === 'completed' ? current.completedAt ?? now : null,
      now,
      input.id,
    );
    if (input.projectIds) {
      db.prepare('DELETE FROM focus_projects WHERE focus_id = ?').run(input.id);
      const insertProject = db.prepare(
        'INSERT INTO focus_projects (focus_id, project_id, created_at) VALUES (?, ?, ?)',
      );
      for (const projectId of [...new Set(input.projectIds)].slice(0, 20)) {
        insertProject.run(input.id, projectId, now);
      }
    }
  });
  return getFocus(input.id);
}

export function deleteFocus(id: string): boolean {
  let deleted = false;
  runSqliteWriteTransaction((db) => {
    deleted = db.prepare('DELETE FROM focuses WHERE focus_id = ?').run(id).changes > 0;
  });
  return deleted;
}

export function getFocusMonitor(focusId: string, kind: FocusMonitorKind): FocusMonitor | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM focus_monitors WHERE focus_id = ? AND kind = ?')
    .get(focusId, kind) as unknown as FocusMonitorRow | undefined;
  return row ? monitorFromRow(row) : null;
}

export function getFocusMonitorByAutomationId(automationId: string): FocusMonitor | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM focus_monitors WHERE automation_id = ?')
    .get(automationId) as unknown as FocusMonitorRow | undefined;
  return row ? monitorFromRow(row) : null;
}

export function listFocusMonitors(focusId: string): FocusMonitor[] {
  const { db } = requireXopcDatabase();
  const rows = db.prepare('SELECT * FROM focus_monitors WHERE focus_id = ? ORDER BY kind')
    .all(focusId) as unknown as FocusMonitorRow[];
  return rows.map(monitorFromRow);
}

export function listAllFocusMonitors(): FocusMonitor[] {
  const { db } = requireXopcDatabase();
  const rows = db.prepare('SELECT * FROM focus_monitors ORDER BY updated_at DESC')
    .all() as unknown as FocusMonitorRow[];
  return rows.map(monitorFromRow);
}

export function upsertFocusMonitor(input: {
  focusId: string;
  kind: FocusMonitorKind;
  enabled: boolean;
  runState?: FocusMonitorRunState;
  cadence: FocusCadence;
  automationId?: string | null;
  nowMs?: number;
}): FocusMonitor {
  const existing = getFocusMonitor(input.focusId, input.kind);
  const id = existing?.id ?? randomUUID();
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO focus_monitors (
        monitor_id, focus_id, kind, enabled, run_state, cadence_json, automation_id,
        consecutive_failures, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(focus_id, kind) DO UPDATE SET
        enabled = excluded.enabled,
        run_state = excluded.run_state,
        cadence_json = excluded.cadence_json,
        automation_id = excluded.automation_id,
        last_error = CASE WHEN excluded.enabled = 1 THEN NULL ELSE focus_monitors.last_error END,
        updated_at = excluded.updated_at`,
    ).run(
      id,
      input.focusId,
      input.kind,
      input.enabled ? 1 : 0,
      input.runState ?? 'idle',
      JSON.stringify(input.cadence),
      input.automationId === undefined ? existing?.automationId ?? null : input.automationId,
      existing?.createdAt ?? now,
      now,
    );
  });
  return getFocusMonitor(input.focusId, input.kind)!;
}

export function updateFocusMonitorRuntime(input: {
  id: string;
  runState: FocusMonitorRunState;
  automationId?: string | null;
  lastRunId?: string;
  lastRunAt?: number;
  nextRunAt?: number | null;
  meaningful?: boolean;
  error?: string | null;
  nowMs?: number;
}): FocusMonitor | null {
  const now = input.nowMs ?? Date.now();
  let changed = false;
  runSqliteWriteTransaction((db) => {
    changed = db.prepare(
      `UPDATE focus_monitors SET
        run_state = ?,
        automation_id = COALESCE(?, automation_id),
        last_run_id = COALESCE(?, last_run_id),
        last_run_at = COALESCE(?, last_run_at),
        next_run_at = CASE WHEN ? = 1 THEN ? ELSE next_run_at END,
        last_meaningful_result_at = CASE WHEN ? = 1 THEN ? ELSE last_meaningful_result_at END,
        last_error = ?,
        consecutive_failures = CASE WHEN ? IS NOT NULL THEN consecutive_failures + 1 ELSE 0 END,
        updated_at = ?
       WHERE monitor_id = ?`,
    ).run(
      input.runState,
      input.automationId ?? null,
      input.lastRunId ?? null,
      input.lastRunAt ?? null,
      input.nextRunAt === undefined ? 0 : 1,
      input.nextRunAt ?? null,
      input.meaningful ? 1 : 0,
      now,
      input.error ?? null,
      input.error ?? null,
      now,
      input.id,
    ).changes > 0;
  });
  if (!changed) return null;
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM focus_monitors WHERE monitor_id = ?')
    .get(input.id) as unknown as FocusMonitorRow;
  return monitorFromRow(row);
}

function insertFocusActivity(db: DatabaseSync, input: {
  focusId: string;
  monitorId?: string;
  type: FocusActivityType;
  summary: string;
  details?: Record<string, unknown>;
  nowMs: number;
}): FocusActivity {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO focus_activities (
      activity_id, focus_id, monitor_id, type, summary, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.focusId,
    input.monitorId ?? null,
    input.type,
    input.summary.slice(0, 500),
    JSON.stringify(input.details ?? {}),
    input.nowMs,
  );
  db.prepare('UPDATE focuses SET last_activity_at = ?, updated_at = MAX(updated_at, ?) WHERE focus_id = ?')
    .run(input.nowMs, input.nowMs, input.focusId);
  return {
    id,
    focusId: input.focusId,
    ...(input.monitorId ? { monitorId: input.monitorId } : {}),
    type: input.type,
    summary: input.summary.slice(0, 500),
    details: input.details ?? {},
    createdAt: input.nowMs,
  };
}

export function createFocusActivity(input: {
  focusId: string;
  monitorId?: string;
  type: FocusActivityType;
  summary: string;
  details?: Record<string, unknown>;
  nowMs?: number;
}): FocusActivity {
  let activity!: FocusActivity;
  runSqliteWriteTransaction((db) => {
    activity = insertFocusActivity(db, { ...input, nowMs: input.nowMs ?? Date.now() });
  });
  return activity;
}

export function listFocusActivities(input: {
  focusId: string;
  before?: number;
  limit?: number;
}): FocusActivity[] {
  const limit = Math.max(1, Math.min(100, input.limit ?? 30));
  const { db } = requireXopcDatabase();
  const rows = db.prepare(
    `SELECT * FROM focus_activities WHERE focus_id = ? AND created_at < ?
     ORDER BY created_at DESC, activity_id DESC LIMIT ?`,
  ).all(input.focusId, input.before ?? Number.MAX_SAFE_INTEGER, limit) as unknown as FocusActivityRow[];
  return rows.map(activityFromRow);
}

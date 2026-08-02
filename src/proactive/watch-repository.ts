import { randomUUID } from 'node:crypto';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type { FocusWatch, FocusWatchKind, FocusWatchStatus } from './types.js';

interface FocusWatchRow {
  watch_id: string;
  thread_id: string;
  goal_id: string | null;
  automation_id: string;
  kind: FocusWatchKind;
  status: FocusWatchStatus;
  config_json: string;
  trial_ends_at: number | null;
  last_cursor: string | null;
  last_run_at: number | null;
  last_useful_result_at: number | null;
  consecutive_empty_runs: number;
  created_at: number;
  updated_at: number;
}

function watchFromRow(row: FocusWatchRow): FocusWatch {
  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.config_json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
  } catch {
    config = {};
  }
  return {
    id: row.watch_id,
    threadId: row.thread_id,
    ...(row.goal_id ? { goalId: row.goal_id } : {}),
    automationId: row.automation_id,
    kind: row.kind,
    status: row.status,
    config,
    ...(row.trial_ends_at != null ? { trialEndsAt: row.trial_ends_at } : {}),
    ...(row.last_cursor ? { lastCursor: row.last_cursor } : {}),
    ...(row.last_run_at != null ? { lastRunAt: row.last_run_at } : {}),
    ...(row.last_useful_result_at != null ? { lastUsefulResultAt: row.last_useful_result_at } : {}),
    consecutiveEmptyRuns: row.consecutive_empty_runs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listFocusWatches(options: { threadId?: string; status?: FocusWatchStatus } = {}): FocusWatch[] {
  const clauses: string[] = [];
  const values: string[] = [];
  if (options.threadId) {
    clauses.push('thread_id = ?');
    values.push(options.threadId);
  }
  if (options.status) {
    clauses.push('status = ?');
    values.push(options.status);
  }
  const { db } = requireXopcDatabase();
  const rows = db.prepare(
    `SELECT * FROM focus_watches ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY updated_at DESC`,
  ).all(...values) as unknown as FocusWatchRow[];
  return rows.map(watchFromRow);
}

export function getFocusWatchByThreadAndKind(threadId: string, kind: FocusWatchKind): FocusWatch | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM focus_watches WHERE thread_id = ? AND kind = ?')
    .get(threadId, kind) as unknown as FocusWatchRow | undefined;
  return row ? watchFromRow(row) : null;
}

export function getFocusWatchByAutomationId(automationId: string): FocusWatch | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM focus_watches WHERE automation_id = ?')
    .get(automationId) as unknown as FocusWatchRow | undefined;
  return row ? watchFromRow(row) : null;
}

export function createFocusWatch(input: {
  threadId: string;
  goalId?: string;
  automationId: string;
  kind: FocusWatchKind;
  config?: Record<string, unknown>;
  trialEndsAt?: number;
  nowMs?: number;
}): FocusWatch {
  const now = input.nowMs ?? Date.now();
  const id = randomUUID();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO focus_watches (
        watch_id, thread_id, goal_id, automation_id, kind, status, config_json,
        trial_ends_at, consecutive_empty_runs, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 0, ?, ?)`,
    ).run(
      id,
      input.threadId,
      input.goalId ?? null,
      input.automationId,
      input.kind,
      JSON.stringify(input.config ?? {}),
      input.trialEndsAt ?? null,
      now,
      now,
    );
  });
  return getFocusWatchByThreadAndKind(input.threadId, input.kind)!;
}

export function setFocusWatchStatus(id: string, status: FocusWatchStatus, nowMs = Date.now()): FocusWatch | null {
  let changed = false;
  runSqliteWriteTransaction((db) => {
    changed = db.prepare('UPDATE focus_watches SET status = ?, updated_at = ? WHERE watch_id = ?')
      .run(status, nowMs, id).changes > 0;
  });
  if (!changed) return null;
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM focus_watches WHERE watch_id = ?')
    .get(id) as unknown as FocusWatchRow;
  return watchFromRow(row);
}

export function restartFocusWatchTrial(id: string, trialEndsAt: number, nowMs = Date.now()): FocusWatch | null {
  let changed = false;
  runSqliteWriteTransaction((db) => {
    changed = db.prepare(
      `UPDATE focus_watches
       SET status = 'active', trial_ends_at = ?, consecutive_empty_runs = 0, updated_at = ?
       WHERE watch_id = ?`,
    ).run(trialEndsAt, nowMs, id).changes > 0;
  });
  if (!changed) return null;
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM focus_watches WHERE watch_id = ?')
    .get(id) as unknown as FocusWatchRow;
  return watchFromRow(row);
}

export function recordFocusWatchRun(input: {
  id: string;
  runId: string;
  outcome: 'meaningful' | 'empty' | 'failed';
  nowMs?: number;
}): FocusWatch | null {
  const now = input.nowMs ?? Date.now();
  let changed = false;
  runSqliteWriteTransaction((db) => {
    changed = db.prepare(
      `UPDATE focus_watches SET
        last_cursor = ?,
        last_run_at = ?,
        last_useful_result_at = CASE WHEN ? = 'meaningful' THEN ? ELSE last_useful_result_at END,
        consecutive_empty_runs = CASE
          WHEN ? = 'meaningful' THEN 0
          WHEN ? = 'empty' THEN consecutive_empty_runs + 1
          ELSE consecutive_empty_runs
        END,
        updated_at = ?
       WHERE watch_id = ? AND (last_cursor IS NULL OR last_cursor <> ?)`,
    ).run(input.runId, now, input.outcome, now, input.outcome, input.outcome, now, input.id, input.runId).changes > 0;
  });
  if (!changed) return null;
  return listFocusWatches().find((watch) => watch.id === input.id) ?? null;
}

export function recordFocusWatchFeedback(
  id: string,
  useful: boolean,
  nowMs = Date.now(),
): { watch: FocusWatch; consecutiveDismissed: number } | null {
  const watch = listFocusWatches().find((item) => item.id === id);
  if (!watch) return null;
  const previous = watch.config.feedback && typeof watch.config.feedback === 'object' && !Array.isArray(watch.config.feedback)
    ? watch.config.feedback as Record<string, unknown>
    : {};
  const approved = typeof previous.approved === 'number' ? previous.approved : 0;
  const dismissed = typeof previous.dismissed === 'number' ? previous.dismissed : 0;
  const consecutiveDismissed = useful
    ? 0
    : (typeof previous.consecutiveDismissed === 'number' ? previous.consecutiveDismissed : 0) + 1;
  const config = {
    ...watch.config,
    feedback: {
      approved: approved + (useful ? 1 : 0),
      dismissed: dismissed + (useful ? 0 : 1),
      consecutiveDismissed,
    },
  };
  runSqliteWriteTransaction((db) => {
    db.prepare('UPDATE focus_watches SET config_json = ?, updated_at = ? WHERE watch_id = ?')
      .run(JSON.stringify(config), nowMs, id);
  });
  const updated = listFocusWatches().find((item) => item.id === id)!;
  return { watch: updated, consecutiveDismissed };
}

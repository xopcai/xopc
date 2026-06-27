import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type { GoalQueueItemSnapshot, GoalQueueStatus } from './goal-queue-types.js';
import type { UserTurnInput } from '../gateway/user-turn-input.js';

type GoalQueueRow = {
  queue_id: string;
  goal_id: string;
  status: GoalQueueStatus;
  payload_json: string;
  attempts: number;
  max_retries: number;
  enqueued_at: number;
  started_at: number | null;
  finished_at: number | null;
  next_run_at: number | null;
  session_key: string | null;
  last_error: string | null;
  source: GoalQueueItemSnapshot['source'];
};

type GoalQueuePayload = {
  userTurn?: UserTurnInput;
};

function parsePayload(raw: string): GoalQueuePayload {
  try {
    const parsed = JSON.parse(raw) as GoalQueuePayload;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function rowToSnapshot(row: GoalQueueRow): GoalQueueItemSnapshot {
  const payload = parsePayload(row.payload_json);
  return {
    id: row.queue_id,
    goalId: row.goal_id,
    status: row.status,
    attempts: row.attempts,
    maxRetries: row.max_retries,
    enqueuedAt: row.enqueued_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    sessionKey: row.session_key ?? undefined,
    userTurn: payload.userTurn,
    lastError: row.last_error ?? undefined,
    source: row.source,
  };
}

export class GoalQueueStore {
  enqueue(input: {
    goalId: string;
    userTurn?: UserTurnInput;
    maxRetries: number;
    source: GoalQueueItemSnapshot['source'];
  }): GoalQueueItemSnapshot {
    return runSqliteWriteTransaction((db) => {
      const existing = db
        .prepare(
          `SELECT * FROM goal_queue
           WHERE goal_id = ?
             AND status IN ('queued', 'running', 'retry_waiting')
           ORDER BY enqueued_at DESC
           LIMIT 1`,
        )
        .get(input.goalId) as GoalQueueRow | undefined;
      if (existing) return rowToSnapshot(existing);

      const now = Date.now();
      const row: GoalQueueRow = {
        queue_id: randomUUID(),
        goal_id: input.goalId,
        status: 'queued',
        payload_json: JSON.stringify({ userTurn: input.userTurn }),
        attempts: 0,
        max_retries: input.maxRetries,
        enqueued_at: now,
        started_at: null,
        finished_at: null,
        next_run_at: null,
        session_key: null,
        last_error: null,
        source: input.source,
      };
      db.prepare(
        `INSERT INTO goal_queue (
          queue_id, goal_id, status, payload_json, attempts, max_retries,
          enqueued_at, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.queue_id,
        row.goal_id,
        row.status,
        row.payload_json,
        row.attempts,
        row.max_retries,
        row.enqueued_at,
        row.source,
      );
      return rowToSnapshot(row);
    });
  }

  claimNext(now = Date.now()): GoalQueueItemSnapshot | null {
    return runSqliteWriteTransaction((db) => {
      const row = db
        .prepare(
          `SELECT * FROM goal_queue
           WHERE status = 'queued'
              OR (status = 'retry_waiting' AND COALESCE(next_run_at, 0) <= ?)
           ORDER BY enqueued_at ASC
           LIMIT 1`,
        )
        .get(now) as GoalQueueRow | undefined;
      if (!row) return null;

      const startedAt = Date.now();
      db.prepare(
        `UPDATE goal_queue
         SET status = 'running',
             started_at = ?,
             attempts = attempts + 1,
             last_error = NULL
         WHERE queue_id = ?`,
      ).run(startedAt, row.queue_id);

      const next = db
        .prepare(`SELECT * FROM goal_queue WHERE queue_id = ?`)
        .get(row.queue_id) as GoalQueueRow;
      return rowToSnapshot(next);
    });
  }

  markRetry(itemId: string, error: string, nextRunAt: number): GoalQueueItemSnapshot | null {
    return this.update(itemId, {
      status: 'retry_waiting',
      next_run_at: nextRunAt,
      last_error: error,
      finished_at: null,
    });
  }

  markFinished(itemId: string, status: GoalQueueStatus, error?: string): GoalQueueItemSnapshot | null {
    return this.update(itemId, {
      status,
      finished_at: Date.now(),
      last_error: error ?? null,
    });
  }

  setSessionKey(itemId: string, sessionKey: string): GoalQueueItemSnapshot | null {
    return this.update(itemId, { session_key: sessionKey });
  }

  list(limit = 200): GoalQueueItemSnapshot[] {
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM goal_queue ORDER BY enqueued_at DESC LIMIT ?`)
      .all(safeLimit) as GoalQueueRow[];
    return rows.map(rowToSnapshot);
  }

  resetRunningToRetry(reason = 'Gateway restarted during goal run'): number {
    return runSqliteWriteTransaction((db) => {
      const result = db
        .prepare(
          `UPDATE goal_queue
           SET status = 'retry_waiting',
               next_run_at = ?,
               last_error = ?
           WHERE status = 'running'`,
        )
        .run(Date.now(), reason);
      return Number(result.changes ?? 0);
    });
  }

  private update(itemId: string, patch: Partial<GoalQueueRow>): GoalQueueItemSnapshot | null {
    return runSqliteWriteTransaction((db) => {
      const row = db
        .prepare(`SELECT * FROM goal_queue WHERE queue_id = ?`)
        .get(itemId) as GoalQueueRow | undefined;
      if (!row) return null;
      const next = { ...row, ...patch };
      db.prepare(
        `UPDATE goal_queue SET
          status = ?, attempts = ?, started_at = ?, finished_at = ?,
          next_run_at = ?, session_key = ?, last_error = ?
         WHERE queue_id = ?`,
      ).run(
        next.status,
        next.attempts,
        next.started_at,
        next.finished_at,
        next.next_run_at,
        next.session_key,
        next.last_error,
        itemId,
      );
      const updated = db
        .prepare(`SELECT * FROM goal_queue WHERE queue_id = ?`)
        .get(itemId) as GoalQueueRow;
      return rowToSnapshot(updated);
    });
  }
}

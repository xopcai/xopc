import type {
  ConfirmedWork,
  WorkExecutionMode,
  WorkIntakeProposal,
} from '@xopcai/gateway-contract';

import {
  getSqliteDatabase,
  runSqliteWriteTransaction,
} from '../storage/sqlite/transaction.js';

type WorkIntakeStatus = 'proposed' | 'confirmed' | 'expired' | 'cancelled';

type WorkIntakeRow = {
  intake_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  objective: string;
  proposal_json: string;
  session_key: string | null;
  agent_id: string | null;
  status: WorkIntakeStatus;
  execution_mode: WorkExecutionMode;
  project_id: string | null;
  outcome_id: string | null;
  queue_id: string | null;
  expires_at: number;
  created_at: number;
  confirmed_at: number | null;
  updated_at: number;
};

export interface StoredWorkIntake {
  idempotencyKey: string;
  requestFingerprint: string;
  proposal: WorkIntakeProposal;
  sessionKey?: string;
  agentId?: string;
  status: WorkIntakeStatus;
  executionMode: WorkExecutionMode;
  projectId?: string;
  outcomeId?: string;
  queueId?: string;
  createdAt: number;
  confirmedAt?: number;
  updatedAt: number;
}

function fromRow(row: WorkIntakeRow): StoredWorkIntake {
  return {
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    proposal: JSON.parse(row.proposal_json) as WorkIntakeProposal,
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    status: row.status,
    executionMode: row.execution_mode,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.outcome_id ? { outcomeId: row.outcome_id } : {}),
    ...(row.queue_id ? { queueId: row.queue_id } : {}),
    createdAt: row.created_at,
    ...(row.confirmed_at === null ? {} : { confirmedAt: row.confirmed_at }),
    updatedAt: row.updated_at,
  };
}

function selectBy(column: 'intake_id' | 'idempotency_key', value: string): StoredWorkIntake | undefined {
  const row = getSqliteDatabase()
    .prepare(`SELECT * FROM work_intakes WHERE ${column} = ?`)
    .get(value) as WorkIntakeRow | undefined;
  return row ? fromRow(row) : undefined;
}

export class WorkIntakeRepository {
  create(input: {
    idempotencyKey: string;
    requestFingerprint: string;
    proposal: WorkIntakeProposal;
    sessionKey?: string;
    agentId?: string;
    now?: number;
  }): StoredWorkIntake {
    const now = input.now ?? Date.now();
    return runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO work_intakes (
          intake_id, idempotency_key, request_fingerprint, objective, proposal_json, session_key, agent_id,
          status, execution_mode, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', 'run_now', ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING`,
      ).run(
        input.proposal.id,
        input.idempotencyKey,
        input.requestFingerprint,
        input.proposal.objective,
        JSON.stringify(input.proposal),
        input.sessionKey ?? null,
        input.agentId ?? null,
        input.proposal.expiresAt,
        now,
        now,
      );
      const stored = selectBy('idempotency_key', input.idempotencyKey);
      if (!stored) throw new Error('Failed to persist work intake');
      return stored;
    });
  }

  get(intakeId: string, now = Date.now()): StoredWorkIntake | undefined {
    const stored = selectBy('intake_id', intakeId);
    if (!stored || stored.status !== 'proposed' || stored.proposal.expiresAt > now) return stored;
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `UPDATE work_intakes SET status = 'expired', updated_at = ?
         WHERE intake_id = ? AND status = 'proposed'`,
      ).run(now, intakeId);
    });
    return selectBy('intake_id', intakeId);
  }

  getByIdempotencyKey(idempotencyKey: string, now = Date.now()): StoredWorkIntake | undefined {
    const stored = selectBy('idempotency_key', idempotencyKey);
    return stored ? this.get(stored.proposal.id, now) : undefined;
  }

  listPendingExecution(limit = 100): StoredWorkIntake[] {
    const rows = getSqliteDatabase()
      .prepare(
        `SELECT * FROM work_intakes
         WHERE status = 'confirmed' AND execution_mode = 'run_now' AND queue_id IS NULL
         ORDER BY confirmed_at ASC
         LIMIT ?`,
      )
      .all(Math.min(500, Math.max(1, Math.floor(limit)))) as WorkIntakeRow[];
    return rows.map(fromRow);
  }

  markConfirmed(input: {
    intakeId: string;
    executionMode: WorkExecutionMode;
    projectId?: string;
    outcomeId: string;
    sessionKey?: string;
    queueId?: string;
    now?: number;
  }): StoredWorkIntake {
    const now = input.now ?? Date.now();
    getSqliteDatabase().prepare(
      `UPDATE work_intakes SET
        status = 'confirmed', execution_mode = ?, project_id = ?,
        outcome_id = ?, session_key = COALESCE(?, session_key), queue_id = ?,
        confirmed_at = COALESCE(confirmed_at, ?), updated_at = ?
       WHERE intake_id = ? AND status = 'proposed'`,
    ).run(
      input.executionMode,
      input.projectId ?? null,
      input.outcomeId,
      input.sessionKey ?? null,
      input.queueId ?? null,
      now,
      now,
      input.intakeId,
    );
    const stored = selectBy('intake_id', input.intakeId);
    if (!stored) throw new Error('Work intake not found');
    return stored;
  }

  setExecution(input: { intakeId: string; sessionKey?: string; queueId: string; now?: number }): StoredWorkIntake {
    const now = input.now ?? Date.now();
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `UPDATE work_intakes SET session_key = COALESCE(?, session_key), queue_id = ?, updated_at = ?
         WHERE intake_id = ? AND status = 'confirmed'`,
      ).run(input.sessionKey ?? null, input.queueId, now, input.intakeId);
    });
    const stored = selectBy('intake_id', input.intakeId);
    if (!stored) throw new Error('Work intake not found');
    return stored;
  }

  toConfirmedWork(stored: StoredWorkIntake): ConfirmedWork | undefined {
    if (
      stored.status !== 'confirmed'
      || !stored.outcomeId
    ) return undefined;
    const queue = stored.queueId
      ? getSqliteDatabase()
        .prepare('SELECT status, session_key FROM outcome_queue WHERE queue_id = ?')
        .get(stored.queueId) as { status: ConfirmedWork['execution']['status']; session_key: string | null } | undefined
      : undefined;
    const sessionKey = queue?.session_key ?? stored.sessionKey;
    return {
      outcomeId: stored.outcomeId,
      ...(stored.projectId ? { projectId: stored.projectId } : {}),
      ...(sessionKey ? { sessionKey } : {}),
      execution: {
        mode: stored.executionMode,
        status: queue?.status ?? (stored.queueId ? 'queued' : 'not_started'),
        ...(stored.queueId ? { queueId: stored.queueId } : {}),
      },
    };
  }
}

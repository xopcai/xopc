import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type ConnectorLearningMode = 'bootstrap' | 'incremental';
export type ConnectorLearningStatus = 'queued' | 'running' | 'completed' | 'failed' | 'paused';
export type ConnectorLearningPhase = 'queued' | 'fetching' | 'indexing' | 'deriving' | 'completed';

export type ConnectorLearningJob = {
  id: string;
  idempotencyKey: string;
  connectorId: string;
  accountId: string;
  connectionId: string;
  sourceInstanceId: string;
  agentId: string;
  mode: ConnectorLearningMode;
  status: ConnectorLearningStatus;
  phase: ConnectorLearningPhase;
  itemsDiscovered: number;
  itemsIndexed: number;
  candidatesCreated: number;
  attemptCount: number;
  error?: string;
  nextRunAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type JobRow = {
  job_id: string;
  idempotency_key: string;
  connector_id: string;
  account_id: string;
  connection_id: string;
  source_instance_id: string;
  agent_id: string;
  mode: ConnectorLearningMode;
  status: ConnectorLearningStatus;
  phase: ConnectorLearningPhase;
  items_discovered: number;
  items_indexed: number;
  candidates_created: number;
  attempt_count: number;
  error: string | null;
  next_run_at: number | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
};

function iso(value: number | null): string | undefined {
  return value == null ? undefined : new Date(value).toISOString();
}

function fromRow(row: JobRow): ConnectorLearningJob {
  return {
    id: row.job_id,
    idempotencyKey: row.idempotency_key,
    connectorId: row.connector_id,
    accountId: row.account_id,
    connectionId: row.connection_id,
    sourceInstanceId: row.source_instance_id,
    agentId: row.agent_id,
    mode: row.mode,
    status: row.status,
    phase: row.phase,
    itemsDiscovered: row.items_discovered,
    itemsIndexed: row.items_indexed,
    candidatesCreated: row.candidates_created,
    attemptCount: row.attempt_count,
    ...(row.error ? { error: row.error } : {}),
    ...(iso(row.next_run_at) ? { nextRunAt: iso(row.next_run_at) } : {}),
    ...(iso(row.started_at) ? { startedAt: iso(row.started_at) } : {}),
    ...(iso(row.finished_at) ? { finishedAt: iso(row.finished_at) } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function enqueueConnectorLearningJob(input: {
  connectorId: string;
  accountId: string;
  connectionId: string;
  sourceInstanceId: string;
  agentId: string;
  mode: ConnectorLearningMode;
  idempotencyKey: string;
  nextRunAt?: number;
  nowMs?: number;
}): ConnectorLearningJob {
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO connector_learning_jobs (
        job_id, idempotency_key, connector_id, account_id, connection_id, source_instance_id,
        agent_id, mode, status, phase, next_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING`,
    ).run(
      randomUUID(), input.idempotencyKey, input.connectorId, input.accountId, input.connectionId,
      input.sourceInstanceId, input.agentId, input.mode, input.nextRunAt ?? now, now, now,
    );
  });
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM connector_learning_jobs WHERE idempotency_key = ?',
  ).get(input.idempotencyKey) as JobRow;
  return fromRow(row);
}

export function claimNextConnectorLearningJob(nowMs = Date.now()): ConnectorLearningJob | null {
  return runSqliteWriteTransaction((db) => {
    const row = db.prepare(
      `SELECT * FROM connector_learning_jobs
       WHERE status IN ('queued', 'failed') AND attempt_count < 5 AND COALESCE(next_run_at, 0) <= ?
       ORDER BY next_run_at ASC, created_at ASC LIMIT 1`,
    ).get(nowMs) as JobRow | undefined;
    if (!row) return null;
    const changed = db.prepare(
      `UPDATE connector_learning_jobs SET
        status = 'running', phase = 'fetching', attempt_count = attempt_count + 1,
        error = NULL, started_at = COALESCE(started_at, ?), updated_at = ?
       WHERE job_id = ? AND status IN ('queued', 'failed')`,
    ).run(nowMs, nowMs, row.job_id);
    if (changed.changes !== 1) return null;
    const claimed = db.prepare('SELECT * FROM connector_learning_jobs WHERE job_id = ?')
      .get(row.job_id) as JobRow;
    return fromRow(claimed);
  });
}

export function recoverStaleConnectorLearningJobs(staleBeforeMs: number, nowMs = Date.now()): number {
  return runSqliteWriteTransaction((db) => Number(db.prepare(
    `UPDATE connector_learning_jobs SET
      status = CASE WHEN attempt_count >= 5 THEN 'paused' ELSE 'failed' END,
      error = 'Interrupted while learning; queued for recovery.',
      next_run_at = CASE WHEN attempt_count >= 5 THEN NULL ELSE ? END,
      finished_at = ?, updated_at = ?
     WHERE status = 'running' AND updated_at < ?`,
  ).run(nowMs, nowMs, nowMs, staleBeforeMs).changes));
}

export function setConnectorLearningPaused(accountId: string, paused: boolean, nowMs = Date.now()): number {
  return runSqliteWriteTransaction((db) => Number(db.prepare(
    paused
      ? `UPDATE connector_learning_jobs SET status = 'paused', next_run_at = NULL, updated_at = ?
         WHERE account_id = ? AND status IN ('queued', 'failed', 'running')`
      : `UPDATE connector_learning_jobs SET status = 'queued', next_run_at = ?, updated_at = ?
         WHERE account_id = ? AND status = 'paused'`,
  ).run(...(paused ? [nowMs, accountId] : [nowMs, nowMs, accountId])).changes));
}

export function updateConnectorLearningJob(
  id: string,
  patch: Partial<Pick<ConnectorLearningJob,
    'accountId' | 'sourceInstanceId' | 'status' | 'phase' | 'itemsDiscovered' | 'itemsIndexed' | 'candidatesCreated' | 'error'>> & {
    nextRunAt?: number | null;
    finished?: boolean;
    nowMs?: number;
  },
): ConnectorLearningJob {
  const now = patch.nowMs ?? Date.now();
  const fields: string[] = ['updated_at = ?'];
  const values: Array<string | number | null> = [now];
  const add = (column: string, value: string | number | null | undefined) => {
    if (value === undefined) return;
    fields.push(`${column} = ?`);
    values.push(value);
  };
  add('status', patch.status);
  add('account_id', patch.accountId);
  add('source_instance_id', patch.sourceInstanceId);
  add('phase', patch.phase);
  add('items_discovered', patch.itemsDiscovered);
  add('items_indexed', patch.itemsIndexed);
  add('candidates_created', patch.candidatesCreated);
  add('error', patch.error);
  add('next_run_at', patch.nextRunAt);
  if (patch.finished) add('finished_at', now);
  values.push(id);
  getSqliteDatabase().prepare(
    `UPDATE connector_learning_jobs SET ${fields.join(', ')} WHERE job_id = ?`,
  ).run(...values);
  const row = getSqliteDatabase().prepare('SELECT * FROM connector_learning_jobs WHERE job_id = ?')
    .get(id) as JobRow | undefined;
  if (!row) throw new Error(`Connector learning job not found: ${id}`);
  return fromRow(row);
}

export function listConnectorLearningJobs(options: {
  sourceInstanceId?: string;
  accountId?: string;
  connectionId?: string;
  limit?: number;
} = {}): ConnectorLearningJob[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (options.sourceInstanceId) { clauses.push('source_instance_id = ?'); values.push(options.sourceInstanceId); }
  if (options.accountId) { clauses.push('account_id = ?'); values.push(options.accountId); }
  if (options.connectionId) { clauses.push('connection_id = ?'); values.push(options.connectionId); }
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const rows = getSqliteDatabase().prepare(
    `SELECT * FROM connector_learning_jobs ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY created_at DESC LIMIT ?`,
  ).all(...values, limit) as JobRow[];
  return rows.map(fromRow);
}

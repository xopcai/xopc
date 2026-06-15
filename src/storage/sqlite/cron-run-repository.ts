import type { JobExecution } from '../../cron/execution-types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

const MAX_RUNS_PER_JOB = 2000;
const TRIM_TO_RUNS = 1500;

type CronRunRow = {
  run_id: string;
  job_id: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  error: string | null;
  output: string | null;
  retry_count: number;
  summary: string | null;
  session_id: string | null;
  session_key: string | null;
  session_type: string | null;
  model: string | null;
  provider: string | null;
  usage_json: string | null;
  workflow_run_id: string | null;
};

function rowToExecution(row: CronRunRow): JobExecution {
  return {
    id: row.run_id,
    jobId: row.job_id,
    status: row.status as JobExecution['status'],
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: row.ended_at != null ? new Date(row.ended_at).toISOString() : undefined,
    duration: row.duration_ms ?? undefined,
    error: row.error ?? undefined,
    output: row.output ?? undefined,
    retryCount: row.retry_count,
    summary: row.summary ?? undefined,
    sessionId: row.session_id ?? undefined,
    sessionKey: row.session_key ?? undefined,
    sessionType: row.session_type ?? undefined,
    model: row.model ?? undefined,
    provider: row.provider ?? undefined,
    usage: row.usage_json ? (JSON.parse(row.usage_json) as JobExecution['usage']) : undefined,
    workflowRunId: row.workflow_run_id ?? undefined,
  };
}

function executionToInsert(execution: JobExecution): CronRunRow {
  const startedAt = Date.parse(execution.startedAt);
  const endedAt = execution.endedAt ? Date.parse(execution.endedAt) : null;
  return {
    run_id: execution.id,
    job_id: execution.jobId,
    status: execution.status,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: execution.duration ?? null,
    error: execution.error ?? null,
    output: execution.output ?? null,
    retry_count: execution.retryCount,
    summary: execution.summary ?? null,
    session_id: execution.sessionId ?? null,
    session_key: execution.sessionKey ?? null,
    session_type: execution.sessionType ?? null,
    model: execution.model ?? null,
    provider: execution.provider ?? null,
    usage_json: execution.usage ? JSON.stringify(execution.usage) : null,
    workflow_run_id: execution.workflowRunId ?? null,
  };
}

function trimJobRuns(db: ReturnType<typeof getSqliteDatabase>, jobId: string): void {
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM cron_runs WHERE job_id = ?`)
    .get(jobId) as { count: number };
  if (countRow.count <= MAX_RUNS_PER_JOB) {
    return;
  }
  const excess = countRow.count - TRIM_TO_RUNS;
  db.prepare(
    `DELETE FROM cron_runs WHERE run_id IN (
       SELECT run_id FROM cron_runs WHERE job_id = ?
       ORDER BY started_at ASC LIMIT ?
     )`,
  ).run(jobId, excess);
}

export function appendCronRun(execution: JobExecution): void {
  if (execution.status === 'running') {
    return;
  }
  const row = executionToInsert(execution);
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT OR REPLACE INTO cron_runs (
        run_id, job_id, status, started_at, ended_at, duration_ms,
        error, output, retry_count, summary, session_id, session_key,
        session_type, model, provider, usage_json, workflow_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.run_id,
      row.job_id,
      row.status,
      row.started_at,
      row.ended_at,
      row.duration_ms,
      row.error,
      row.output,
      row.retry_count,
      row.summary,
      row.session_id,
      row.session_key,
      row.session_type,
      row.model,
      row.provider,
      row.usage_json,
      row.workflow_run_id,
    );
    trimJobRuns(db, row.job_id);
  });
}

export function readCronJobHistory(jobId: string, limit: number): JobExecution[] {
  if (limit <= 0) {
    return [];
  }
  const db = getSqliteDatabase();
  const rows = db
    .prepare(
      `SELECT run_id, job_id, status, started_at, ended_at, duration_ms,
              error, output, retry_count, summary, session_id, session_key,
              session_type, model, provider, usage_json, workflow_run_id
       FROM cron_runs
       WHERE job_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(jobId, limit) as CronRunRow[];
  return rows.map(rowToExecution);
}

export function readAllCronRuns(limit: number): JobExecution[] {
  if (limit <= 0) {
    return [];
  }
  const db = getSqliteDatabase();
  const rows = db
    .prepare(
      `SELECT run_id, job_id, status, started_at, ended_at, duration_ms,
              error, output, retry_count, summary, session_id, session_key,
              session_type, model, provider, usage_json, workflow_run_id
       FROM cron_runs
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(limit) as CronRunRow[];
  return rows.map(rowToExecution);
}

export function deleteCronRunsForJob(jobId: string): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(`DELETE FROM cron_runs WHERE job_id = ?`).run(jobId);
  });
}

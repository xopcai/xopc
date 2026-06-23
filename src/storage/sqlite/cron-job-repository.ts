import type { JobData } from '../../cron/types.js';
import { JobDataSchema } from '../../cron/validation.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type CronJobRow = {
  job_id: string;
  name: string;
  description: string | null;
  enabled: number;
  delete_after_run: number | null;
  created_at_ms: number;
  updated_at_ms: number;
  schedule_json: string;
  session_target: string;
  wake_mode: string;
  agent_id: string | null;
  session_key: string | null;
  working_directory: string | null;
  payload_json: string;
  delivery_json: string | null;
  failure_alert_json: string | null;
  state_json: string;
};

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  return JSON.parse(value);
}

function rowToCronJob(row: CronJobRow): JobData {
  const parsed = JobDataSchema.parse({
    id: row.job_id,
    name: row.name,
    description: row.description ?? undefined,
    enabled: row.enabled !== 0,
    deleteAfterRun: row.delete_after_run == null ? undefined : row.delete_after_run !== 0,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    schedule: parseJson(row.schedule_json),
    sessionTarget: row.session_target,
    wakeMode: row.wake_mode,
    agentId: row.agent_id ?? undefined,
    sessionKey: row.session_key ?? undefined,
    workingDirectory: row.working_directory ?? undefined,
    payload: parseJson(row.payload_json),
    delivery: parseJson(row.delivery_json),
    failureAlert: parseJson(row.failure_alert_json),
    state: parseJson(row.state_json) ?? {},
  });
  return parsed as JobData;
}

function bindJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function upsertJob(db: ReturnType<typeof getSqliteDatabase>, job: JobData): void {
  db.prepare(
    `INSERT OR REPLACE INTO cron_jobs (
      job_id, name, description, enabled, delete_after_run, created_at_ms, updated_at_ms,
      schedule_json, session_target, wake_mode, agent_id, session_key, working_directory,
      payload_json, delivery_json, failure_alert_json, state_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.name,
    job.description ?? null,
    job.enabled ? 1 : 0,
    job.deleteAfterRun == null ? null : job.deleteAfterRun ? 1 : 0,
    job.createdAtMs,
    job.updatedAtMs,
    JSON.stringify(job.schedule),
    job.sessionTarget,
    job.wakeMode,
    job.agentId ?? null,
    job.sessionKey ?? null,
    job.workingDirectory ?? null,
    JSON.stringify(job.payload),
    bindJson(job.delivery),
    bindJson(job.failureAlert),
    JSON.stringify(job.state ?? {}),
  );
}

export function listCronJobs(): JobData[] {
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT job_id, name, description, enabled, delete_after_run, created_at_ms, updated_at_ms,
              schedule_json, session_target, wake_mode, agent_id, session_key, working_directory,
              payload_json, delivery_json, failure_alert_json, state_json
       FROM cron_jobs
       ORDER BY created_at_ms DESC`,
    )
    .all() as CronJobRow[];
  return rows.map(rowToCronJob);
}

export function getCronJob(jobId: string): JobData | null {
  const row = getSqliteDatabase()
    .prepare(
      `SELECT job_id, name, description, enabled, delete_after_run, created_at_ms, updated_at_ms,
              schedule_json, session_target, wake_mode, agent_id, session_key, working_directory,
              payload_json, delivery_json, failure_alert_json, state_json
       FROM cron_jobs
       WHERE job_id = ?`,
    )
    .get(jobId) as CronJobRow | undefined;
  return row ? rowToCronJob(row) : null;
}

export function saveCronJob(job: JobData): void {
  runSqliteWriteTransaction((db) => upsertJob(db, job));
}

export function saveCronJobs(jobs: JobData[]): void {
  runSqliteWriteTransaction((db) => {
    for (const job of jobs) upsertJob(db, job);
  });
}

export function deleteCronJob(jobId: string): boolean {
  return runSqliteWriteTransaction((db) => {
    const result = db.prepare(`DELETE FROM cron_jobs WHERE job_id = ?`).run(jobId);
    return result.changes > 0;
  });
}

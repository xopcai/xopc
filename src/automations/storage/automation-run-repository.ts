import type { AutomationRun } from '../domain/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

const MAX_RUNS_PER_AUTOMATION = 2000;
const TRIM_TO_RUNS = 1500;

type AutomationRunRow = {
  run_id: string;
  automation_id: string;
  automation_name: string;
  status: string;
  trigger_snapshot_json: string;
  action_snapshot_json: string;
  manual: number;
  created_at_ms: number;
  started_at_ms: number | null;
  ended_at_ms: number | null;
  duration_ms: number | null;
  summary: string | null;
  error: string | null;
  session_key: string | null;
  workflow_run_id: string | null;
  model: string | null;
};

function rowToRun(row: AutomationRunRow): AutomationRun {
  return {
    id: row.run_id,
    automationId: row.automation_id,
    automationName: row.automation_name,
    status: row.status as AutomationRun['status'],
    triggerSnapshot: JSON.parse(row.trigger_snapshot_json),
    actionSnapshot: JSON.parse(row.action_snapshot_json),
    manual: row.manual !== 0,
    createdAtMs: row.created_at_ms,
    startedAtMs: row.started_at_ms ?? undefined,
    endedAtMs: row.ended_at_ms ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    summary: row.summary ?? undefined,
    error: row.error ?? undefined,
    sessionKey: row.session_key ?? undefined,
    workflowRunId: row.workflow_run_id ?? undefined,
    model: row.model ?? undefined,
  };
}

function trimRuns(db: ReturnType<typeof getSqliteDatabase>, automationId: string): void {
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM automation_runs WHERE automation_id = ?`)
    .get(automationId) as { count: number };
  if (countRow.count <= MAX_RUNS_PER_AUTOMATION) return;
  db.prepare(
    `DELETE FROM automation_runs WHERE run_id IN (
       SELECT run_id FROM automation_runs WHERE automation_id = ?
       ORDER BY created_at_ms ASC LIMIT ?
     )`,
  ).run(automationId, countRow.count - TRIM_TO_RUNS);
}

export function saveAutomationRun(run: AutomationRun): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT OR REPLACE INTO automation_runs (
        run_id, automation_id, automation_name, status, trigger_snapshot_json,
        action_snapshot_json, manual, created_at_ms, started_at_ms, ended_at_ms,
        duration_ms, summary, error, session_key, workflow_run_id, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.id,
      run.automationId,
      run.automationName,
      run.status,
      JSON.stringify(run.triggerSnapshot),
      JSON.stringify(run.actionSnapshot),
      run.manual ? 1 : 0,
      run.createdAtMs,
      run.startedAtMs ?? null,
      run.endedAtMs ?? null,
      run.durationMs ?? null,
      run.summary ?? null,
      run.error ?? null,
      run.sessionKey ?? null,
      run.workflowRunId ?? null,
      run.model ?? null,
    );
    trimRuns(db, run.automationId);
  });
}

export function getAutomationRun(runId: string): AutomationRun | null {
  const row = getSqliteDatabase()
    .prepare(
      `SELECT run_id, automation_id, automation_name, status, trigger_snapshot_json,
              action_snapshot_json, manual, created_at_ms, started_at_ms, ended_at_ms,
              duration_ms, summary, error, session_key, workflow_run_id, model
       FROM automation_runs
       WHERE run_id = ?`,
    )
    .get(runId) as AutomationRunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function listAutomationRuns(options?: {
  automationId?: string;
  limit?: number;
}): AutomationRun[] {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 500);
  const db = getSqliteDatabase();
  const base = `SELECT run_id, automation_id, automation_name, status, trigger_snapshot_json,
                       action_snapshot_json, manual, created_at_ms, started_at_ms, ended_at_ms,
                       duration_ms, summary, error, session_key, workflow_run_id, model
                FROM automation_runs`;
  const rows = options?.automationId
    ? db.prepare(`${base} WHERE automation_id = ? ORDER BY created_at_ms DESC LIMIT ?`).all(options.automationId, limit)
    : db.prepare(`${base} ORDER BY created_at_ms DESC LIMIT ?`).all(limit);
  return (rows as AutomationRunRow[]).map(rowToRun);
}

export function deleteAutomationRunsForAutomation(automationId: string): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(`DELETE FROM automation_runs WHERE automation_id = ?`).run(automationId);
  });
}


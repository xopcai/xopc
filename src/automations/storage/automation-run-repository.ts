import type { AutomationProductEventRun, AutomationRun, AutomationRunEvent } from '../domain/types.js';
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

type AutomationRunEventRow = {
  event_id: string;
  run_id: string;
  automation_id: string;
  type: string;
  message: string;
  data_json: string | null;
  created_at_ms: number;
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

function rowToEvent(row: AutomationRunEventRow): AutomationRunEvent {
  return {
    id: row.event_id,
    runId: row.run_id,
    automationId: row.automation_id,
    type: row.type as AutomationRunEvent['type'],
    message: row.message,
    data: row.data_json ? JSON.parse(row.data_json) : undefined,
    createdAtMs: row.created_at_ms,
  };
}

function trimRuns(db: ReturnType<typeof getSqliteDatabase>, automationId: string): void {
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM automation_runs WHERE automation_id = ?`)
    .get(automationId) as { count: number };
  if (countRow.count <= MAX_RUNS_PER_AUTOMATION) return;
  const staleRunIds = db
    .prepare(
      `SELECT run_id FROM automation_runs WHERE automation_id = ?
       ORDER BY created_at_ms ASC LIMIT ?`,
    )
    .all(automationId, countRow.count - TRIM_TO_RUNS) as { run_id: string }[];
  for (const { run_id: runId } of staleRunIds) {
    db.prepare(`DELETE FROM automation_run_events WHERE run_id = ?`).run(runId);
    db.prepare(`DELETE FROM automation_runs WHERE run_id = ?`).run(runId);
  }
}

export function appendAutomationRunEvent(event: AutomationRunEvent): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO automation_run_events (
        event_id, run_id, automation_id, type, message, data_json, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.runId,
      event.automationId,
      event.type,
      event.message,
      event.data === undefined ? null : JSON.stringify(event.data),
      event.createdAtMs,
    );
  });
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

export function listAutomationRunEvents(runId: string): AutomationRunEvent[] {
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT event_id, run_id, automation_id, type, message, data_json, created_at_ms
       FROM automation_run_events
       WHERE run_id = ?
       ORDER BY created_at_ms ASC`,
    )
    .all(runId) as AutomationRunEventRow[];
  return rows.map(rowToEvent);
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
  projectId?: string;
  limit?: number;
}): AutomationRun[] {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 500);
  const db = getSqliteDatabase();
  const base = `SELECT run_id, automation_id, automation_name, status, trigger_snapshot_json,
                       action_snapshot_json, manual, created_at_ms, started_at_ms, ended_at_ms,
                       duration_ms, summary, error, session_key, workflow_run_id, model
                FROM automation_runs`;
  let rows: unknown[];
  if (options?.automationId) {
    rows = db.prepare(`${base} WHERE automation_id = ? ORDER BY created_at_ms DESC LIMIT ?`).all(options.automationId, limit);
  } else if (options?.projectId) {
    rows = db.prepare(
      `SELECT r.run_id, r.automation_id, r.automation_name, r.status, r.trigger_snapshot_json,
              r.action_snapshot_json, r.manual, r.created_at_ms, r.started_at_ms, r.ended_at_ms,
              r.duration_ms, r.summary, r.error, r.session_key, r.workflow_run_id, r.model
       FROM automation_runs r
       JOIN automations a ON a.automation_id = r.automation_id
       WHERE a.project_id = ?
       ORDER BY r.created_at_ms DESC
       LIMIT ?`,
    ).all(options.projectId, limit);
  } else {
    rows = db.prepare(`${base} ORDER BY created_at_ms DESC LIMIT ?`).all(limit);
  }
  return (rows as AutomationRunRow[]).map(rowToRun);
}

export function listAutomationRunsForProductEvent(options: {
  eventType: string;
  source?: string;
  payloadKey?: string;
  payloadValue?: string;
  limit?: number;
}): AutomationProductEventRun[] {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
  const clauses = [
    `e.type = 'run.queued'`,
    `json_extract(e.data_json, '$.event.type') = ?`,
  ];
  const params: Array<string | number> = [options.eventType, limit];

  if (options.source) {
    clauses.push(`json_extract(e.data_json, '$.event.source') = ?`);
    params.splice(params.length - 1, 0, options.source);
  }
  if (options.payloadKey && options.payloadValue !== undefined) {
    clauses.push(`json_extract(e.data_json, '$.event.payload.' || ?) = ?`);
    params.splice(params.length - 1, 0, options.payloadKey, options.payloadValue);
  }

  const rows = getSqliteDatabase()
    .prepare(
      `SELECT r.run_id, r.automation_id, r.automation_name, r.status, r.trigger_snapshot_json,
              r.action_snapshot_json, r.manual, r.created_at_ms, r.started_at_ms, r.ended_at_ms,
              r.duration_ms, r.summary, r.error, r.session_key, r.workflow_run_id, r.model,
              e.event_id, e.run_id AS event_run_id, e.automation_id AS event_automation_id,
              e.type AS event_type, e.message AS event_message, e.data_json AS event_data_json,
              e.created_at_ms AS event_created_at_ms
       FROM automation_run_events e
       JOIN automation_runs r ON r.run_id = e.run_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY e.created_at_ms DESC
       LIMIT ?`,
    )
    .all(...params) as Array<AutomationRunRow & {
      event_id: string;
      event_run_id: string;
      event_automation_id: string;
      event_type: string;
      event_message: string;
      event_data_json: string | null;
      event_created_at_ms: number;
    }>;

  return rows.map((row) => ({
    run: rowToRun(row),
    triggerEvent: rowToEvent({
      event_id: row.event_id,
      run_id: row.event_run_id,
      automation_id: row.event_automation_id,
      type: row.event_type,
      message: row.event_message,
      data_json: row.event_data_json,
      created_at_ms: row.event_created_at_ms,
    }),
  }));
}

export function deleteAutomationRunsForAutomation(automationId: string): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(`DELETE FROM automation_run_events WHERE automation_id = ?`).run(automationId);
    db.prepare(`DELETE FROM automation_runs WHERE automation_id = ?`).run(automationId);
  });
}

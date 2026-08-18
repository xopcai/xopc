import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import type { WorkflowRunSummary, WorkflowRunView } from '../domain/run.js';

type WorkflowRunIndexRow = {
  run_id: string;
  agent_id: string;
  definition_id: string;
  definition_version: string;
  outcome_id: string | null;
  project_id: string | null;
  session_key: string;
  parent_session_key: string | null;
  status: WorkflowRunSummary['status'];
  source_kind: string;
  source_json: string;
  metadata_json: string | null;
  title: string;
  created_at_ms: number;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  metrics_json: string;
  result_preview: string | null;
  error_message: string | null;
};

function rowToSummary(row: WorkflowRunIndexRow): WorkflowRunSummary {
  const source = JSON.parse(row.source_json) as WorkflowRunSummary['source'];
  const metadata = row.metadata_json
    ? JSON.parse(row.metadata_json) as WorkflowRunSummary['metadata']
    : undefined;
  return {
    id: row.run_id,
    definitionId: row.definition_id,
    title: row.title,
    status: row.status,
    source,
    metadata,
    createdAtMs: row.created_at_ms,
    startedAtMs: row.started_at_ms ?? undefined,
    completedAtMs: row.completed_at_ms ?? undefined,
    metrics: JSON.parse(row.metrics_json) as WorkflowRunSummary['metrics'],
  };
}

function resultPreview(view: WorkflowRunView): string | null {
  const result = view.run.result;
  if (result == null) return null;
  return result.summary.slice(0, 500);
}

function parentSessionKey(view: WorkflowRunView): string | null {
  if (view.run.source.kind === 'chat') return view.run.source.sessionKey;
  const originKey = view.run.metadata?.origin?.sessionKey;
  return originKey?.trim() || null;
}

export class WorkflowRunIndexStore {
  upsert(agentId: string, view: WorkflowRunView): void {
    const run = view.run;
    const metadata = run.metadata;
    const sessionKey = metadata?.sessionKey;
    if (!sessionKey) return;
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT OR REPLACE INTO workflow_runs (
          run_id, agent_id, definition_id, definition_version, outcome_id,
          project_id, session_key, parent_session_key, status, source_kind, source_json,
          metadata_json, title,
          created_at_ms, started_at_ms, completed_at_ms, metrics_json,
          result_preview, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        run.id,
        agentId,
        run.definitionId,
        run.definitionVersion,
        metadata?.outcomeId ?? null,
        metadata?.projectId ?? null,
        sessionKey,
        parentSessionKey(view),
        run.status,
        run.source.kind,
        JSON.stringify(run.source),
        metadata ? JSON.stringify(metadata) : null,
        run.title,
        run.createdAtMs,
        run.startedAtMs ?? null,
        run.completedAtMs ?? null,
        JSON.stringify(run.metrics),
        resultPreview(view),
        run.error?.message ?? null,
      );
    });
  }

  list(agentId: string, options: { limit?: number; outcomeId?: string; projectId?: string } = {}): WorkflowRunSummary[] {
    const safeLimit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 50)));
    const db = getSqliteDatabase();
    const conditions = ['agent_id = ?'];
    const params: Array<string | number> = [agentId];
    if (options.outcomeId) {
      conditions.push('outcome_id = ?');
      params.push(options.outcomeId);
    }
    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }
    const rows = db
      .prepare(`SELECT * FROM workflow_runs WHERE ${conditions.join(' AND ')} ORDER BY created_at_ms DESC LIMIT ?`)
      .all(...params, safeLimit);
    return (rows as WorkflowRunIndexRow[]).map(rowToSummary);
  }
}

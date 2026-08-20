import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type DreamingMode = 'off' | 'observe' | 'review' | 'automatic';
export type DreamingActiveMode = Exclude<DreamingMode, 'off'>;
export type DreamingPhase = 'light' | 'deep' | 'rem';

export interface DreamingRun {
  runId: string;
  agentId: string;
  workspaceId: string;
  phase: DreamingPhase;
  mode: DreamingActiveMode;
  triggerKind: 'schedule' | 'manual';
  algorithmVersion: string;
  configSnapshot: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed';
  reason?: string;
  metrics: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
}

export interface DreamingDecision {
  decisionId: string;
  runId: string;
  recordId?: string;
  action: 'observe' | 'propose' | 'activate' | 'skip';
  reasonCode: string;
  score?: number;
  evidence: Record<string, unknown>;
  createdAt: string;
}

type RunRow = {
  run_id: string; agent_id: string; workspace_id: string; phase: DreamingPhase;
  mode: DreamingActiveMode; trigger_kind: 'schedule' | 'manual';
  algorithm_version: string; config_snapshot_json: string;
  status: DreamingRun['status']; reason: string | null; metrics_json: string;
  started_at: number; completed_at: number | null;
};

type DecisionRow = {
  decision_id: string; run_id: string; record_id: string | null;
  action: DreamingDecision['action']; reason_code: string; score: number | null;
  evidence_json: string; created_at: number;
};

function rowToRun(row: RunRow): DreamingRun {
  let metrics: Record<string, unknown> = {};
  let configSnapshot: Record<string, unknown> = {};
  try { metrics = JSON.parse(row.metrics_json) as Record<string, unknown>; } catch { /* empty */ }
  try { configSnapshot = JSON.parse(row.config_snapshot_json) as Record<string, unknown>; } catch { /* empty */ }
  return {
    runId: row.run_id, agentId: row.agent_id, workspaceId: row.workspace_id,
    phase: row.phase, mode: row.mode, triggerKind: row.trigger_kind, status: row.status,
    algorithmVersion: row.algorithm_version, configSnapshot,
    ...(row.reason ? { reason: row.reason } : {}), metrics,
    startedAt: new Date(row.started_at).toISOString(),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at).toISOString() } : {}),
  };
}

function rowToDecision(row: DecisionRow): DreamingDecision {
  let evidence: Record<string, unknown> = {};
  try { evidence = JSON.parse(row.evidence_json) as Record<string, unknown>; } catch { /* empty */ }
  return {
    decisionId: row.decision_id,
    runId: row.run_id,
    ...(row.record_id ? { recordId: row.record_id } : {}),
    action: row.action,
    reasonCode: row.reason_code,
    ...(row.score == null ? {} : { score: row.score }),
    evidence,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function startDreamingRun(input: {
  agentId: string; workspaceId: string; phase: DreamingPhase; mode: DreamingActiveMode;
  triggerKind?: 'schedule' | 'manual'; algorithmVersion: string;
  configSnapshot: Record<string, unknown>; nowMs?: number;
}): DreamingRun {
  const runId = randomUUID();
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => db.prepare(
    `INSERT INTO dreaming_runs (
       run_id, agent_id, workspace_id, phase, mode, trigger_kind,
       algorithm_version, config_snapshot_json, status, started_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
  ).run(
    runId, input.agentId, input.workspaceId, input.phase, input.mode,
    input.triggerKind ?? 'schedule', input.algorithmVersion,
    JSON.stringify(input.configSnapshot), now,
  ));
  return getDreamingRun(runId)!;
}

export function finishDreamingRun(input: {
  runId: string; ok: boolean; reason: string; metrics?: Record<string, unknown>; nowMs?: number;
}): DreamingRun | null {
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => db.prepare(
    `UPDATE dreaming_runs SET status = ?, reason = ?, metrics_json = ?, completed_at = ? WHERE run_id = ?`,
  ).run(input.ok ? 'completed' : 'failed', input.reason, JSON.stringify(input.metrics ?? {}), now, input.runId));
  return getDreamingRun(input.runId);
}

export function recordDreamingDecision(input: {
  runId: string; recordId?: string; action: 'observe' | 'propose' | 'activate' | 'skip';
  reasonCode: string; score?: number; evidence?: Record<string, unknown>; nowMs?: number;
}): string {
  const id = randomUUID();
  runSqliteWriteTransaction((db) => db.prepare(
    `INSERT INTO dreaming_decisions (decision_id, run_id, record_id, action, reason_code, score, evidence_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.runId, input.recordId ?? null, input.action, input.reasonCode,
    input.score == null ? null : Math.max(0, Math.min(1, input.score)), JSON.stringify(input.evidence ?? {}), input.nowMs ?? Date.now()));
  return id;
}

export function getDreamingRun(runId: string): DreamingRun | null {
  const row = getSqliteDatabase().prepare(`SELECT * FROM dreaming_runs WHERE run_id = ?`).get(runId) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function listDreamingRuns(options: { agentId?: string; workspaceId?: string; limit?: number } = {}): DreamingRun[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.agentId) { where.push('agent_id = ?'); params.push(options.agentId); }
  if (options.workspaceId) { where.push('workspace_id = ?'); params.push(options.workspaceId); }
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  return (getSqliteDatabase().prepare(
    `SELECT * FROM dreaming_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY started_at DESC LIMIT ?`,
  ).all(...params, limit) as RunRow[]).map(rowToRun);
}

export function listDreamingDecisions(runId: string, limit = 200): DreamingDecision[] {
  const safeLimit = Math.max(1, Math.min(500, limit));
  return (getSqliteDatabase().prepare(
    `SELECT * FROM dreaming_decisions WHERE run_id = ? ORDER BY created_at, decision_id LIMIT ?`,
  ).all(runId, safeLimit) as DecisionRow[]).map(rowToDecision);
}

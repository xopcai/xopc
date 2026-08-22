import { randomUUID } from 'node:crypto';

import { getSqliteDatabase } from './transaction.js';

export type ContextConsolidationRun = {
  runId: string;
  triggerKind: 'schedule' | 'manual';
  status: 'running' | 'completed' | 'failed';
  reason?: string;
  metrics: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
};

export type ContextConsolidationDecision = {
  id: string;
  runId: string;
  understandingId?: string;
  action: 'needs_review' | 'stale';
  reasonCode: string;
  evidenceCount: number;
  createdAt: number;
};

type RunRow = {
  run_id: string;
  trigger_kind: ContextConsolidationRun['triggerKind'];
  status: ContextConsolidationRun['status'];
  reason: string | null;
  metrics_json: string;
  started_at: number;
  completed_at: number | null;
};

type DecisionRow = {
  decision_id: string;
  run_id: string;
  understanding_id: string | null;
  action: ContextConsolidationDecision['action'];
  reason_code: string;
  evidence_count: number;
  created_at: number;
};

function parseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function runFromRow(row: RunRow): ContextConsolidationRun {
  return {
    runId: row.run_id,
    triggerKind: row.trigger_kind,
    status: row.status,
    ...(row.reason ? { reason: row.reason } : {}),
    metrics: parseJson(row.metrics_json),
    startedAt: row.started_at,
    ...(row.completed_at == null ? {} : { completedAt: row.completed_at }),
  };
}

export function startContextConsolidationRun(
  triggerKind: ContextConsolidationRun['triggerKind'],
  now = Date.now(),
): ContextConsolidationRun {
  const runId = randomUUID();
  getSqliteDatabase().prepare(`INSERT INTO context_consolidation_runs (
    run_id, trigger_kind, status, started_at
  ) VALUES (?, ?, 'running', ?)`).run(runId, triggerKind, now);
  return getContextConsolidationRun(runId)!;
}

export function finishContextConsolidationRun(input: {
  runId: string;
  ok: boolean;
  reason: string;
  metrics: Record<string, unknown>;
  now?: number;
}): ContextConsolidationRun | undefined {
  getSqliteDatabase().prepare(`UPDATE context_consolidation_runs
    SET status = ?, reason = ?, metrics_json = ?, completed_at = ? WHERE run_id = ?`)
    .run(input.ok ? 'completed' : 'failed', input.reason, JSON.stringify(input.metrics), input.now ?? Date.now(), input.runId);
  return getContextConsolidationRun(input.runId);
}

export function recordContextConsolidationDecision(input: {
  runId: string;
  understandingId: string;
  action: ContextConsolidationDecision['action'];
  reasonCode: string;
  evidenceCount: number;
  now?: number;
}): ContextConsolidationDecision {
  const id = randomUUID();
  getSqliteDatabase().prepare(`INSERT INTO context_consolidation_decisions (
    decision_id, run_id, understanding_id, action, reason_code, evidence_count, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.runId, input.understandingId, input.action, input.reasonCode,
      input.evidenceCount, input.now ?? Date.now());
  return listContextConsolidationDecisions(input.runId).find((item) => item.id === id)!;
}

export function getContextConsolidationRun(runId: string): ContextConsolidationRun | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM context_consolidation_runs WHERE run_id = ?')
    .get(runId) as RunRow | undefined;
  return row ? runFromRow(row) : undefined;
}

export function listContextConsolidationRuns(limit = 20): ContextConsolidationRun[] {
  const safeLimit = Math.max(1, Math.min(200, limit));
  return (getSqliteDatabase().prepare(`SELECT * FROM context_consolidation_runs
    ORDER BY started_at DESC LIMIT ?`).all(safeLimit) as RunRow[]).map(runFromRow);
}

export function listContextConsolidationDecisions(runId: string): ContextConsolidationDecision[] {
  return (getSqliteDatabase().prepare(`SELECT * FROM context_consolidation_decisions
    WHERE run_id = ? ORDER BY created_at, decision_id`).all(runId) as DecisionRow[]).map((row) => ({
    id: row.decision_id,
    runId: row.run_id,
    ...(row.understanding_id ? { understandingId: row.understanding_id } : {}),
    action: row.action,
    reasonCode: row.reason_code,
    evidenceCount: row.evidence_count,
    createdAt: row.created_at,
  }));
}

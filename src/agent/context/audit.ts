import { createHash } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import type { ExecutionContext } from './execution-context.js';

export interface ExecutionContextBudget {
  maxAssertions: number;
  maxKnowledge: number;
  maxChars: number;
}

export interface ExecutionContextAudit {
  runId: string;
  principalId: string;
  turnId: string;
  sessionId: string;
  queryHash: string;
  asOf: number;
  budget: ExecutionContextBudget;
  metrics: Record<string, number>;
  items: Array<{
    objectType: 'rule' | 'assertion' | 'goal' | 'priority' | 'knowledge';
    objectId: string;
    score?: number;
    reasons: string[];
    included: boolean;
  }>;
  createdAt: number;
}

export function recordExecutionContext(
  context: ExecutionContext,
  input: {
    turnId: string;
    sessionId: string;
    budget: ExecutionContextBudget;
    renderedChars: number;
  },
): void {
  const createdAt = Date.now();
  const items: ExecutionContextAudit['items'] = [
    ...context.rules.map((item) => ({
      objectType: 'rule' as const,
      objectId: item.id,
      reasons: [`${item.enforcementLevel}_rule`],
      included: true,
    })),
    ...context.assertions.map((item) => ({
      objectType: 'assertion' as const,
      objectId: item.assertion.id,
      score: item.score,
      reasons: item.reasons,
      included: true,
    })),
    ...context.goals.map((item) => ({
      objectType: 'goal' as const,
      objectId: item.id,
      reasons: ['active_goal'],
      included: true,
    })),
    ...context.priorities.map((item) => ({
      objectType: 'priority' as const,
      objectId: item.id,
      score: item.urgency,
      reasons: [`${item.rank}_priority`],
      included: true,
    })),
    ...context.knowledge.map((item) => ({
      objectType: 'knowledge' as const,
      objectId: item.id,
      score: item.importance,
      reasons: ['task_relevant_knowledge'],
      included: true,
    })),
  ];
  const metrics = {
    rules: context.rules.length,
    assertions: context.assertions.length,
    goals: context.goals.length,
    priorities: context.priorities.length,
    knowledge: context.knowledge.length,
    renderedChars: input.renderedChars,
  };
  runSqliteWriteTransaction((db) => {
    const existing = db.prepare('SELECT 1 FROM execution_context_runs WHERE turn_id = ?')
      .get(input.turnId);
    if (existing) return;
    db.prepare(`INSERT INTO execution_context_runs (
      run_id, principal_id, turn_id, session_id, query_hash, as_of,
      budget_json, metrics_json, created_at
    ) VALUES (?, 'local-owner', ?, ?, ?, ?, ?, ?, ?)`).run(
      context.traceId,
      input.turnId,
      input.sessionId,
      createHash('sha256').update(context.query).digest('hex'),
      context.asOf,
      JSON.stringify(input.budget),
      JSON.stringify(metrics),
      createdAt,
    );
    const insert = db.prepare(`INSERT INTO execution_context_items (
      run_id, object_type, object_id, score, reasons_json, included, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const item of items) {
      insert.run(context.traceId, item.objectType, item.objectId, item.score ?? null,
        JSON.stringify(item.reasons), item.included ? 1 : 0, createdAt);
    }
  });
}

export function getExecutionContextAudit(turnId: string): ExecutionContextAudit | undefined {
  const db = getSqliteDatabase();
  const run = db.prepare('SELECT * FROM execution_context_runs WHERE turn_id = ?').get(turnId) as {
    run_id: string; principal_id: string; turn_id: string; session_id: string;
    query_hash: string; as_of: number; budget_json: string; metrics_json: string; created_at: number;
  } | undefined;
  if (!run) return undefined;
  const rows = db.prepare(`SELECT object_type, object_id, score, reasons_json, included
    FROM execution_context_items WHERE run_id = ? ORDER BY rowid`).all(run.run_id) as Array<{
      object_type: ExecutionContextAudit['items'][number]['objectType'];
      object_id: string; score: number | null; reasons_json: string; included: number;
    }>;
  return {
    runId: run.run_id,
    principalId: run.principal_id,
    turnId: run.turn_id,
    sessionId: run.session_id,
    queryHash: run.query_hash,
    asOf: run.as_of,
    budget: JSON.parse(run.budget_json),
    metrics: JSON.parse(run.metrics_json),
    items: rows.map((row) => ({
      objectType: row.object_type,
      objectId: row.object_id,
      ...(row.score === null ? {} : { score: row.score }),
      reasons: JSON.parse(row.reasons_json),
      included: row.included === 1,
    })),
    createdAt: run.created_at,
  };
}

export function recordExecutionContextFeedback(input: {
  turnId: string;
  rating: 'helpful' | 'irrelevant';
  reason?: string;
}): boolean {
  const now = Date.now();
  const result = getSqliteDatabase().prepare(`INSERT INTO execution_context_feedback (
    turn_id, rating, reason, created_at, updated_at
  ) SELECT ?, ?, ?, ?, ? WHERE EXISTS (
    SELECT 1 FROM execution_context_runs WHERE turn_id = ?
  ) ON CONFLICT(turn_id) DO UPDATE SET
    rating = excluded.rating, reason = excluded.reason, updated_at = excluded.updated_at`)
    .run(input.turnId, input.rating, input.reason ?? null, now, now, input.turnId);
  return Number(result.changes) > 0;
}

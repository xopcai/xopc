import { createHash } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import type { ExecutionContext } from './execution-context.types.js';

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
    includedContext?: ExecutionContext;
  },
): void {
  const createdAt = Date.now();
  const included = new Set<string>();
  const selected = input.includedContext ?? context;
  for (const item of selected.rules) included.add(`rule:${item.id}`);
  for (const item of selected.assertions) included.add(`assertion:${item.assertion.id}`);
  for (const item of selected.goals) included.add(`goal:${item.id}`);
  for (const item of selected.priorities) included.add(`priority:${item.id}`);
  for (const item of selected.knowledge) included.add(`knowledge:${item.id}`);
  const items: ExecutionContextAudit['items'] = [
    ...context.rules.map((item) => ({
      objectType: 'rule' as const,
      objectId: item.id,
      reasons: [`${item.enforcementLevel}_rule`],
      included: included.has(`rule:${item.id}`),
    })),
    ...context.assertions.map((item) => ({
      objectType: 'assertion' as const,
      objectId: item.assertion.id,
      score: item.score,
      reasons: item.reasons,
      included: included.has(`assertion:${item.assertion.id}`),
    })),
    ...context.goals.map((item) => ({
      objectType: 'goal' as const,
      objectId: item.id,
      reasons: ['active_goal'],
      included: included.has(`goal:${item.id}`),
    })),
    ...context.priorities.map((item) => ({
      objectType: 'priority' as const,
      objectId: item.id,
      score: item.urgency,
      reasons: [`${item.rank}_priority`],
      included: included.has(`priority:${item.id}`),
    })),
    ...context.knowledge.map((item) => ({
      objectType: 'knowledge' as const,
      objectId: item.id,
      score: item.importance,
      reasons: ['task_relevant_knowledge'],
      included: included.has(`knowledge:${item.id}`),
    })),
  ];
  const metrics = {
    rules: context.rules.length,
    assertions: context.assertions.length,
    goals: context.goals.length,
    priorities: context.priorities.length,
    knowledge: context.knowledge.length,
    includedRules: selected.rules.length,
    includedAssertions: selected.assertions.length,
    includedGoals: selected.goals.length,
    includedPriorities: selected.priorities.length,
    includedKnowledge: selected.knowledge.length,
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

export function getExecutionContextFeedbackScores(): Map<string, number> {
  const rows = getSqliteDatabase().prepare(`SELECT i.object_type, i.object_id,
      COUNT(*) AS samples,
      SUM(CASE f.rating WHEN 'helpful' THEN 1 ELSE -1 END) AS balance
    FROM execution_context_items i
    JOIN execution_context_runs r ON r.run_id = i.run_id
    JOIN (
      SELECT turn_id, rating FROM execution_context_feedback
      ORDER BY updated_at DESC LIMIT 500
    ) f ON f.turn_id = r.turn_id
    WHERE i.included = 1
    GROUP BY i.object_type, i.object_id`).all() as Array<{
      object_type: ExecutionContextAudit['items'][number]['objectType'];
      object_id: string;
      samples: number;
      balance: number;
    }>;
  return new Map(rows.flatMap((row) => row.samples < 2
    ? []
    : [[`${row.object_type}:${row.object_id}`, Math.max(-0.1, Math.min(0.1, (row.balance / row.samples) * 0.1))]]));
}

import type { AiUsageEvent, AiUsageFinish } from '../../usage/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

const ERROR_SUMMARY_LIMIT = 512;
export const AI_USAGE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

function boundedError(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withoutSecrets = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]');
  return withoutSecrets.slice(0, ERROR_SUMMARY_LIMIT);
}

export function insertAiUsageEvent(event: AiUsageEvent): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(`INSERT INTO ai_usage_events (
      id, trace_id, parent_event_id, conversation_id, run_id, agent_id,
      category, operation, trigger_kind, reason_key, provider, model, status,
      started_at, finished_at, duration_ms, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens,
      estimated_cost_microusd, cost_source, pricing_snapshot_json, error_summary,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        event.id, event.traceId, event.parentEventId ?? null, event.conversationId ?? null,
        event.runId ?? null, event.agentId ?? null, event.category, event.operation,
        event.trigger, event.reasonKey, event.provider, event.model, event.status,
        event.startedAt, event.finishedAt ?? null, event.durationMs ?? null,
        event.inputTokens ?? null, event.outputTokens ?? null, event.cacheReadTokens ?? null,
        event.cacheWriteTokens ?? null, event.reasoningTokens ?? null, event.totalTokens ?? null,
        event.estimatedCostMicrousd ?? null, event.costSource,
        event.pricingSnapshot ? JSON.stringify(event.pricingSnapshot) : null,
        boundedError(event.errorSummary) ?? null, event.startedAt, event.startedAt,
      );
  });
}

export function finishAiUsageEvent(id: string, finish: AiUsageFinish & { estimatedCostMicrousd?: number }): void {
  const finishedAt = finish.finishedAt ?? Date.now();
  const usage = finish.usage;
  runSqliteWriteTransaction((db) => {
    db.prepare(`UPDATE ai_usage_events SET
      status = ?, finished_at = ?, duration_ms = MAX(0, ? - started_at),
      input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?,
      reasoning_tokens = ?, total_tokens = ?, estimated_cost_microusd = ?,
      error_summary = ?, updated_at = ?
      WHERE id = ? AND status = 'running'`)
      .run(
        finish.status, finishedAt, finishedAt, usage?.input ?? null, usage?.output ?? null,
        usage?.cacheRead ?? null, usage?.cacheWrite ?? null, usage?.reasoning ?? null,
        usage?.totalTokens ?? null, finish.estimatedCostMicrousd ?? null,
        boundedError(finish.errorSummary) ?? null, finishedAt, id,
      );
  });
}

export function markStaleAiUsageEventsUnknown(cutoffMs: number, now = Date.now()): number {
  return runSqliteWriteTransaction((db) => Number(db.prepare(`UPDATE ai_usage_events
    SET status = 'unknown', finished_at = ?, duration_ms = MAX(0, ? - started_at), updated_at = ?
    WHERE status = 'running' AND started_at < ?`).run(now, now, now, cutoffMs).changes));
}

export function pruneAiUsageEvents(cutoffMs: number): number {
  return runSqliteWriteTransaction((db) => Number(db.prepare(`DELETE FROM ai_usage_events
    WHERE status <> 'running' AND started_at < ?`).run(cutoffMs).changes));
}

export function getAiUsageEvent(id: string): Record<string, unknown> | undefined {
  return getSqliteDatabase().prepare('SELECT * FROM ai_usage_events WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

export type AiUsageQuery = {
  from: number;
  to: number;
  category?: string;
  provider?: string;
  model?: string;
  agentId?: string;
  conversationId?: string;
};

type UsageRow = Record<string, string | number | null>;

function queryWhere(query: AiUsageQuery): { sql: string; values: Array<string | number> } {
  const clauses = ['started_at >= ?', 'started_at < ?'];
  const values: Array<string | number> = [query.from, query.to];
  const filters: Array<[keyof AiUsageQuery, string]> = [
    ['category', 'category'], ['provider', 'provider'], ['model', 'model'],
    ['agentId', 'agent_id'], ['conversationId', 'conversation_id'],
  ];
  for (const [key, column] of filters) {
    const value = query[key];
    if (typeof value === 'string' && value) {
      clauses.push(`${column} = ?`);
      values.push(value);
    }
  }
  return { sql: clauses.join(' AND '), values };
}

function usd(microusd: number): string {
  return (microusd / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

export type AiUsageTotals = {
  calls: number;
  succeededCalls: number;
  failedCalls: number;
  unknownCostCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  knownCostUsd: string;
  costCompleteness: 'complete' | 'partial' | 'unknown';
};

function totalsFromRow(row: UsageRow): AiUsageTotals {
  const calls = Number(row.calls ?? 0);
  const unknownCostCalls = Number(row.unknown_cost_calls ?? 0);
  return {
    calls,
    succeededCalls: Number(row.succeeded_calls ?? 0),
    failedCalls: Number(row.failed_calls ?? 0),
    unknownCostCalls,
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cacheReadTokens: Number(row.cache_read_tokens ?? 0),
    cacheWriteTokens: Number(row.cache_write_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    knownCostUsd: usd(Number(row.known_cost_microusd ?? 0)),
    costCompleteness: calls === 0 || unknownCostCalls === calls
      ? 'unknown'
      : unknownCostCalls > 0 ? 'partial' : 'complete',
  };
}

const TOTALS_SQL = `COUNT(*) AS calls,
  SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded_calls,
  SUM(CASE WHEN status IN ('failed', 'aborted', 'unknown') THEN 1 ELSE 0 END) AS failed_calls,
  SUM(CASE WHEN cost_source <> 'local' AND estimated_cost_microusd IS NULL THEN 1 ELSE 0 END) AS unknown_cost_calls,
  COALESCE(SUM(input_tokens), 0) AS input_tokens,
  COALESCE(SUM(output_tokens), 0) AS output_tokens,
  COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
  COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  COALESCE(SUM(estimated_cost_microusd), 0) AS known_cost_microusd`;

export function summarizeAiUsage(query: AiUsageQuery): {
  totals: AiUsageTotals;
  byCategory: Array<{ key: string; totals: AiUsageTotals }>;
  byModel: Array<{ key: string; provider: string; model: string; totals: AiUsageTotals }>;
} {
  const { sql, values } = queryWhere(query);
  const db = getSqliteDatabase();
  const totals = totalsFromRow(db.prepare(`SELECT ${TOTALS_SQL} FROM ai_usage_events WHERE ${sql}`).get(...values) as UsageRow);
  const byCategory = (db.prepare(`SELECT category AS key, ${TOTALS_SQL} FROM ai_usage_events
    WHERE ${sql} GROUP BY category ORDER BY known_cost_microusd DESC, calls DESC`).all(...values) as UsageRow[])
    .map(row => ({ key: String(row.key), totals: totalsFromRow(row) }));
  const byModel = (db.prepare(`SELECT provider || '/' || model AS key, provider, model, ${TOTALS_SQL}
    FROM ai_usage_events WHERE ${sql} GROUP BY provider, model
    ORDER BY known_cost_microusd DESC, calls DESC`).all(...values) as UsageRow[])
    .map(row => ({ key: String(row.key), provider: String(row.provider), model: String(row.model), totals: totalsFromRow(row) }));
  return { totals, byCategory, byModel };
}

function eventFromRow(row: UsageRow) {
  const pricingSnapshot = typeof row.pricing_snapshot_json === 'string'
    ? JSON.parse(row.pricing_snapshot_json) as Record<string, number>
    : undefined;
  return {
    id: String(row.id), traceId: String(row.trace_id),
    parentEventId: row.parent_event_id ? String(row.parent_event_id) : undefined,
    conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
    runId: row.run_id ? String(row.run_id) : undefined,
    agentId: row.agent_id ? String(row.agent_id) : undefined,
    category: String(row.category), operation: String(row.operation), trigger: String(row.trigger_kind),
    reasonKey: String(row.reason_key), provider: String(row.provider), model: String(row.model),
    status: String(row.status), startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? undefined : Number(row.finished_at),
    durationMs: row.duration_ms === null ? undefined : Number(row.duration_ms),
    inputTokens: row.input_tokens === null ? undefined : Number(row.input_tokens),
    outputTokens: row.output_tokens === null ? undefined : Number(row.output_tokens),
    cacheReadTokens: row.cache_read_tokens === null ? undefined : Number(row.cache_read_tokens),
    cacheWriteTokens: row.cache_write_tokens === null ? undefined : Number(row.cache_write_tokens),
    reasoningTokens: row.reasoning_tokens === null ? undefined : Number(row.reasoning_tokens),
    totalTokens: row.total_tokens === null ? undefined : Number(row.total_tokens),
    estimatedCostUsd: row.estimated_cost_microusd === null ? undefined : usd(Number(row.estimated_cost_microusd)),
    costSource: String(row.cost_source), pricingSnapshot,
    errorSummary: row.error_summary ? String(row.error_summary) : undefined,
  };
}

export function listAiUsageEvents(query: AiUsageQuery & { limit?: number; before?: { startedAt: number; id: string } }) {
  const { sql, values } = queryWhere(query);
  const clauses = [sql];
  if (query.before) {
    clauses.push('(started_at < ? OR (started_at = ? AND id < ?))');
    values.push(query.before.startedAt, query.before.startedAt, query.before.id);
  }
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));
  const rows = getSqliteDatabase().prepare(`SELECT * FROM ai_usage_events WHERE ${clauses.join(' AND ')}
    ORDER BY started_at DESC, id DESC LIMIT ?`).all(...values, limit + 1) as UsageRow[];
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(eventFromRow);
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? `${last.startedAt}:${last.id}` : undefined };
}

export function getAiUsageEventView(id: string) {
  const row = getAiUsageEvent(id) as UsageRow | undefined;
  return row ? eventFromRow(row) : undefined;
}

export function listAiUsageTrace(traceId: string) {
  return (getSqliteDatabase().prepare(`SELECT * FROM ai_usage_events WHERE trace_id = ?
    ORDER BY started_at ASC, id ASC`).all(traceId) as UsageRow[]).map(eventFromRow);
}

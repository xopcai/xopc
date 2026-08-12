import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

import type { EventEnvelope } from '../events/types.js';
import type { ScenarioRoute } from './types.js';

export interface SignalBatch {
  id: string;
  subscriptionId?: string;
  scenarioKey: string;
  scenarioVersion: number;
  aggregationKey: string;
  windowStartedAt: string;
  windowEndsAt: string;
  readyAt: string;
  status: 'collecting' | 'ready' | 'processing' | 'processed' | 'ignored' | 'failed_retryable' | 'failed_permanent' | 'expired';
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

interface BatchRow {
  batch_id: string;
  subscription_id: string;
  scenario_key: string;
  scenario_version: number;
  aggregation_key: string;
  window_started_at: string;
  window_ends_at: string;
  ready_at: string;
  status: SignalBatch['status'];
  event_count: number;
  created_at: string;
  updated_at: string;
}

function fromRow(row: BatchRow): SignalBatch {
  return {
    id: row.batch_id,
    ...(row.subscription_id ? { subscriptionId: row.subscription_id } : {}),
    scenarioKey: row.scenario_key,
    scenarioVersion: row.scenario_version,
    aggregationKey: row.aggregation_key,
    windowStartedAt: row.window_started_at,
    windowEndsAt: row.window_ends_at,
    readyAt: row.ready_at,
    status: row.status,
    eventCount: row.event_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function addEventToBatch(input: {
  event: EventEnvelope;
  scenario: ScenarioRoute;
  aggregationKey: string;
  now?: Date;
}): SignalBatch {
  return runSqliteWriteTransaction((db) => {
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    let existing = db.prepare(
      `SELECT * FROM proactive_signal_batches
       WHERE subscription_id = ? AND scenario_key = ? AND aggregation_key = ? AND status = 'collecting'`,
    ).get(input.scenario.subscriptionId ?? '', input.scenario.key, input.aggregationKey) as unknown as BatchRow | undefined;
    if (existing && Date.parse(existing.window_ends_at) <= now.getTime()) {
      db.prepare("UPDATE proactive_signal_batches SET status = 'ready', updated_at = ? WHERE batch_id = ?")
        .run(nowIso, existing.batch_id);
      existing = undefined;
    }
    const batchId = existing?.batch_id ?? randomUUID();
    if (!existing) {
      const windowEnd = new Date(now.getTime() + input.scenario.maxWindowSeconds * 1_000).toISOString();
      const readyAt = new Date(Math.min(
        Date.parse(windowEnd),
        now.getTime() + input.scenario.debounceSeconds * 1_000,
      )).toISOString();
      db.prepare(`INSERT INTO proactive_signal_batches (
        batch_id, subscription_id, scenario_key, scenario_version, aggregation_key, window_started_at,
        window_ends_at, ready_at, status, event_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', 0, ?, ?)`)
        .run(batchId, input.scenario.subscriptionId ?? '', input.scenario.key, input.scenario.version, input.aggregationKey, nowIso, windowEnd, readyAt, nowIso, nowIso);
    } else {
      const readyAt = new Date(Math.min(
        Date.parse(existing.window_ends_at),
        now.getTime() + input.scenario.debounceSeconds * 1_000,
      )).toISOString();
      db.prepare(`UPDATE proactive_signal_batches
        SET ready_at = ?, scenario_version = ?, updated_at = ? WHERE batch_id = ?`)
        .run(readyAt, input.scenario.version, nowIso, batchId);
    }
    const inserted = db.prepare(
      'INSERT OR IGNORE INTO proactive_batch_events (batch_id, event_id, added_at) VALUES (?, ?, ?)',
    ).run(batchId, input.event.id, nowIso);
    if (inserted.changes === 1) {
      db.prepare('UPDATE proactive_signal_batches SET event_count = event_count + 1, updated_at = ? WHERE batch_id = ?')
        .run(nowIso, batchId);
    }
    return fromRow(db.prepare('SELECT * FROM proactive_signal_batches WHERE batch_id = ?').get(batchId) as unknown as BatchRow);
  });
}

export function markReadyBatches(now = new Date()): number {
  return runSqliteWriteTransaction((db) => Number(db.prepare(
    `UPDATE proactive_signal_batches SET status = 'ready', updated_at = ?
     WHERE status = 'collecting' AND ready_at <= ?`,
  ).run(now.toISOString(), now.toISOString()).changes));
}

export function listBatches(input: { status?: SignalBatch['status']; limit?: number } = {}): SignalBatch[] {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const rows = input.status
    ? getSqliteDatabase().prepare('SELECT * FROM proactive_signal_batches WHERE status = ? ORDER BY updated_at DESC LIMIT ?').all(input.status, limit)
    : getSqliteDatabase().prepare('SELECT * FROM proactive_signal_batches ORDER BY updated_at DESC LIMIT ?').all(limit);
  return (rows as unknown as BatchRow[]).map(fromRow);
}

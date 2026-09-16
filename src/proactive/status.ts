import type { ProactiveCheckStatus } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { effectiveProactivePolicy } from './policy/service.js';

export function followUpCheckStatus(subscriptionId: string, project: boolean): ProactiveCheckStatus {
  const db = getSqliteDatabase();
  const recent = db.prepare(`SELECT run_id AS id, status, outcome_reason AS outcome, started_at AS startedAt,
    completed_at AS completedAt, next_attempt_at AS retryAt, attempt FROM proactive_runs
    WHERE subscription_id = ? ORDER BY started_at DESC LIMIT 5`).all(subscriptionId) as unknown as ProactiveCheckStatus['recent'];
  const schedule = project ? db.prepare('SELECT last_checked_at, next_due_at FROM proactive_schedule_state WHERE subscription_id = ?').get(subscriptionId) as { last_checked_at: string | null; next_due_at: string } | undefined : undefined;
  const pending = db.prepare("SELECT status FROM proactive_signal_batches WHERE subscription_id = ? AND status IN ('collecting', 'ready', 'processing') ORDER BY created_at DESC LIMIT 1").get(subscriptionId) as { status: string } | undefined;
  const latest = recent[0];
  const enabled = effectiveProactivePolicy(subscriptionId).enabled;
  const health = !enabled ? 'waiting' : pending?.status === 'processing' ? 'running' : pending ? 'queued'
    : latest?.status === 'retryable' ? 'retrying' : latest?.status === 'failed' || latest?.outcome === 'source_unavailable' || latest?.outcome === 'source_stale' ? 'blocked' : 'waiting';
  return { health, recent, lastCheckedAt: schedule?.last_checked_at ?? recent.find(run => run.status === 'completed')?.completedAt ?? null,
    nextCheckAt: !enabled ? null : latest?.status === 'retryable' ? latest.retryAt : schedule?.next_due_at ?? null };
}

import { createHash, randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

import type { ContextSnapshot, InsightCandidate, ProactiveInsight } from './types.js';

type Row = Record<string, unknown>;
const str = (row: Row, key: string) => String(row[key]);

export interface ClaimedRun {
  id: string; batchId: string; subscriptionId: string; scenarioKey: string; scenarioVersion: number;
  promptRevisionId?: string; attempt: number;
}

export function claimNextRun(owner: string, now = new Date(), leaseSeconds = 120): ClaimedRun | null {
  return runSqliteWriteTransaction((db) => {
    const nowIso = now.toISOString();
    db.prepare(`UPDATE proactive_signal_batches SET status = 'ignored', updated_at = ? WHERE status = 'ready'
      AND subscription_id IN (SELECT subscription_id FROM proactive_scenario_subscriptions WHERE enabled = 0)`).run(nowIso);
    db.prepare(`UPDATE proactive_signal_batches SET status = 'failed_permanent', updated_at = ?
      WHERE status = 'processing' AND batch_id IN (
        SELECT batch_id FROM proactive_runs WHERE status = 'running' AND lease_expires_at <= ? AND attempt >= 3
      )`).run(nowIso, nowIso);
    db.prepare(`UPDATE proactive_runs SET status = 'failed', error_message = 'Lease expired after maximum attempts',
      lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE status = 'running' AND lease_expires_at <= ? AND attempt >= 3`).run(nowIso, nowIso);
    const retry = db.prepare(`SELECT * FROM proactive_runs WHERE status = 'retryable' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 1`).get(nowIso) as Row | undefined;
    if (retry) {
      db.prepare(`UPDATE proactive_runs SET status = 'running', attempt = attempt + 1, lease_owner = ?, lease_expires_at = ?, next_attempt_at = NULL, updated_at = ? WHERE run_id = ?`)
        .run(owner, new Date(now.getTime() + leaseSeconds * 1000).toISOString(), nowIso, str(retry, 'run_id'));
      db.prepare("UPDATE proactive_signal_batches SET status = 'processing', updated_at = ? WHERE batch_id = ?").run(nowIso, str(retry, 'batch_id'));
      return runFromRow(db.prepare('SELECT * FROM proactive_runs WHERE run_id = ?').get(str(retry, 'run_id')) as Row);
    }
    const expired = db.prepare(`SELECT * FROM proactive_runs WHERE status = 'running' AND lease_expires_at <= ? AND attempt < 3 ORDER BY updated_at LIMIT 1`).get(nowIso) as Row | undefined;
    if (expired) {
      db.prepare(`UPDATE proactive_runs SET attempt = attempt + 1, lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE run_id = ?`)
        .run(owner, new Date(now.getTime() + leaseSeconds * 1000).toISOString(), nowIso, str(expired, 'run_id'));
      const row = db.prepare('SELECT * FROM proactive_runs WHERE run_id = ?').get(str(expired, 'run_id')) as Row;
      return runFromRow(row);
    }
    const batch = db.prepare(`SELECT b.*, s.active_prompt_revision_id FROM proactive_signal_batches b
      JOIN proactive_scenario_subscriptions s ON s.subscription_id = b.subscription_id
      WHERE b.status = 'ready' ORDER BY b.ready_at LIMIT 1`).get() as Row | undefined;
    if (!batch) return null;
    const id = randomUUID();
    db.prepare(`INSERT INTO proactive_runs (run_id, batch_id, subscription_id, scenario_key, scenario_version,
      prompt_revision_id, status, attempt, lease_owner, lease_expires_at, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'running', 1, ?, ?, ?, ?)`)
      .run(id, str(batch, 'batch_id'), str(batch, 'subscription_id'), str(batch, 'scenario_key'), Number(batch.scenario_version),
        batch.active_prompt_revision_id ? String(batch.active_prompt_revision_id) : null, owner, new Date(now.getTime() + leaseSeconds * 1000).toISOString(), nowIso, nowIso);
    db.prepare("UPDATE proactive_signal_batches SET status = 'processing', updated_at = ? WHERE batch_id = ?").run(nowIso, str(batch, 'batch_id'));
    return runFromRow(db.prepare('SELECT * FROM proactive_runs WHERE run_id = ?').get(id) as Row);
  });
}

function runFromRow(row: Row): ClaimedRun {
  return { id: str(row, 'run_id'), batchId: str(row, 'batch_id'), subscriptionId: str(row, 'subscription_id'),
    scenarioKey: str(row, 'scenario_key'), scenarioVersion: Number(row.scenario_version), attempt: Number(row.attempt),
    ...(row.prompt_revision_id ? { promptRevisionId: str(row, 'prompt_revision_id') } : {}) };
}

export function eventIdsForBatch(batchId: string): string[] {
  return (getSqliteDatabase().prepare('SELECT event_id FROM proactive_batch_events WHERE batch_id = ? ORDER BY added_at DESC LIMIT 100').all(batchId) as { event_id: string }[]).map((row) => row.event_id);
}

export function saveSnapshot(batchId: string, content: Record<string, unknown>, evidenceIds: string[], now = new Date()): ContextSnapshot {
  const snapshot: ContextSnapshot = { id: randomUUID(), batchId, content, evidenceIds, createdAt: now.toISOString() };
  runSqliteWriteTransaction((db) => db.prepare(`INSERT INTO proactive_context_snapshots
    (snapshot_id, batch_id, content_json, evidence_ids_json, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(snapshot.id, batchId, JSON.stringify(content), JSON.stringify(evidenceIds), snapshot.createdAt));
  return snapshot;
}

export function attachSnapshot(runId: string, snapshotId: string): void {
  runSqliteWriteTransaction((db) => db.prepare('UPDATE proactive_runs SET context_snapshot_id = ?, updated_at = ? WHERE run_id = ?')
    .run(snapshotId, new Date().toISOString(), runId));
}

export function finishRun(input: { run: ClaimedRun; candidate?: InsightCandidate; valueScore?: number; rawOutput: string; modelRef?: string }, now = new Date()): ProactiveInsight | null {
  return runSqliteWriteTransaction((db) => {
    const nowIso = now.toISOString();
    const subjectScope = (db.prepare(`SELECT DISTINCT e.subject_kind, e.subject_id
      FROM proactive_batch_events be
      JOIN proactive_events e ON e.event_id = be.event_id
      WHERE be.batch_id = ?
      ORDER BY e.subject_kind, e.subject_id`).all(input.run.batchId) as Row[])
      .map((row) => `${str(row, 'subject_kind')}:${str(row, 'subject_id')}`);
    const fingerprint = input.candidate
      ? createHash('sha256').update([
        ...subjectScope,
        ...[
          input.candidate.title,
          input.candidate.summary,
          input.candidate.recommendation,
        ].map((value) => value.trim().toLowerCase().replace(/\s+/g, ' ')),
      ].join('\n')).digest('hex')
      : undefined;
    const duplicate = fingerprint ? db.prepare(`SELECT 1 FROM proactive_insights
      WHERE subscription_id = ? AND scenario_key = ? AND content_fingerprint = ? AND created_at >= ? LIMIT 1`)
      .get(
        input.run.subscriptionId,
        input.run.scenarioKey,
        fingerprint,
        new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString(),
      ) : undefined;
    const valuable = Boolean(input.candidate) && !duplicate;
    db.prepare(`UPDATE proactive_runs SET status = ?, raw_output = ?, model_ref = ?, lease_owner = NULL,
      lease_expires_at = NULL, completed_at = ?, updated_at = ? WHERE run_id = ?`)
      .run(valuable ? 'completed' : 'discarded', input.rawOutput.slice(0, 20_000), input.modelRef ?? null, nowIso, nowIso, input.run.id);
    db.prepare(`UPDATE proactive_signal_batches SET status = ?, updated_at = ? WHERE batch_id = ?`)
      .run(valuable ? 'processed' : 'ignored', nowIso, input.run.batchId);
    if (!input.candidate || duplicate) return null;
    const insight: ProactiveInsight = { ...input.candidate, id: randomUUID(), runId: input.run.id,
      subscriptionId: input.run.subscriptionId, scenarioKey: input.run.scenarioKey, valueScore: input.valueScore ?? 0, createdAt: nowIso };
    db.prepare(`INSERT INTO proactive_insights (insight_id, run_id, subscription_id, scenario_key, title, summary,
      why_now, impact, recommendation, work_done, decision_json, proposed_action_json, urgency, confidence, value_score,
      evidence_ids_json, content_fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(insight.id, insight.runId, insight.subscriptionId, insight.scenarioKey, insight.title, insight.summary,
        insight.whyNow, insight.impact, insight.recommendation, insight.workDone, insight.decision ? JSON.stringify(insight.decision) : null,
        insight.proposedAction ? JSON.stringify(insight.proposedAction) : null,
        insight.urgency, insight.confidence, insight.valueScore,
        JSON.stringify(insight.evidenceIds), fingerprint, insight.createdAt);
    return insight;
  });
}

export function failRun(run: ClaimedRun, error: unknown, retryable: boolean, now = new Date()): void {
  runSqliteWriteTransaction((db) => {
    const finalRetryable = retryable && run.attempt < 3;
    const nowIso = now.toISOString();
    const nextAttemptAt = finalRetryable ? new Date(now.getTime() + 15_000 * run.attempt).toISOString() : null;
    db.prepare(`UPDATE proactive_runs SET status = ?, error_message = ?, lease_owner = NULL, lease_expires_at = NULL, next_attempt_at = ?, updated_at = ? WHERE run_id = ?`)
      .run(finalRetryable ? 'retryable' : 'failed', String(error instanceof Error ? error.message : error).slice(0, 2000), nextAttemptAt, nowIso, run.id);
    db.prepare(`UPDATE proactive_signal_batches SET status = ?, updated_at = ? WHERE batch_id = ?`)
      .run(finalRetryable ? 'failed_retryable' : 'failed_permanent', nowIso, run.batchId);
  });
}

export function listInsights(limit = 50): ProactiveInsight[] {
  return (getSqliteDatabase().prepare('SELECT * FROM proactive_insights ORDER BY created_at DESC LIMIT ?').all(Math.min(200, Math.max(1, limit))) as Row[]).map((row) => ({
    id: str(row, 'insight_id'), runId: str(row, 'run_id'), subscriptionId: str(row, 'subscription_id'), scenarioKey: str(row, 'scenario_key'),
    title: str(row, 'title'), summary: str(row, 'summary'), whyNow: str(row, 'why_now'), impact: str(row, 'impact'),
    recommendation: str(row, 'recommendation'), workDone: str(row, 'work_done'),
    ...(row.decision_json ? { decision: JSON.parse(str(row, 'decision_json')) as NonNullable<ProactiveInsight['decision']> } : {}),
    ...(row.proposed_action_json ? { proposedAction: JSON.parse(str(row, 'proposed_action_json')) as NonNullable<ProactiveInsight['proposedAction']> } : {}),
    urgency: str(row, 'urgency') as ProactiveInsight['urgency'], confidence: Number(row.confidence),
    valueScore: Number(row.value_score),
    ...(row.disposition ? { disposition: str(row, 'disposition') as NonNullable<ProactiveInsight['disposition']> } : {}),
    ...(row.disposition_reason ? { dispositionReason: str(row, 'disposition_reason') } : {}),
    ...(row.action_status ? { actionStatus: str(row, 'action_status') as NonNullable<ProactiveInsight['actionStatus']> } : {}),
    ...(row.action_result_json ? { actionResult: JSON.parse(str(row, 'action_result_json')) as Record<string, unknown> } : {}),
    ...(row.action_error ? { actionError: str(row, 'action_error') } : {}),
    evidenceIds: JSON.parse(str(row, 'evidence_ids_json')) as string[], createdAt: str(row, 'created_at'),
  }));
}

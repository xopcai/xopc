import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { USER_MODEL_PRINCIPAL_ID } from '../user-model/domain.js';

export type MemoryMaintenanceJob =
  | 'temporal_sweep'
  | 'daily_reconciliation'
  | 'weekly_knowledge'
  | 'manual_repair';

export interface MemoryMaintenanceMetrics {
  scanned: number;
  stale: number;
  needsReview: number;
  activated: number;
  expiredPriorities: number;
  expiredObservations: number;
  archived: number;
  repairedIndexes: number;
}

export interface MemoryMaintenanceResult {
  runId: string;
  jobType: MemoryMaintenanceJob;
  status: 'running' | 'completed' | 'failed';
  skipped: boolean;
  metrics: MemoryMaintenanceMetrics;
}

export interface RunMemoryMaintenanceInput {
  jobType: MemoryMaintenanceJob;
  principalId?: string;
  now?: number;
  idempotencyKey?: string;
  limit?: number;
  staleRetentionDays?: number;
  evidenceThreshold?: number;
}

const ALGORITHM_VERSION = 'user-model-maintenance-v2';

function emptyMetrics(): MemoryMaintenanceMetrics {
  return {
    scanned: 0,
    stale: 0,
    needsReview: 0,
    activated: 0,
    expiredPriorities: 0,
    expiredObservations: 0,
    archived: 0,
    repairedIndexes: 0,
  };
}

function periodKey(job: MemoryMaintenanceJob, now: number): string {
  const date = new Date(now);
  if (job === 'temporal_sweep') return date.toISOString().slice(0, 13);
  if (job === 'daily_reconciliation') return date.toISOString().slice(0, 10);
  if (job === 'weekly_knowledge') {
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = monday.getUTCDay() || 7;
    monday.setUTCDate(monday.getUTCDate() - day + 1);
    return monday.toISOString().slice(0, 10);
  }
  return String(now);
}

function addDecision(
  db: DatabaseSync,
  runId: string,
  objectType: 'assertion' | 'goal' | 'priority' | 'knowledge' | 'evidence' | 'index',
  objectId: string,
  action: string,
  reason: string,
  before: unknown,
  after: unknown,
  now: number,
): void {
  db.prepare(`INSERT INTO memory_maintenance_decisions (
    decision_id, run_id, object_type, object_id, action, reason, before_json, after_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), runId, objectType, objectId, action, reason,
      before === undefined ? null : JSON.stringify(before),
      after === undefined ? null : JSON.stringify(after), now);
}

function purgeExpiredObservations(
  db: DatabaseSync,
  runId: string,
  principalId: string,
  now: number,
  limit: number,
  metrics: MemoryMaintenanceMetrics,
): void {
  const rows = db.prepare(`SELECT observation_id, delete_after FROM user_model_observations
    WHERE principal_id = ? AND delete_after IS NOT NULL AND delete_after <= ?
    ORDER BY delete_after, observation_id LIMIT ?`)
    .all(principalId, now, limit) as Array<{ observation_id: string; delete_after: number }>;
  metrics.scanned += rows.length;
  for (const row of rows) {
    db.prepare('DELETE FROM user_model_observations WHERE observation_id = ?').run(row.observation_id);
    addDecision(db, runId, 'evidence', row.observation_id, 'deleted', 'observation_retention_expired', row,
      undefined, now);
    metrics.expiredObservations += 1;
  }
}

function transitionAssertions(
  db: DatabaseSync,
  runId: string,
  principalId: string,
  now: number,
  limit: number,
  metrics: MemoryMaintenanceMetrics,
): void {
  const rows = db.prepare(`SELECT a.assertion_id, a.status FROM user_assertions a
    JOIN user_assertion_slots s ON s.slot_id = a.slot_id
    WHERE s.principal_id = ? AND a.status IN ('active', 'candidate', 'needs_review')
      AND ((a.valid_to IS NOT NULL AND a.valid_to < ?)
        OR (a.review_at IS NOT NULL AND a.review_at <= ?))
    ORDER BY COALESCE(a.valid_to, a.review_at), a.assertion_id LIMIT ?`)
    .all(principalId, now, now, limit) as Array<{ assertion_id: string; status: string }>;
  metrics.scanned += rows.length;
  for (const row of rows) {
    db.prepare("UPDATE user_assertions SET status = 'stale' WHERE assertion_id = ?").run(row.assertion_id);
    db.prepare(`INSERT INTO user_assertion_status_events (
      event_id, assertion_id, from_status, to_status, actor_type, reason, source_run_id, created_at
    ) VALUES (?, ?, ?, 'stale', 'maintenance', 'No current supporting evidence at review time.', ?, ?)`)
      .run(randomUUID(), row.assertion_id, row.status, runId, now);
    addDecision(db, runId, 'assertion', row.assertion_id, 'stale', 'validity_or_review_ended', row,
      { status: 'stale' }, now);
    metrics.stale += 1;
  }
}

function transitionPriorities(
  db: DatabaseSync,
  runId: string,
  principalId: string,
  now: number,
  limit: number,
  metrics: MemoryMaintenanceMetrics,
): void {
  const rows = db.prepare(`SELECT priority_id, status, valid_to FROM user_priority_windows
    WHERE principal_id = ? AND status = 'active' AND valid_to < ? LIMIT ?`)
    .all(principalId, now, limit) as Array<{ priority_id: string; status: string; valid_to: number }>;
  metrics.scanned += rows.length;
  for (const row of rows) {
    db.prepare("UPDATE user_priority_windows SET status = 'expired', updated_at = ? WHERE priority_id = ?")
      .run(now, row.priority_id);
    addDecision(db, runId, 'priority', row.priority_id, 'expired', 'priority_window_ended', row,
      { status: 'expired' }, now);
    metrics.expiredPriorities += 1;
  }
}

function transitionKnowledge(
  db: DatabaseSync,
  runId: string,
  principalId: string,
  now: number,
  limit: number,
  metrics: MemoryMaintenanceMetrics,
): void {
  const expired = db.prepare(`SELECT knowledge_id, status, expires_at FROM knowledge_items
    WHERE principal_id = ? AND status IN ('active', 'candidate') AND expires_at IS NOT NULL AND expires_at < ? LIMIT ?`)
    .all(principalId, now, limit) as Array<{ knowledge_id: string; status: string; expires_at: number }>;
  metrics.scanned += expired.length;
  for (const row of expired) {
    db.prepare("UPDATE knowledge_items SET status = 'stale', updated_at = ? WHERE knowledge_id = ?")
      .run(now, row.knowledge_id);
    addDecision(db, runId, 'knowledge', row.knowledge_id, 'stale', 'retention_expired', row,
      { status: 'stale' }, now);
    metrics.stale += 1;
  }

  const reviewDue = db.prepare(`SELECT knowledge_id, status, review_at FROM knowledge_items
    WHERE principal_id = ? AND status IN ('active', 'candidate', 'needs_review') AND review_at IS NOT NULL AND review_at <= ? LIMIT ?`)
    .all(principalId, now, Math.max(0, limit - expired.length)) as Array<{
      knowledge_id: string; status: string; review_at: number;
    }>;
  metrics.scanned += reviewDue.length;
  for (const row of reviewDue) {
    db.prepare("UPDATE knowledge_items SET status = 'stale', updated_at = ? WHERE knowledge_id = ?")
      .run(now, row.knowledge_id);
    addDecision(db, runId, 'knowledge', row.knowledge_id, 'stale', 'review_due', row,
      { status: 'stale' }, now);
    metrics.stale += 1;
  }
}

function reconcileEvidence(
  db: DatabaseSync,
  runId: string,
  principalId: string,
  now: number,
  limit: number,
  evidenceThreshold: number,
  metrics: MemoryMaintenanceMetrics,
): void {
  const contradicted = db.prepare(`SELECT DISTINCT a.assertion_id, a.status
    FROM user_assertions a
    JOIN user_assertion_slots s ON s.slot_id = a.slot_id
    JOIN user_assertion_evidence ae ON ae.assertion_id = a.assertion_id AND ae.relation = 'contradicts'
    JOIN context_evidence e ON e.evidence_id = ae.evidence_id
    WHERE s.principal_id = ? AND a.status = 'active'
      AND e.trust_level = 'owner' AND e.source_type IN ('conversation', 'user')
      AND e.observed_at > a.observed_at AND ae.confidence >= 0.7 LIMIT ?`)
    .all(principalId, limit) as Array<{ assertion_id: string; status: string }>;
  metrics.scanned += contradicted.length;
  for (const row of contradicted) {
    db.prepare("UPDATE user_assertions SET status = 'needs_review' WHERE assertion_id = ?")
      .run(row.assertion_id);
    db.prepare(`INSERT INTO user_assertion_status_events (
      event_id, assertion_id, from_status, to_status, actor_type, reason, source_run_id, created_at
    ) VALUES (?, ?, 'active', 'needs_review', 'maintenance', 'Contradictory evidence exists.', ?, ?)`)
      .run(randomUUID(), row.assertion_id, runId, now);
    addDecision(db, runId, 'assertion', row.assertion_id, 'needs_review', 'contradictory_evidence', row,
      { status: 'needs_review' }, now);
    metrics.needsReview += 1;
  }

  const candidates = db.prepare(`SELECT a.assertion_id, a.status,
      MIN(COUNT(DISTINCT COALESCE(e.content_hash, e.source_ref)),
        COUNT(DISTINCT e.source_type || ':' || COALESCE(e.source_instance_id, '') || ':' ||
          COALESCE(e.source_item_id, e.source_ref))) AS evidence_count
    FROM user_assertions a
    JOIN user_assertion_slots s ON s.slot_id = a.slot_id
    JOIN user_assertion_evidence ae ON ae.assertion_id = a.assertion_id AND ae.relation = 'supports'
    JOIN context_evidence e ON e.evidence_id = ae.evidence_id AND e.trust_level = 'owner'
    WHERE s.principal_id = ? AND a.status = 'candidate'
      AND a.authority IN ('user_observed', 'system_inferred')
      AND a.confidence >= 0.7 AND ae.confidence >= 0.7
      AND a.sensitivity = 'normal' AND a.consequence IN ('low', 'medium')
      AND a.disclosure_policy != 'ask_before_reference'
      AND e.source_type IN ('conversation', 'user', 'connector')
      AND (a.valid_from IS NULL OR a.valid_from <= ?)
      AND (a.valid_to IS NULL OR a.valid_to >= ?)
      AND (a.review_at IS NULL OR a.review_at > ?)
      AND NOT EXISTS (SELECT 1 FROM user_assertion_evidence bad
        WHERE bad.assertion_id = a.assertion_id AND bad.relation = 'contradicts')
      AND (s.cardinality = 'multiple' OR NOT EXISTS (
        SELECT 1 FROM user_assertions other WHERE other.slot_id = a.slot_id
          AND other.assertion_id != a.assertion_id AND other.status IN ('active', 'conflicted')
          AND other.normalized_value != a.normalized_value
          AND (other.valid_to IS NULL OR other.valid_to >= ?)))
    GROUP BY a.assertion_id HAVING evidence_count >= ? ORDER BY a.recorded_at LIMIT ?`)
    .all(principalId, now, now, now, now, evidenceThreshold, limit) as Array<{
      assertion_id: string; status: string; evidence_count: number;
    }>;
  metrics.scanned += candidates.length;
  for (const row of candidates) {
    db.prepare("UPDATE user_assertions SET status = 'active' WHERE assertion_id = ? AND status = 'candidate'")
      .run(row.assertion_id);
    db.prepare(`INSERT INTO user_assertion_status_events (
      event_id, assertion_id, from_status, to_status, actor_type, reason, source_run_id, created_at
    ) VALUES (?, ?, 'candidate', 'active', 'maintenance', 'Independent owner evidence threshold met.', ?, ?)`)
      .run(randomUUID(), row.assertion_id, runId, now);
    addDecision(db, runId, 'assertion', row.assertion_id, 'activated', 'owner_evidence_threshold', row,
      { status: 'active' }, now);
    metrics.activated += 1;
  }
}

function activateKnowledge(db: DatabaseSync, runId: string, principalId: string, now: number, limit: number, metrics: MemoryMaintenanceMetrics): void {
  const rows = db.prepare(`SELECT knowledge_id FROM knowledge_items
    WHERE principal_id = ? AND record_class = 'memory' AND status = 'candidate'
      AND origin_class IN ('owner', 'agent', 'system') AND confidence >= 0.7
      AND derived_from_recalled_context = 0
      AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to >= ?)
      AND (expires_at IS NULL OR expires_at >= ?) AND (review_at IS NULL OR review_at > ?)
    ORDER BY created_at, knowledge_id LIMIT ?`).all(principalId, now, now, now, now, limit) as Array<{ knowledge_id: string }>;
  metrics.scanned += rows.length;
  for (const row of rows) {
    db.prepare("UPDATE knowledge_items SET status = 'active', updated_at = ? WHERE knowledge_id = ?").run(now, row.knowledge_id);
    db.prepare(`INSERT INTO knowledge_item_status_events
      (event_id, knowledge_id, from_status, to_status, actor_type, reason, created_at)
      VALUES (?, ?, 'candidate', 'active', 'maintenance', 'Eligible scoped memory activated automatically.', ?)`)
      .run(randomUUID(), row.knowledge_id, now);
    addDecision(db, runId, 'knowledge', row.knowledge_id, 'activated', 'eligible_scoped_memory',
      { status: 'candidate' }, { status: 'active' }, now);
    metrics.activated += 1;
  }
}

function repairIndexes(
  db: DatabaseSync,
  runId: string,
  now: number,
  metrics: MemoryMaintenanceMetrics,
): void {
  const assertionMissing = db.prepare(`SELECT COUNT(*) AS count FROM user_assertions a
    LEFT JOIN user_assertions_fts f ON f.assertion_id = a.assertion_id
    WHERE f.assertion_id IS NULL`).get() as { count: number };
  const knowledgeMissing = db.prepare(`SELECT COUNT(*) AS count FROM knowledge_items k
    LEFT JOIN knowledge_items_fts f ON f.knowledge_id = k.knowledge_id
    WHERE f.knowledge_id IS NULL`).get() as { count: number };
  if (assertionMissing.count) {
    db.prepare(`INSERT INTO user_assertions_fts(statement, assertion_id, slot_id)
      SELECT a.statement, a.assertion_id, a.slot_id FROM user_assertions a
      LEFT JOIN user_assertions_fts f ON f.assertion_id = a.assertion_id WHERE f.assertion_id IS NULL`).run();
  }
  if (knowledgeMissing.count) {
    db.prepare(`INSERT INTO knowledge_items_fts(content, knowledge_id)
      SELECT k.content, k.knowledge_id FROM knowledge_items k
      LEFT JOIN knowledge_items_fts f ON f.knowledge_id = k.knowledge_id WHERE f.knowledge_id IS NULL`).run();
  }
  metrics.repairedIndexes = assertionMissing.count + knowledgeMissing.count;
  if (metrics.repairedIndexes) {
    addDecision(db, runId, 'index', 'fts', 'repair', 'missing_index_rows',
      { missing: metrics.repairedIndexes }, { missing: 0 }, now);
  }
}

function archiveOldKnowledge(
  db: DatabaseSync,
  runId: string,
  principalId: string,
  cutoff: number,
  now: number,
  limit: number,
  metrics: MemoryMaintenanceMetrics,
): void {
  const rows = db.prepare(`SELECT knowledge_id, status, updated_at FROM knowledge_items
    WHERE principal_id = ? AND status = 'stale' AND updated_at < ? LIMIT ?`)
    .all(principalId, cutoff, limit) as Array<{ knowledge_id: string; status: string; updated_at: number }>;
  metrics.scanned += rows.length;
  for (const row of rows) {
    db.prepare("UPDATE knowledge_items SET status = 'archived', updated_at = ? WHERE knowledge_id = ?")
      .run(now, row.knowledge_id);
    addDecision(db, runId, 'knowledge', row.knowledge_id, 'archived', 'stale_retention_elapsed', row,
      { status: 'archived' }, now);
    metrics.archived += 1;
  }
}

export function runMemoryMaintenance(input: RunMemoryMaintenanceInput): MemoryMaintenanceResult {
  const now = input.now ?? Date.now();
  const principalId = input.principalId ?? USER_MODEL_PRINCIPAL_ID;
  const limit = Math.max(1, Math.min(10_000, input.limit ?? 1_000));
  const evidenceThreshold = Math.max(2, Math.min(10, input.evidenceThreshold ?? 2));
  const idempotencyKey = input.idempotencyKey
    ?? `${principalId}:${input.jobType}:${periodKey(input.jobType, now)}`;
  const existing = getSqliteDatabase().prepare(`SELECT run_id, status, metrics_json
    FROM memory_maintenance_runs WHERE idempotency_key = ?`).get(idempotencyKey) as
    { run_id: string; status: 'running' | 'completed' | 'failed'; metrics_json: string } | undefined;
  if (existing && existing.status !== 'failed') {
    return {
      runId: existing.run_id,
      jobType: input.jobType,
      status: existing.status,
      skipped: true,
      metrics: JSON.parse(existing.metrics_json),
    };
  }

  const runId = existing?.run_id ?? randomUUID();
  const metrics = emptyMetrics();
  const snapshot = JSON.stringify({
    limit,
    staleRetentionDays: input.staleRetentionDays ?? 30,
    evidenceThreshold,
  });
  runSqliteWriteTransaction((db) => {
    if (existing) {
      db.prepare(`UPDATE memory_maintenance_runs SET status = 'running', config_snapshot_json = ?,
        cursor_json = '{}', metrics_json = '{}', error_message = NULL, started_at = ?, finished_at = NULL
        WHERE run_id = ?`).run(snapshot, now, runId);
    } else {
      db.prepare(`INSERT INTO memory_maintenance_runs (
        run_id, principal_id, job_type, idempotency_key, algorithm_version,
        config_snapshot_json, status, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`)
        .run(runId, principalId, input.jobType, idempotencyKey, ALGORITHM_VERSION, snapshot, now);
    }
  });
  try {
    runSqliteWriteTransaction((db) => {
      transitionAssertions(db, runId, principalId, now, limit, metrics);
      transitionPriorities(db, runId, principalId, now, limit, metrics);
      transitionKnowledge(db, runId, principalId, now, limit, metrics);
      purgeExpiredObservations(db, runId, principalId, now, limit, metrics);
      if (input.jobType === 'daily_reconciliation' || input.jobType === 'manual_repair') {
        reconcileEvidence(db, runId, principalId, now, limit, evidenceThreshold, metrics);
        activateKnowledge(db, runId, principalId, now, limit, metrics);
        repairIndexes(db, runId, now, metrics);
      }
      if (input.jobType === 'weekly_knowledge' || input.jobType === 'manual_repair') {
        const cutoff = now - (input.staleRetentionDays ?? 30) * 24 * 60 * 60 * 1_000;
        archiveOldKnowledge(db, runId, principalId, cutoff, now, limit, metrics);
      }
      db.prepare(`UPDATE memory_maintenance_runs SET status = 'completed', metrics_json = ?, finished_at = ?
        WHERE run_id = ?`).run(JSON.stringify(metrics), now, runId);
    });
    return { runId, jobType: input.jobType, status: 'completed', skipped: false, metrics };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getSqliteDatabase().prepare(`UPDATE memory_maintenance_runs SET status = 'failed',
      metrics_json = ?, error_message = ?, finished_at = ? WHERE run_id = ?`)
      .run(JSON.stringify(metrics), message, now, runId);
    throw error;
  }
}

export function listMemoryMaintenanceRuns(limit = 20): Array<Record<string, unknown>> {
  const rows = getSqliteDatabase().prepare(`SELECT run_id AS runId, principal_id AS principalId,
    job_type AS jobType, idempotency_key AS idempotencyKey, algorithm_version AS algorithmVersion,
    status, metrics_json AS metricsJson, error_message AS errorMessage,
    started_at AS startedAt, finished_at AS finishedAt
    FROM memory_maintenance_runs ORDER BY started_at DESC LIMIT ?`).all(
      Math.max(1, Math.min(100, limit)),
    ) as Array<Record<string, unknown>>;
  return rows.map(({ metricsJson, ...row }) => ({
    ...row,
    metrics: typeof metricsJson === 'string' ? JSON.parse(metricsJson) : {},
  }));
}

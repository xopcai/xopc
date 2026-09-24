import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { notifyUserContextChange } from '../changes.js';
import type {
  UnderstandingSourceGrant,
  UnderstandingSourceRun,
} from './types.js';
import { getActiveUnderstandingConsent, grantUnderstandingConsent } from './consent-repository.js';

type GrantRow = {
  grant_id: string; source_key: string; adapter_id: string; category: string; platform: string;
  display_name: string; status: string; access_mode: string; retention_policy: string;
  processing_policy: string; config_json: string; checkpoint_json: string;
  last_collected_at: number | null; created_at: number; updated_at: number;
};

type RunRow = {
  run_id: string; grant_id: string; connector_learning_job_id: string | null;
  kind: string; status: string; cursor_before: string | null;
  cursor_after: string | null; items_seen: number; metadata_json: string; error_message: string | null;
  started_at: number; completed_at: number | null;
};

function record(value: string): Record<string, unknown> {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function grantFromRow(row: GrantRow): UnderstandingSourceGrant {
  return {
    id: row.grant_id, sourceKey: row.source_key, adapterId: row.adapter_id,
    category: row.category as UnderstandingSourceGrant['category'],
    platform: row.platform as UnderstandingSourceGrant['platform'], displayName: row.display_name,
    status: row.status as UnderstandingSourceGrant['status'], accessMode: row.access_mode as UnderstandingSourceGrant['accessMode'],
    retentionPolicy: row.retention_policy as UnderstandingSourceGrant['retentionPolicy'],
    processingPolicy: row.processing_policy as UnderstandingSourceGrant['processingPolicy'],
    config: record(row.config_json), checkpoint: record(row.checkpoint_json),
    ...(row.last_collected_at == null ? {} : { lastCollectedAt: row.last_collected_at }),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function runFromRow(row: RunRow): UnderstandingSourceRun {
  return {
    id: row.run_id, grantId: row.grant_id, kind: row.kind as UnderstandingSourceRun['kind'],
    ...(row.connector_learning_job_id ? { connectorLearningJobId: row.connector_learning_job_id } : {}),
    status: row.status as UnderstandingSourceRun['status'],
    ...(row.cursor_before ? { cursorBefore: row.cursor_before } : {}),
    ...(row.cursor_after ? { cursorAfter: row.cursor_after } : {}),
    itemsSeen: row.items_seen, metadata: record(row.metadata_json),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    startedAt: row.started_at, ...(row.completed_at == null ? {} : { completedAt: row.completed_at }),
  };
}

export function listUnderstandingSourceGrants(options: { includeRevoked?: boolean } = {}): UnderstandingSourceGrant[] {
  const rows = getSqliteDatabase().prepare(
    `SELECT * FROM understanding_source_grants ${options.includeRevoked ? '' : "WHERE status = 'active'"} ORDER BY updated_at DESC`,
  ).all() as unknown as GrantRow[];
  return rows.map(grantFromRow);
}

export function getUnderstandingSourceGrant(id: string): UnderstandingSourceGrant | null {
  const row = getSqliteDatabase().prepare('SELECT * FROM understanding_source_grants WHERE grant_id = ?')
    .get(id) as GrantRow | undefined;
  return row ? grantFromRow(row) : null;
}

export function upsertUnderstandingSourceGrant(input: Omit<UnderstandingSourceGrant, 'id' | 'status' | 'checkpoint' | 'lastCollectedAt' | 'createdAt' | 'updatedAt'> & {
  checkpoint?: Record<string, unknown>; lastCollectedAt?: number; nowMs?: number;
}): UnderstandingSourceGrant {
  notifyUserContextChange({ kind: 'policy' });
  const id = randomUUID();
  const now = input.nowMs ?? Date.now();
  const existingRow = getSqliteDatabase().prepare('SELECT * FROM understanding_source_grants WHERE source_key = ?')
    .get(input.sourceKey) as unknown as GrantRow | undefined;
  const existing = existingRow ? grantFromRow(existingRow) : undefined;
  runSqliteWriteTransaction((db) => db.prepare(`
    INSERT INTO understanding_source_grants (
      grant_id, source_key, adapter_id, category, platform, display_name, status, access_mode,
      retention_policy, processing_policy, config_json, checkpoint_json, last_collected_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      adapter_id = excluded.adapter_id, category = excluded.category, platform = excluded.platform,
      display_name = excluded.display_name, status = 'active',
      config_json = excluded.config_json, checkpoint_json = excluded.checkpoint_json,
      last_collected_at = COALESCE(excluded.last_collected_at, understanding_source_grants.last_collected_at),
      updated_at = excluded.updated_at
  `).run(
    id, input.sourceKey, input.adapterId, input.category, input.platform, input.displayName,
    input.accessMode, input.retentionPolicy, input.processingPolicy, JSON.stringify(input.config),
    JSON.stringify(input.checkpoint ?? existing?.checkpoint ?? {}), input.lastCollectedAt ?? null, now, now,
  ));
  return grantFromRow(getSqliteDatabase().prepare('SELECT * FROM understanding_source_grants WHERE source_key = ?')
    .get(input.sourceKey) as unknown as GrantRow);
}

export function updateUnderstandingSourceGrantCheckpoint(id: string, input: {
  checkpoint?: Record<string, unknown>;
  lastCollectedAt?: number;
  nowMs?: number;
}): UnderstandingSourceGrant | null {
  const current = getUnderstandingSourceGrant(id);
  if (!current) return null;
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => db.prepare(`
    UPDATE understanding_source_grants
    SET checkpoint_json = ?, last_collected_at = ?, updated_at = ?
    WHERE grant_id = ?
  `).run(
    JSON.stringify(input.checkpoint ?? current.checkpoint),
    input.lastCollectedAt ?? current.lastCollectedAt ?? null,
    now,
    id,
  ));
  return getUnderstandingSourceGrant(id);
}

export function updateUnderstandingSourceGrantPolicies(id: string, patch: {
  accessMode?: UnderstandingSourceGrant['accessMode'];
  retentionPolicy?: UnderstandingSourceGrant['retentionPolicy'];
  processingPolicy?: UnderstandingSourceGrant['processingPolicy'];
  nowMs?: number;
}): UnderstandingSourceGrant | null {
  notifyUserContextChange({ kind: 'policy' });
  const current = getUnderstandingSourceGrant(id);
  if (!current) return null;
  const consent = getActiveUnderstandingConsent(id);
  runSqliteWriteTransaction((db) => db.prepare(`
    UPDATE understanding_source_grants
    SET access_mode = ?, retention_policy = ?, processing_policy = ?, updated_at = ?
    WHERE grant_id = ?
  `).run(
    patch.accessMode ?? current.accessMode,
    patch.retentionPolicy ?? current.retentionPolicy,
    patch.processingPolicy ?? current.processingPolicy,
    patch.nowMs ?? Date.now(),
    id,
  ));
  const updated = getUnderstandingSourceGrant(id);
  if (consent && updated && (
    updated.accessMode !== consent.accessMode
    || updated.processingPolicy !== consent.processingPolicy
    || (updated.retentionPolicy === 'bounded_raw' ? Math.max(1, consent.rawRetentionDays) : 0) !== consent.rawRetentionDays
  )) {
    grantUnderstandingConsent({
      grantId: id, purposes: consent.purposes, allowedDomains: consent.allowedDomains,
      deniedDomains: consent.deniedDomains, allowedFields: consent.allowedFields,
      accessMode: updated.accessMode, lookbackDays: consent.lookbackDays,
      rawRetentionDays: updated.retentionPolicy === 'bounded_raw' ? Math.max(1, consent.rawRetentionDays) : 0,
      processingPolicy: updated.processingPolicy, allowedAgentIds: consent.allowedAgentIds,
      disclosureVersion: consent.disclosureVersion, nowMs: patch.nowMs,
    });
  }
  return getUnderstandingSourceGrant(id);
}

export function revokeUnderstandingSourceGrant(id: string, nowMs = Date.now()): UnderstandingSourceGrant | null {
  notifyUserContextChange({ kind: 'policy' });
  const current = getUnderstandingSourceGrant(id);
  if (!current) return null;
  const configuredInstance = typeof current.config.sourceInstanceId === 'string'
    ? current.config.sourceInstanceId
    : undefined;
  const connectorId = typeof current.config.connectorId === 'string' ? current.config.connectorId : undefined;
  const accountId = typeof current.config.accountId === 'string' ? current.config.accountId : undefined;
  const sourceInstanceId = configuredInstance ?? (connectorId && accountId
    ? `composio:${connectorId}:${accountId}`
    : undefined);
  runSqliteWriteTransaction((db) => {
    db.prepare("UPDATE understanding_source_grants SET status = 'revoked', updated_at = ? WHERE grant_id = ?")
      .run(nowMs, id);
    db.prepare(`UPDATE understanding_consent_receipts SET revoked_at = ?
      WHERE grant_id = ? AND revoked_at IS NULL`).run(nowMs, id);
    db.prepare('DELETE FROM user_model_observations WHERE source_grant_id = ?').run(id);
    if (sourceInstanceId) {
      const affected = db.prepare(`SELECT DISTINCT assertion_id FROM user_assertion_evidence
        WHERE evidence_id IN (SELECT evidence_id FROM context_evidence WHERE source_instance_id = ?)`)
        .all(sourceInstanceId) as Array<{ assertion_id: string }>;
      db.prepare(`DELETE FROM user_assertion_evidence
        WHERE evidence_id IN (SELECT evidence_id FROM context_evidence WHERE source_instance_id = ?)`)
        .run(sourceInstanceId);
      db.prepare('UPDATE context_evidence SET redacted_excerpt = NULL WHERE source_instance_id = ?')
        .run(sourceInstanceId);
      for (const { assertion_id: assertionId } of affected) {
        db.prepare(`UPDATE user_assertions SET
          support_count = (SELECT COUNT(*) FROM user_assertion_evidence WHERE assertion_id = ? AND relation = 'supports'),
          independent_source_count = (SELECT COUNT(DISTINCT COALESCE(e.source_instance_id, e.source_type || ':' || e.source_ref))
            FROM user_assertion_evidence ae JOIN context_evidence e ON e.evidence_id = ae.evidence_id
            WHERE ae.assertion_id = ? AND ae.relation = 'supports'),
          last_supported_at = (SELECT MAX(e.observed_at) FROM user_assertion_evidence ae
            JOIN context_evidence e ON e.evidence_id = ae.evidence_id
            WHERE ae.assertion_id = ? AND ae.relation = 'supports')
          WHERE assertion_id = ?`).run(assertionId, assertionId, assertionId, assertionId);
        const assertion = db.prepare(`SELECT status, authority, support_count FROM user_assertions
          WHERE assertion_id = ?`).get(assertionId) as {
            status: string; authority: string; support_count: number;
          } | undefined;
        const fallbackConsent = db.prepare(`SELECT receipt.receipt_id
          FROM user_assertion_evidence ae
          JOIN context_evidence evidence ON evidence.evidence_id = ae.evidence_id
          JOIN understanding_source_grants grant_record ON grant_record.status = 'active'
            AND evidence.source_instance_id = COALESCE(
              json_extract(grant_record.config_json, '$.sourceInstanceId'),
              CASE WHEN json_extract(grant_record.config_json, '$.connectorId') IS NOT NULL
                AND json_extract(grant_record.config_json, '$.accountId') IS NOT NULL
                THEN 'composio:' || json_extract(grant_record.config_json, '$.connectorId')
                  || ':' || json_extract(grant_record.config_json, '$.accountId') END)
          JOIN understanding_consent_receipts receipt
            ON receipt.grant_id = grant_record.grant_id AND receipt.revoked_at IS NULL
          JOIN user_assertions assertion_record ON assertion_record.assertion_id = ae.assertion_id
          WHERE ae.assertion_id = ? AND ae.relation = 'supports'
            AND EXISTS (SELECT 1 FROM json_each(receipt.allowed_domains_json)
              WHERE value = assertion_record.domain)
          LIMIT 1`).get(assertionId) as { receipt_id: string } | undefined;
        db.prepare('UPDATE user_assertions SET consent_receipt_id = ? WHERE assertion_id = ?')
          .run(fallbackConsent?.receipt_id ?? null, assertionId);
        if (assertion && assertion.authority !== 'user_explicit'
          && (!fallbackConsent || assertion.support_count < 2)
          && (assertion.status === 'active' || assertion.status === 'candidate')) {
          db.prepare("UPDATE user_assertions SET status = 'needs_review' WHERE assertion_id = ?").run(assertionId);
          db.prepare(`INSERT INTO user_assertion_status_events (
            event_id, assertion_id, from_status, to_status, actor_type, reason, created_at
          ) VALUES (?, ?, ?, 'needs_review', 'runtime', 'Supporting context source was revoked.', ?)`)
            .run(randomUUID(), assertionId, assertion.status, nowMs);
        }
      }
    }
  });
  return getUnderstandingSourceGrant(id);
}

export function createUnderstandingSourceRun(input: {
  grantId: string; kind: UnderstandingSourceRun['kind']; status?: UnderstandingSourceRun['status'];
  connectorLearningJobId?: string; cursorBefore?: string; metadata?: Record<string, unknown>; nowMs?: number;
}): UnderstandingSourceRun {
  const id = randomUUID(); const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => db.prepare(`
    INSERT INTO understanding_source_runs (
      run_id, grant_id, connector_learning_job_id, kind, status, cursor_before, metadata_json, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.grantId, input.connectorLearningJobId ?? null, input.kind,
    input.status ?? 'running', input.cursorBefore ?? null,
    JSON.stringify(input.metadata ?? {}), now));
  return getUnderstandingSourceRun(id)!;
}

export function getConnectorUnderstandingSourceRun(connectorLearningJobId: string): UnderstandingSourceRun | null {
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM understanding_source_runs WHERE connector_learning_job_id = ?',
  ).get(connectorLearningJobId) as RunRow | undefined;
  return row ? runFromRow(row) : null;
}

export function getOrCreateConnectorUnderstandingSourceRun(input: {
  grantId: string;
  connectorLearningJobId: string;
  kind: UnderstandingSourceRun['kind'];
  status?: UnderstandingSourceRun['status'];
  metadata?: Record<string, unknown>;
  nowMs?: number;
}): UnderstandingSourceRun {
  const id = randomUUID();
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => db.prepare(`
    INSERT OR IGNORE INTO understanding_source_runs (
      run_id, grant_id, connector_learning_job_id, kind, status, metadata_json, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.grantId, input.connectorLearningJobId, input.kind,
    input.status ?? 'running', JSON.stringify(input.metadata ?? {}), now));
  return getConnectorUnderstandingSourceRun(input.connectorLearningJobId)!;
}

export function getUnderstandingSourceRun(id: string): UnderstandingSourceRun | null {
  const row = getSqliteDatabase().prepare('SELECT * FROM understanding_source_runs WHERE run_id = ?')
    .get(id) as RunRow | undefined;
  return row ? runFromRow(row) : null;
}

export function listUnderstandingSourceRuns(grantId: string, limit = 20): UnderstandingSourceRun[] {
  return (getSqliteDatabase().prepare(
    'SELECT * FROM understanding_source_runs WHERE grant_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?',
  ).all(grantId, Math.max(1, Math.min(100, limit))) as unknown as RunRow[]).map(runFromRow);
}

export function updateUnderstandingSourceRun(id: string, patch: {
  status?: UnderstandingSourceRun['status']; cursorAfter?: string; itemsSeen?: number;
  metadata?: Record<string, unknown>; errorMessage?: string; completed?: boolean; nowMs?: number;
}): UnderstandingSourceRun | null {
  const current = getUnderstandingSourceRun(id); if (!current) return null;
  const completedAt = patch.completed ? patch.nowMs ?? Date.now() : current.completedAt ?? null;
  runSqliteWriteTransaction((db) => db.prepare(`
    UPDATE understanding_source_runs SET status = ?, cursor_after = ?, items_seen = ?, metadata_json = ?,
      error_message = ?, completed_at = ? WHERE run_id = ?
  `).run(patch.status ?? current.status, patch.cursorAfter ?? current.cursorAfter ?? null,
    patch.itemsSeen ?? current.itemsSeen, JSON.stringify(patch.metadata ?? current.metadata),
    patch.errorMessage ?? current.errorMessage ?? null, completedAt, id));
  return getUnderstandingSourceRun(id);
}

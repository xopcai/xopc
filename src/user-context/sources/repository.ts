import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { notifyUserContextChange } from '../changes.js';
import { USER_CONTEXT_PRINCIPAL_ID, type ContextEvidence, type UserContextScope } from '../domain.js';
import { focusLifecycle } from '../focus-lifecycle.js';
import type {
  UnderstandingSourceGrant,
  UnderstandingSourceRun,
  UserFocus,
} from './types.js';

type GrantRow = {
  grant_id: string; source_key: string; adapter_id: string; category: string; platform: string;
  display_name: string; status: string; access_mode: string; retention_policy: string;
  processing_policy: string; config_json: string; checkpoint_json: string;
  last_collected_at: number | null; created_at: number; updated_at: number;
};

type RunRow = {
  run_id: string; grant_id: string; kind: string; status: string; cursor_before: string | null;
  cursor_after: string | null; items_seen: number; metadata_json: string; error_message: string | null;
  started_at: number; completed_at: number | null;
};

type FocusRow = {
  focus_id: string; current_version_id: string; principal_id: string; canonical_key: string; title: string; summary: string; horizon: string;
  status: string; confidence: number; scope_type: UserContextScope['type']; scope_id: string | null;
  explicitness: UserFocus['explicitness']; sensitivity: UserFocus['sensitivity'];
  disclosure_policy: UserFocus['disclosurePolicy']; valid_from: number | null; valid_to: number | null;
  review_at: number | null; evidence_refs_json: string;
  source_run_id: string | null; created_at: number; updated_at: number;
};

type UserFocusInput = Omit<UserFocus,
  'id' | 'versionId' | 'principalId' | 'scope' | 'explicitness' | 'sensitivity' | 'disclosurePolicy'
  | 'validFrom' | 'validTo' | 'reviewAt' | 'createdAt' | 'updatedAt'> & {
  principalId?: string;
  scope?: UserContextScope;
  explicitness?: UserFocus['explicitness'];
  sensitivity?: UserFocus['sensitivity'];
  disclosurePolicy?: UserFocus['disclosurePolicy'];
  validFrom?: number;
  validTo?: number;
  reviewAt?: number;
  changeReason?: string;
  nowMs?: number;
};

function record(value: string): Record<string, unknown> {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function strings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
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
    status: row.status as UnderstandingSourceRun['status'],
    ...(row.cursor_before ? { cursorBefore: row.cursor_before } : {}),
    ...(row.cursor_after ? { cursorAfter: row.cursor_after } : {}),
    itemsSeen: row.items_seen, metadata: record(row.metadata_json),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    startedAt: row.started_at, ...(row.completed_at == null ? {} : { completedAt: row.completed_at }),
  };
}

function focusFromRow(row: FocusRow): UserFocus {
  return {
    id: row.focus_id, versionId: row.current_version_id, principalId: row.principal_id, canonicalKey: row.canonical_key,
    title: row.title, summary: row.summary,
    horizon: row.horizon as UserFocus['horizon'], status: row.status as UserFocus['status'],
    confidence: row.confidence,
    scope: { type: row.scope_type, ...(row.scope_id ? { id: row.scope_id } : {}) },
    explicitness: row.explicitness,
    sensitivity: row.sensitivity,
    disclosurePolicy: row.disclosure_policy,
    ...(row.valid_from == null ? {} : { validFrom: row.valid_from }),
    ...(row.valid_to == null ? {} : { validTo: row.valid_to }),
    ...(row.review_at == null ? {} : { reviewAt: row.review_at }),
    evidenceRefs: strings(row.evidence_refs_json), ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function focusSnapshot(row: FocusRow): Record<string, unknown> {
  return {
    horizon: row.horizon, status: row.status, confidence: row.confidence,
    scopeType: row.scope_type, scopeId: row.scope_id, explicitness: row.explicitness,
    sensitivity: row.sensitivity, disclosurePolicy: row.disclosure_policy,
    validFrom: row.valid_from, validTo: row.valid_to, reviewAt: row.review_at,
    evidenceRefs: strings(row.evidence_refs_json),
  };
}

function sameFocusVersion(left: FocusRow | undefined, right: FocusRow): boolean {
  return Boolean(left && left.title === right.title && left.summary === right.summary
    && JSON.stringify(focusSnapshot(left)) === JSON.stringify(focusSnapshot(right)));
}

function linkFocusEvidence(versionId: string, evidenceRefs: string[], confidence: number): void {
  if (!evidenceRefs.length) return;
  const placeholders = evidenceRefs.map(() => '?').join(', ');
  getSqliteDatabase().prepare(`INSERT OR IGNORE INTO user_focus_evidence_links (
    version_id, evidence_id, relation, confidence
  ) SELECT ?, evidence_id, 'supports', ? FROM context_evidence WHERE source_ref IN (${placeholders})`)
    .run(versionId, confidence, ...evidenceRefs);
}

export function listUserFocusEvidence(focusId: string): ContextEvidence[] {
  const rows = getSqliteDatabase().prepare(`SELECT DISTINCT e.* FROM context_evidence e
    JOIN user_focus_evidence_links l ON l.evidence_id = e.evidence_id
    JOIN user_focus_versions v ON v.version_id = l.version_id
    WHERE v.focus_id = ? ORDER BY e.observed_at DESC`).all(focusId) as Array<{
      evidence_id: string; source_type: ContextEvidence['sourceType']; source_instance_id: string | null;
      source_ref: string; source_run_id: string | null; source_item_id: string | null;
      session_id: string | null; turn_id: string | null; message_id: string | null; content_hash: string | null;
      retention_policy: ContextEvidence['retentionPolicy'] | null;
      processing_policy: ContextEvidence['processingPolicy'] | null;
      extractor_id: string | null; extractor_version: string | null;
      redacted_excerpt: string | null; trust_level: ContextEvidence['trustLevel'];
      observed_at: number; ingested_at: number | null; created_at: number;
    }>;
  return rows.map((row) => ({
    id: row.evidence_id, sourceType: row.source_type,
    ...(row.source_instance_id ? { sourceInstanceId: row.source_instance_id } : {}),
    sourceRef: row.source_ref, ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
    ...(row.source_item_id ? { sourceItemId: row.source_item_id } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.turn_id ? { turnId: row.turn_id } : {}),
    ...(row.message_id ? { messageId: row.message_id } : {}),
    ...(row.content_hash ? { contentHash: row.content_hash } : {}),
    ...(row.retention_policy ? { retentionPolicy: row.retention_policy } : {}),
    ...(row.processing_policy ? { processingPolicy: row.processing_policy } : {}),
    ...(row.extractor_id ? { extractorId: row.extractor_id } : {}),
    ...(row.extractor_version ? { extractorVersion: row.extractor_version } : {}),
    ...(row.redacted_excerpt ? { redactedExcerpt: row.redacted_excerpt } : {}),
    trustLevel: row.trust_level, observedAt: row.observed_at,
    ingestedAt: row.ingested_at ?? row.created_at, createdAt: row.created_at,
  }));
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
  return getUnderstandingSourceGrant(id);
}

export function revokeUnderstandingSourceGrant(id: string, nowMs = Date.now()): UnderstandingSourceGrant | null {
  notifyUserContextChange({ kind: 'policy' });
  runSqliteWriteTransaction((db) => db.prepare(
    "UPDATE understanding_source_grants SET status = 'revoked', updated_at = ? WHERE grant_id = ?",
  ).run(nowMs, id));
  return getUnderstandingSourceGrant(id);
}

export function createUnderstandingSourceRun(input: {
  grantId: string; kind: UnderstandingSourceRun['kind']; status?: UnderstandingSourceRun['status'];
  cursorBefore?: string; metadata?: Record<string, unknown>; nowMs?: number;
}): UnderstandingSourceRun {
  const id = randomUUID(); const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => db.prepare(`
    INSERT INTO understanding_source_runs (
      run_id, grant_id, kind, status, cursor_before, metadata_json, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.grantId, input.kind, input.status ?? 'running', input.cursorBefore ?? null,
    JSON.stringify(input.metadata ?? {}), now));
  return getUnderstandingSourceRun(id)!;
}

export function getUnderstandingSourceRun(id: string): UnderstandingSourceRun | null {
  const row = getSqliteDatabase().prepare('SELECT * FROM understanding_source_runs WHERE run_id = ?')
    .get(id) as RunRow | undefined;
  return row ? runFromRow(row) : null;
}

export function listUnderstandingSourceRuns(grantId: string, limit = 20): UnderstandingSourceRun[] {
  return (getSqliteDatabase().prepare(
    'SELECT * FROM understanding_source_runs WHERE grant_id = ? ORDER BY started_at DESC LIMIT ?',
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

export function upsertUserFocus(input: UserFocusInput): UserFocus {
  const id = randomUUID(); const now = input.nowMs ?? Date.now();
  const scope = input.scope ?? { type: 'global' as const };
  const explicitness = input.explicitness ?? 'inferred';
  const sensitivity = input.sensitivity ?? 'normal';
  const disclosurePolicy = input.disclosurePolicy ?? 'referenceable';
  const existingRow = getSqliteDatabase().prepare('SELECT * FROM user_focuses WHERE canonical_key = ?')
    .get(input.canonicalKey) as FocusRow | undefined;
  if (existingRow?.explicitness === 'explicit' && explicitness !== 'explicit') {
    return focusFromRow(existingRow);
  }
  if (existingRow) notifyUserContextChange({ kind: 'focus', id: existingRow.focus_id });
  let currentVersionId = existingRow?.current_version_id;
  runSqliteWriteTransaction((db) => {
    db.prepare(`
    INSERT INTO user_focuses (
      focus_id, principal_id, canonical_key, title, summary, horizon, status, confidence,
      scope_type, scope_id, explicitness, sensitivity, disclosure_policy,
      valid_from, valid_to, review_at, evidence_refs_json, source_run_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_key) DO UPDATE SET title = excluded.title, summary = excluded.summary,
      horizon = excluded.horizon,
      status = CASE
        WHEN user_focuses.status IN ('active', 'paused', 'completed', 'rejected') AND excluded.status = 'candidate'
          THEN user_focuses.status
        ELSE excluded.status
      END,
      confidence = excluded.confidence,
      scope_type = excluded.scope_type, scope_id = excluded.scope_id,
      explicitness = excluded.explicitness, sensitivity = excluded.sensitivity,
      disclosure_policy = excluded.disclosure_policy, valid_from = excluded.valid_from,
      valid_to = excluded.valid_to, review_at = excluded.review_at,
      evidence_refs_json = excluded.evidence_refs_json,
      source_run_id = excluded.source_run_id, updated_at = excluded.updated_at
  `).run(
    id, input.principalId ?? USER_CONTEXT_PRINCIPAL_ID, input.canonicalKey, input.title, input.summary,
    input.horizon, input.status, input.confidence, scope.type, scope.id ?? null,
    explicitness, sensitivity, disclosurePolicy, input.validFrom ?? null, input.validTo ?? null,
    input.reviewAt ?? null, JSON.stringify(input.evidenceRefs), input.sourceRunId ?? null, now, now,
    );
    const nextRow = db.prepare('SELECT * FROM user_focuses WHERE canonical_key = ?')
      .get(input.canonicalKey) as FocusRow;
    if (!sameFocusVersion(existingRow, nextRow)) {
      currentVersionId = randomUUID();
      db.prepare(`INSERT INTO user_focus_versions (
        version_id, focus_id, title, summary, snapshot_json, created_by, change_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        currentVersionId, nextRow.focus_id, nextRow.title, nextRow.summary, JSON.stringify(focusSnapshot(nextRow)),
        explicitness === 'explicit' ? 'user' : input.sourceRunId ? 'connector' : 'runtime',
        input.changeReason ?? (existingRow ? 'Focus updated' : 'Focus created'), now,
      );
      db.prepare('UPDATE user_focuses SET current_version_id = ? WHERE focus_id = ?')
        .run(currentVersionId, nextRow.focus_id);
    }
  });
  if (currentVersionId) linkFocusEvidence(currentVersionId, input.evidenceRefs, input.confidence);
  return focusFromRow(getSqliteDatabase().prepare('SELECT * FROM user_focuses WHERE canonical_key = ?')
    .get(input.canonicalKey) as unknown as FocusRow);
}

export function listUserFocuses(statuses?: UserFocus['status'][], limit?: number): UserFocus[] {
  const maxRows = limit === undefined ? -1 : Math.max(1, Math.min(200, Math.floor(limit)));
  if (!statuses?.length) return (getSqliteDatabase().prepare('SELECT * FROM user_focuses ORDER BY updated_at DESC LIMIT ?')
    .all(maxRows) as unknown as FocusRow[]).map(focusFromRow);
  const placeholders = statuses.map(() => '?').join(', ');
  return (getSqliteDatabase().prepare(`SELECT * FROM user_focuses WHERE status IN (${placeholders}) ORDER BY updated_at DESC LIMIT ?`)
    .all(...statuses, maxRows) as unknown as FocusRow[]).map(focusFromRow);
}

export function getUserFocus(id: string): UserFocus | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM user_focuses WHERE focus_id = ? AND principal_id = ?')
    .get(id, USER_CONTEXT_PRINCIPAL_ID) as FocusRow | undefined;
  return row ? focusFromRow(row) : undefined;
}

export function updateUserFocus(
  id: string,
  patch: Partial<Pick<UserFocus, 'title' | 'summary' | 'status' | 'validFrom' | 'validTo' | 'reviewAt'>>,
  nowMs = Date.now(),
): UserFocus | null {
  notifyUserContextChange({ kind: 'focus', id });
  const currentRow = getSqliteDatabase().prepare('SELECT * FROM user_focuses WHERE focus_id = ?')
    .get(id) as FocusRow | undefined;
  if (!currentRow) return null;
  const current = focusFromRow(currentRow);
  const renewedLifecycle = patch.status === 'active'
    && (current.status !== 'active'
      || (current.reviewAt !== undefined && current.reviewAt <= nowMs)
      || (current.validTo !== undefined && current.validTo <= nowMs))
    ? focusLifecycle(current.horizon, nowMs)
    : {};
  const nextValidFrom = patch.validFrom ?? renewedLifecycle.validFrom ?? current.validFrom;
  const nextValidTo = patch.validTo ?? renewedLifecycle.validTo ?? current.validTo;
  const nextReviewAt = patch.reviewAt ?? renewedLifecycle.reviewAt ?? current.reviewAt;
  if ((patch.title ?? current.title) === current.title
    && (patch.summary ?? current.summary) === current.summary
    && (patch.status ?? current.status) === current.status
    && nextValidFrom === current.validFrom
    && nextValidTo === current.validTo
    && nextReviewAt === current.reviewAt) return current;
  const versionId = randomUUID();
  runSqliteWriteTransaction((db) => {
    db.prepare(`UPDATE user_focuses
      SET title = ?, summary = ?, status = ?, valid_from = ?, valid_to = ?, review_at = ?, updated_at = ?
      WHERE focus_id = ?`).run(
      patch.title ?? current.title, patch.summary ?? current.summary,
      patch.status ?? current.status, nextValidFrom ?? null, nextValidTo ?? null, nextReviewAt ?? null, nowMs, id,
    );
    const nextRow = db.prepare('SELECT * FROM user_focuses WHERE focus_id = ?').get(id) as FocusRow;
    db.prepare(`INSERT INTO user_focus_versions (
      version_id, focus_id, title, summary, snapshot_json, created_by, change_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'Focus updated', ?)`).run(
      versionId, id, nextRow.title, nextRow.summary, JSON.stringify(focusSnapshot(nextRow)),
      current.explicitness === 'explicit' ? 'user' : 'runtime', nowMs,
    );
    db.prepare('UPDATE user_focuses SET current_version_id = ? WHERE focus_id = ?').run(versionId, id);
  });
  linkFocusEvidence(versionId, current.evidenceRefs, current.confidence);
  const row = getSqliteDatabase().prepare('SELECT * FROM user_focuses WHERE focus_id = ?').get(id) as FocusRow | undefined;
  return row ? focusFromRow(row) : null;
}

export function deleteUserFocus(id: string): boolean {
  notifyUserContextChange({ kind: 'focus', id });
  return Number(getSqliteDatabase().prepare('DELETE FROM user_focuses WHERE focus_id = ?').run(id).changes) > 0;
}

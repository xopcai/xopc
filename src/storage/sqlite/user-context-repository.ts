import { randomUUID } from 'node:crypto';

import {
  USER_CONTEXT_PRINCIPAL_ID,
  type CollaborationRule,
  type ContextEvidence,
  type PersonalizationItem,
  type UnderstandingKind,
  type UnderstandingStatus,
  type UserContextScope,
  type UserProfile,
  type UserUnderstanding,
} from '../../user-context/domain.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type UnderstandingRow = {
  understanding_id: string;
  kind: UnderstandingKind;
  canonical_key: string;
  status: UnderstandingStatus;
  scope_type: UserContextScope['type'];
  scope_id: string | null;
  explicitness: UserUnderstanding['explicitness'];
  durability: UserUnderstanding['durability'];
  sensitivity: UserUnderstanding['sensitivity'];
  disclosure_policy: UserUnderstanding['disclosurePolicy'];
  confidence: number;
  valid_from: number | null;
  valid_to: number | null;
  expires_at: number | null;
  review_at: number | null;
  current_version_id: string;
  conflict_group_id: string | null;
  supersedes_id: string | null;
  created_at: number;
  updated_at: number;
  statement: string;
  payload_json: string;
};

type RuleRow = {
  rule_id: string;
  category: CollaborationRule['category'];
  status: CollaborationRule['status'];
  priority: number;
  scope_type: UserContextScope['type'];
  scope_id: string | null;
  conditions_json: string;
  current_revision_id: string;
  created_at: number;
  updated_at: number;
  statement: string;
};

const UNDERSTANDING_SELECT = `
  SELECT u.*, v.statement, v.payload_json
  FROM user_understandings u
  JOIN user_understanding_versions v ON v.version_id = u.current_version_id
`;

function scopeFromRow(type: UserContextScope['type'], id: string | null): UserContextScope {
  return id ? { type, id } : { type };
}

function understandingFromRow(row: UnderstandingRow): UserUnderstanding {
  return {
    id: row.understanding_id,
    kind: row.kind,
    canonicalKey: row.canonical_key,
    status: row.status,
    scope: scopeFromRow(row.scope_type, row.scope_id),
    explicitness: row.explicitness,
    durability: row.durability,
    sensitivity: row.sensitivity,
    disclosurePolicy: row.disclosure_policy,
    confidence: row.confidence,
    statement: row.statement,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    versionId: row.current_version_id,
    ...(row.valid_from === null ? {} : { validFrom: row.valid_from }),
    ...(row.valid_to === null ? {} : { validTo: row.valid_to }),
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.review_at === null ? {} : { reviewAt: row.review_at }),
    ...(row.conflict_group_id ? { conflictGroupId: row.conflict_group_id } : {}),
    ...(row.supersedes_id ? { supersedesId: row.supersedes_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ruleFromRow(row: RuleRow): CollaborationRule {
  return {
    id: row.rule_id,
    category: row.category,
    status: row.status,
    priority: row.priority,
    scope: scopeFromRow(row.scope_type, row.scope_id),
    conditions: JSON.parse(row.conditions_json) as Record<string, unknown>,
    statement: row.statement,
    revisionId: row.current_revision_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getUserProfile(principalId = USER_CONTEXT_PRINCIPAL_ID): UserProfile {
  const row = getSqliteDatabase().prepare('SELECT * FROM user_profiles WHERE principal_id = ?').get(principalId) as {
    call_name: string;
    pronouns: string;
    timezone: string;
    locale: string;
    accessibility_json: string;
    created_at: number;
    updated_at: number;
  } | undefined;
  if (!row) {
    return { callName: '', pronouns: '', timezone: '', locale: '', accessibility: {}, createdAt: 0, updatedAt: 0 };
  }
  return {
    callName: row.call_name,
    pronouns: row.pronouns,
    timezone: row.timezone,
    locale: row.locale,
    accessibility: JSON.parse(row.accessibility_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateUserProfile(
  patch: Partial<Pick<UserProfile, 'callName' | 'pronouns' | 'timezone' | 'locale' | 'accessibility'>>,
  principalId = USER_CONTEXT_PRINCIPAL_ID,
): UserProfile {
  const current = getUserProfile(principalId);
  const now = Date.now();
  const next = { ...current, ...patch, createdAt: current.createdAt || now, updatedAt: now };
  runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO user_profiles (
        principal_id, call_name, pronouns, timezone, locale, accessibility_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(principal_id) DO UPDATE SET
        call_name = excluded.call_name,
        pronouns = excluded.pronouns,
        timezone = excluded.timezone,
        locale = excluded.locale,
        accessibility_json = excluded.accessibility_json,
        updated_at = excluded.updated_at
    `).run(
      principalId,
      next.callName,
      next.pronouns,
      next.timezone,
      next.locale,
      JSON.stringify(next.accessibility),
      next.createdAt,
      next.updatedAt,
    );
  });
  return next;
}

export type CreateUnderstandingInput = Omit<
  UserUnderstanding,
  'id' | 'versionId' | 'createdAt' | 'updatedAt' | 'statement' | 'payload'
> & {
  statement: string;
  payload?: Record<string, unknown>;
  createdBy: 'user' | 'runtime' | 'connector' | 'consolidation';
  changeReason: string;
};

export function createUnderstanding(
  input: CreateUnderstandingInput,
  principalId = USER_CONTEXT_PRINCIPAL_ID,
): UserUnderstanding {
  const id = randomUUID();
  const versionId = randomUUID();
  const now = Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(`INSERT INTO user_understandings (
      understanding_id, principal_id, kind, canonical_key, status, scope_type, scope_id,
      explicitness, durability, sensitivity, disclosure_policy, confidence, valid_from,
      valid_to, expires_at, review_at, current_version_id, conflict_group_id, supersedes_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id, principalId, input.kind, input.canonicalKey, input.status, input.scope.type,
        input.scope.id ?? null, input.explicitness, input.durability, input.sensitivity,
        input.disclosurePolicy, input.confidence, input.validFrom ?? null, input.validTo ?? null,
        input.expiresAt ?? null, input.reviewAt ?? null, versionId, input.conflictGroupId ?? null,
        input.supersedesId ?? null, now, now,
      );
    db.prepare(`INSERT INTO user_understanding_versions (
      version_id, understanding_id, statement, payload_json, created_by, change_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(versionId, id, input.statement.trim(), JSON.stringify(input.payload ?? {}), input.createdBy, input.changeReason, now);
    db.prepare('INSERT INTO user_understanding_fts (statement, understanding_id, version_id) VALUES (?, ?, ?)')
      .run(input.statement.trim(), id, versionId);
  });
  return getUnderstanding(id)!;
}

export function getUnderstanding(id: string): UserUnderstanding | undefined {
  const row = getSqliteDatabase().prepare(`${UNDERSTANDING_SELECT} WHERE u.understanding_id = ?`).get(id) as UnderstandingRow | undefined;
  return row ? understandingFromRow(row) : undefined;
}

export function listUnderstandings(
  statuses?: UnderstandingStatus[],
  principalId = USER_CONTEXT_PRINCIPAL_ID,
): UserUnderstanding[] {
  const db = getSqliteDatabase();
  if (!statuses?.length) {
    return (db.prepare(`${UNDERSTANDING_SELECT} WHERE u.principal_id = ? ORDER BY u.updated_at DESC`).all(principalId) as UnderstandingRow[])
      .map(understandingFromRow);
  }
  const placeholders = statuses.map(() => '?').join(', ');
  return (db.prepare(`${UNDERSTANDING_SELECT} WHERE u.principal_id = ? AND u.status IN (${placeholders}) ORDER BY u.updated_at DESC`)
    .all(principalId, ...statuses) as UnderstandingRow[]).map(understandingFromRow);
}

export function reviseUnderstanding(
  id: string,
  statement: string,
  options: {
    payload?: Record<string, unknown>;
    canonicalKey?: string;
    explicitness?: UserUnderstanding['explicitness'];
    confidence?: number;
    changeReason: string;
  },
): UserUnderstanding {
  const current = getUnderstanding(id);
  if (!current) throw new Error(`User understanding not found: ${id}`);
  const versionId = randomUUID();
  const now = Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(`INSERT INTO user_understanding_versions (
      version_id, understanding_id, statement, payload_json, created_by, change_reason, created_at
    ) VALUES (?, ?, ?, ?, 'user', ?, ?)`)
      .run(versionId, id, statement.trim(), JSON.stringify(options.payload ?? current.payload), options.changeReason, now);
    db.prepare(`UPDATE user_understandings
      SET current_version_id = ?, canonical_key = ?, explicitness = ?, confidence = ?, updated_at = ?
      WHERE understanding_id = ?`)
      .run(
        versionId,
        options.canonicalKey ?? current.canonicalKey,
        options.explicitness ?? current.explicitness,
        options.confidence ?? current.confidence,
        now,
        id,
      );
    db.prepare('DELETE FROM user_understanding_fts WHERE understanding_id = ?').run(id);
    db.prepare('INSERT INTO user_understanding_fts (statement, understanding_id, version_id) VALUES (?, ?, ?)')
      .run(statement.trim(), id, versionId);
  });
  return getUnderstanding(id)!;
}

export function setUnderstandingStatus(
  id: string,
  status: UnderstandingStatus,
  confirmation?: { explicitness: UserUnderstanding['explicitness']; confidence: number },
): UserUnderstanding {
  const now = Date.now();
  getSqliteDatabase().prepare(`UPDATE user_understandings
    SET status = ?,
        explicitness = COALESCE(?, explicitness),
        confidence = COALESCE(?, confidence),
        updated_at = ?
    WHERE understanding_id = ?`)
    .run(status, confirmation?.explicitness ?? null, confirmation?.confidence ?? null, now, id);
  const result = getUnderstanding(id);
  if (!result) throw new Error(`User understanding not found: ${id}`);
  return result;
}

export function rejectUnderstanding(id: string, reason: string): UserUnderstanding {
  const current = getUnderstanding(id);
  if (!current) throw new Error(`User understanding not found: ${id}`);
  const now = Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare("UPDATE user_understandings SET status = 'rejected', updated_at = ? WHERE understanding_id = ?").run(now, id);
    db.prepare(`INSERT INTO context_suppressions (
      suppression_id, principal_id, canonical_key, scope_type, scope_id, reason, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT DO UPDATE SET reason = excluded.reason, expires_at = NULL`)
      .run(randomUUID(), USER_CONTEXT_PRINCIPAL_ID, current.canonicalKey, current.scope.type, current.scope.id ?? null, reason, now);
  });
  return getUnderstanding(id)!;
}

export function deleteUnderstanding(id: string): boolean {
  return runSqliteWriteTransaction((db) => {
    db.prepare('DELETE FROM user_understanding_fts WHERE understanding_id = ?').run(id);
    return Number(db.prepare('DELETE FROM user_understandings WHERE understanding_id = ?').run(id).changes) > 0;
  });
}

export function isUnderstandingSuppressed(
  canonicalKey: string,
  scope: UserContextScope,
  principalId = USER_CONTEXT_PRINCIPAL_ID,
): boolean {
  const row = getSqliteDatabase().prepare(`SELECT 1 FROM context_suppressions
    WHERE principal_id = ? AND canonical_key = ? AND scope_type = ?
      AND COALESCE(scope_id, '') = COALESCE(?, '')
      AND (expires_at IS NULL OR expires_at > ?)`)
    .get(principalId, canonicalKey, scope.type, scope.id ?? null, Date.now());
  return Boolean(row);
}

export function createCollaborationRule(
  input: Pick<CollaborationRule, 'category' | 'priority' | 'scope' | 'conditions' | 'statement'>,
  principalId = USER_CONTEXT_PRINCIPAL_ID,
): CollaborationRule {
  const id = randomUUID();
  const revisionId = randomUUID();
  const now = Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(`INSERT INTO collaboration_rules (
      rule_id, principal_id, category, status, priority, scope_type, scope_id,
      conditions_json, current_revision_id, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, principalId, input.category, input.priority, input.scope.type, input.scope.id ?? null,
        JSON.stringify(input.conditions), revisionId, now, now);
    db.prepare(`INSERT INTO collaboration_rule_revisions (
      revision_id, rule_id, statement, created_by, created_at
    ) VALUES (?, ?, ?, 'user', ?)`)
      .run(revisionId, id, input.statement.trim(), now);
  });
  return getCollaborationRule(id)!;
}

export function getCollaborationRule(id: string): CollaborationRule | undefined {
  const row = getSqliteDatabase().prepare(`SELECT r.*, v.statement FROM collaboration_rules r
    JOIN collaboration_rule_revisions v ON v.revision_id = r.current_revision_id
    WHERE r.rule_id = ?`).get(id) as RuleRow | undefined;
  return row ? ruleFromRow(row) : undefined;
}

export function listCollaborationRules(
  principalId = USER_CONTEXT_PRINCIPAL_ID,
): CollaborationRule[] {
  return (getSqliteDatabase().prepare(`SELECT r.*, v.statement FROM collaboration_rules r
    JOIN collaboration_rule_revisions v ON v.revision_id = r.current_revision_id
    WHERE r.principal_id = ? ORDER BY r.priority ASC, r.updated_at DESC`).all(principalId) as RuleRow[])
    .map(ruleFromRow);
}

export function reviseCollaborationRule(id: string, statement: string): CollaborationRule {
  const current = getCollaborationRule(id);
  if (!current) throw new Error(`Collaboration rule not found: ${id}`);
  const revisionId = randomUUID();
  const now = Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(`INSERT INTO collaboration_rule_revisions (
      revision_id, rule_id, statement, created_by, created_at
    ) VALUES (?, ?, ?, 'user', ?)`).run(revisionId, id, statement.trim(), now);
    db.prepare('UPDATE collaboration_rules SET current_revision_id = ?, updated_at = ? WHERE rule_id = ?')
      .run(revisionId, now, id);
  });
  return getCollaborationRule(id)!;
}

export function setCollaborationRuleStatus(
  id: string,
  status: CollaborationRule['status'],
): CollaborationRule {
  getSqliteDatabase().prepare('UPDATE collaboration_rules SET status = ?, updated_at = ? WHERE rule_id = ?')
    .run(status, Date.now(), id);
  const result = getCollaborationRule(id);
  if (!result) throw new Error(`Collaboration rule not found: ${id}`);
  return result;
}

export function deleteCollaborationRule(id: string): boolean {
  return Number(getSqliteDatabase().prepare('DELETE FROM collaboration_rules WHERE rule_id = ?').run(id).changes) > 0;
}

export function createContextEvidence(
  input: Omit<ContextEvidence, 'id' | 'createdAt'>,
  principalId = USER_CONTEXT_PRINCIPAL_ID,
): ContextEvidence {
  const existing = getSqliteDatabase().prepare(`SELECT * FROM context_evidence
    WHERE principal_id = ? AND source_type = ?
      AND COALESCE(source_instance_id, '') = COALESCE(?, '') AND source_ref = ?`)
    .get(principalId, input.sourceType, input.sourceInstanceId ?? null, input.sourceRef) as {
      evidence_id: string; source_type: ContextEvidence['sourceType']; source_instance_id: string | null;
      source_ref: string; redacted_excerpt: string | null; trust_level: ContextEvidence['trustLevel'];
      observed_at: number; created_at: number;
    } | undefined;
  if (existing) {
    return {
      id: existing.evidence_id,
      sourceType: existing.source_type,
      ...(existing.source_instance_id ? { sourceInstanceId: existing.source_instance_id } : {}),
      sourceRef: existing.source_ref,
      ...(existing.redacted_excerpt ? { redactedExcerpt: existing.redacted_excerpt } : {}),
      trustLevel: existing.trust_level,
      observedAt: existing.observed_at,
      createdAt: existing.created_at,
    };
  }
  const evidence: ContextEvidence = { ...input, id: randomUUID(), createdAt: Date.now() };
  getSqliteDatabase().prepare(`INSERT INTO context_evidence (
    evidence_id, principal_id, source_type, source_instance_id, source_ref,
    redacted_excerpt, trust_level, observed_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(evidence.id, principalId, evidence.sourceType, evidence.sourceInstanceId ?? null,
      evidence.sourceRef, evidence.redactedExcerpt ?? null, evidence.trustLevel,
      evidence.observedAt, evidence.createdAt);
  return evidence;
}

export function linkUnderstandingEvidence(
  versionId: string,
  evidenceId: string,
  relation: 'supports' | 'contradicts' | 'supersedes',
  confidence: number,
): void {
  getSqliteDatabase().prepare(`INSERT INTO understanding_evidence_links (
    version_id, evidence_id, relation, confidence
  ) VALUES (?, ?, ?, ?)
  ON CONFLICT(version_id, evidence_id, relation) DO UPDATE SET confidence = excluded.confidence`)
    .run(versionId, evidenceId, relation, confidence);
}

export function listUnderstandingEvidence(
  understandingId: string,
  relation?: 'supports' | 'contradicts' | 'supersedes',
): ContextEvidence[] {
  const rows = getSqliteDatabase().prepare(`SELECT DISTINCT e.* FROM context_evidence e
    JOIN understanding_evidence_links l ON l.evidence_id = e.evidence_id
    JOIN user_understanding_versions v ON v.version_id = l.version_id
    WHERE v.understanding_id = ? AND (? IS NULL OR l.relation = ?)
    ORDER BY e.observed_at DESC`).all(understandingId, relation ?? null, relation ?? null) as Array<{
      evidence_id: string; source_type: ContextEvidence['sourceType']; source_instance_id: string | null;
      source_ref: string; redacted_excerpt: string | null; trust_level: ContextEvidence['trustLevel'];
      observed_at: number; created_at: number;
    }>;
  return rows.map((row) => ({
    id: row.evidence_id,
    sourceType: row.source_type,
    ...(row.source_instance_id ? { sourceInstanceId: row.source_instance_id } : {}),
    sourceRef: row.source_ref,
    ...(row.redacted_excerpt ? { redactedExcerpt: row.redacted_excerpt } : {}),
    trustLevel: row.trust_level,
    observedAt: row.observed_at,
    createdAt: row.created_at,
  }));
}

export function recordContextRun(input: {
  turnId: string;
  sessionKey: string;
  query: string;
  budget: number;
  durationMs: number;
  items: PersonalizationItem[];
  principalId?: string;
}): string {
  const existing = getSqliteDatabase().prepare('SELECT context_run_id FROM context_runs WHERE turn_id = ?')
    .get(input.turnId) as { context_run_id: string } | undefined;
  const runId = existing?.context_run_id ?? randomUUID();
  runSqliteWriteTransaction((db) => {
    if (existing) {
      db.prepare(`UPDATE context_runs SET principal_id = ?, session_key = ?, query = ?, budget = ?, duration_ms = ?
        WHERE context_run_id = ?`).run(input.principalId ?? USER_CONTEXT_PRINCIPAL_ID,
        input.sessionKey, input.query, input.budget, input.durationMs, runId);
      db.prepare('DELETE FROM context_run_items WHERE context_run_id = ?').run(runId);
    } else {
      db.prepare(`INSERT INTO context_runs (
        context_run_id, principal_id, turn_id, session_key, query, budget, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(runId, input.principalId ?? USER_CONTEXT_PRINCIPAL_ID,
        input.turnId, input.sessionKey, input.query, input.budget, input.durationMs, Date.now());
    }
    const insert = db.prepare(`INSERT INTO context_run_items (
      context_run_id, object_type, object_id, version_id, decision, reason, content_snapshot,
      source_label, rank, score, injected_chars
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of input.items) {
      insert.run(runId, item.objectType, item.objectId, item.versionId ?? null, item.decision,
        item.reason, item.content, item.sourceLabel, item.rank ?? null, item.score ?? null, item.injectedChars);
    }
  });
  return runId;
}

export function getTurnPersonalization(turnId: string): { runId: string; items: PersonalizationItem[] } | undefined {
  const db = getSqliteDatabase();
  const run = db.prepare('SELECT context_run_id FROM context_runs WHERE turn_id = ?').get(turnId) as { context_run_id: string } | undefined;
  if (!run) return undefined;
  const rows = db.prepare('SELECT * FROM context_run_items WHERE context_run_id = ? ORDER BY rank ASC, object_type ASC')
    .all(run.context_run_id) as Array<{
      object_type: PersonalizationItem['objectType']; object_id: string; version_id: string | null;
      decision: PersonalizationItem['decision']; reason: string; content_snapshot: string; source_label: string;
      rank: number | null; score: number | null; injected_chars: number;
    }>;
  return {
    runId: run.context_run_id,
    items: rows.map((row) => ({
      objectType: row.object_type,
      objectId: row.object_id,
      ...(row.version_id ? { versionId: row.version_id } : {}),
      decision: row.decision,
      reason: row.reason,
      content: row.content_snapshot,
      sourceLabel: row.source_label,
      ...(row.rank === null ? {} : { rank: row.rank }),
      ...(row.score === null ? {} : { score: row.score }),
      injectedChars: row.injected_chars,
    })),
  };
}

export function recordContextFeedback(input: {
  turnId: string;
  runId: string;
  objectType?: PersonalizationItem['objectType'];
  objectId?: string;
  rating: 'helpful' | 'irrelevant' | 'wrong' | 'stale' | 'sensitive';
  reason?: string;
}): void {
  if (Boolean(input.objectType) !== Boolean(input.objectId)) {
    throw new Error('objectType and objectId must be provided together');
  }
  getSqliteDatabase().prepare(`INSERT INTO context_feedback (
    feedback_id, turn_id, context_run_id, object_type, object_id, rating, reason, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT DO UPDATE SET rating = excluded.rating, reason = excluded.reason, created_at = excluded.created_at`)
    .run(randomUUID(), input.turnId, input.runId, input.objectType ?? null, input.objectId ?? null,
      input.rating, input.reason ?? null, Date.now());
}

export function hasContextConsent(understandingId: string, sessionKey: string): boolean {
  const now = Date.now();
  return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM context_consents
    WHERE understanding_id = ? AND status = 'granted'
      AND (grant_scope = 'always' OR session_key = ?)
      AND (expires_at IS NULL OR expires_at > ?)
    LIMIT 1`).get(understandingId, sessionKey, now));
}

export function consumeContextConsent(
  understandingId: string,
  sessionKey: string,
): 'granted' | 'denied' | 'missing' {
  const db = getSqliteDatabase();
  const now = Date.now();
  const granted = db.prepare(`SELECT consent_id, grant_scope FROM context_consents
    WHERE understanding_id = ? AND status = 'granted'
      AND (grant_scope = 'always' OR session_key = ?)
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY CASE grant_scope WHEN 'once' THEN 0 WHEN 'session' THEN 1 ELSE 2 END
    LIMIT 1`).get(understandingId, sessionKey, now) as {
      consent_id: string;
      grant_scope: 'once' | 'session' | 'always';
    } | undefined;
  if (granted) {
    if (granted.grant_scope === 'once') {
      db.prepare("UPDATE context_consents SET status = 'consumed', updated_at = ? WHERE consent_id = ?")
        .run(now, granted.consent_id);
    }
    return 'granted';
  }
  const denied = db.prepare(`SELECT 1 FROM context_consents
    WHERE understanding_id = ? AND session_key = ? AND status = 'denied' LIMIT 1`)
    .get(understandingId, sessionKey);
  return denied ? 'denied' : 'missing';
}

export function ensureContextConsent(
  understandingId: string,
  sessionKey: string,
  purpose: string,
): { id: string; understandingId: string; purpose: string } {
  const db = getSqliteDatabase();
  const existing = db.prepare(`SELECT consent_id, purpose FROM context_consents
    WHERE understanding_id = ? AND session_key = ? AND status = 'pending'`)
    .get(understandingId, sessionKey) as { consent_id: string; purpose: string } | undefined;
  if (existing) return { id: existing.consent_id, understandingId, purpose: existing.purpose };
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO context_consents (
    consent_id, principal_id, understanding_id, session_key, purpose, status,
    grant_scope, expires_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`)
    .run(id, USER_CONTEXT_PRINCIPAL_ID, understandingId, sessionKey, purpose, now, now);
  return { id, understandingId, purpose };
}

export function decideContextConsent(
  id: string,
  decision: 'once' | 'session' | 'always' | 'deny',
): boolean {
  const expiresAt = decision === 'once'
    ? Date.now() + 5 * 60_000
    : null;
  const result = getSqliteDatabase().prepare(`UPDATE context_consents
    SET status = ?, grant_scope = ?, expires_at = ?, updated_at = ? WHERE consent_id = ?`)
    .run(decision === 'deny' ? 'denied' : 'granted', decision === 'deny' ? null : decision,
      expiresAt, Date.now(), id);
  return Number(result.changes) > 0;
}

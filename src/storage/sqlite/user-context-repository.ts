import { createHash, randomUUID } from 'node:crypto';

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
import { retrievalQueryAuditValue } from '../../retrieval/audit.js';
import { buildFts5SearchQuery, fts5RankToScore } from './fts.js';
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

type EvidenceRow = {
  evidence_id: string;
  source_type: ContextEvidence['sourceType'];
  source_instance_id: string | null;
  source_ref: string;
  source_run_id: string | null;
  source_item_id: string | null;
  session_id: string | null;
  turn_id: string | null;
  message_id: string | null;
  content_hash: string | null;
  retention_policy: ContextEvidence['retentionPolicy'] | null;
  processing_policy: ContextEvidence['processingPolicy'] | null;
  extractor_id: string | null;
  extractor_version: string | null;
  redacted_excerpt: string | null;
  trust_level: ContextEvidence['trustLevel'];
  observed_at: number;
  ingested_at: number | null;
  created_at: number;
};

function evidenceFromRow(row: EvidenceRow): ContextEvidence {
  return {
    id: row.evidence_id, sourceType: row.source_type,
    ...(row.source_instance_id ? { sourceInstanceId: row.source_instance_id } : {}),
    sourceRef: row.source_ref,
    ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
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
  };
}

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
    role: string;
    primary_goal: string;
    pronouns: string;
    timezone: string;
    locale: string;
    accessibility_json: string;
    created_at: number;
    updated_at: number;
  } | undefined;
  if (!row) {
    return { callName: '', role: '', primaryGoal: '', pronouns: '', timezone: '', locale: '', accessibility: {}, createdAt: 0, updatedAt: 0 };
  }
  return {
    callName: row.call_name,
    role: row.role,
    primaryGoal: row.primary_goal,
    pronouns: row.pronouns,
    timezone: row.timezone,
    locale: row.locale,
    accessibility: JSON.parse(row.accessibility_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateUserProfile(
  patch: Partial<Pick<UserProfile, 'callName' | 'role' | 'primaryGoal' | 'pronouns' | 'timezone' | 'locale' | 'accessibility'>>,
  principalId = USER_CONTEXT_PRINCIPAL_ID,
): UserProfile {
  const current = getUserProfile(principalId);
  const now = Date.now();
  const next = { ...current, ...patch, createdAt: current.createdAt || now, updatedAt: now };
  runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO user_profiles (
        principal_id, call_name, role, primary_goal, pronouns, timezone, locale, accessibility_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(principal_id) DO UPDATE SET
        call_name = excluded.call_name,
        role = excluded.role,
        primary_goal = excluded.primary_goal,
        pronouns = excluded.pronouns,
        timezone = excluded.timezone,
        locale = excluded.locale,
        accessibility_json = excluded.accessibility_json,
        updated_at = excluded.updated_at
    `).run(
      principalId,
      next.callName,
      next.role,
      next.primaryGoal,
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

export function searchActiveUnderstandings(
  query: string,
  limit = 50,
): Array<{ understanding: UserUnderstanding; score: number }> {
  const ftsQuery = buildFts5SearchQuery(query);
  if (!ftsQuery) return [];
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = getSqliteDatabase().prepare(`
    SELECT u.*, v.statement, v.payload_json, bm25(user_understanding_fts) AS search_rank
    FROM user_understanding_fts
    JOIN user_understandings u
      ON u.understanding_id = user_understanding_fts.understanding_id
    JOIN user_understanding_versions v
      ON v.version_id = u.current_version_id
    WHERE user_understanding_fts MATCH ? AND u.principal_id = ? AND u.status = 'active'
    ORDER BY search_rank
    LIMIT ?
  `).all(ftsQuery, USER_CONTEXT_PRINCIPAL_ID, boundedLimit) as Array<UnderstandingRow & { search_rank: number }>;
  if (!rows.length) return [];
  const bestRank = Math.min(...rows.map((row) => row.search_rank));
  const worstRank = Math.max(...rows.map((row) => row.search_rank));
  return rows.map((row) => ({
    understanding: understandingFromRow(row),
    score: fts5RankToScore(row.search_rank, bestRank, worstRank),
  }));
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
  const assertionStatus = status === 'active' ? 'active'
    : status === 'archived' ? 'closed'
      : status === 'rejected' ? 'rejected' : 'candidate';
  getSqliteDatabase().prepare(`UPDATE context_temporal_assertions
    SET status = ?, updated_at = ? WHERE object_type = 'understanding' AND object_id = ?`)
    .run(assertionStatus, now, id);
  const result = getUnderstanding(id);
  if (!result) throw new Error(`User understanding not found: ${id}`);
  return result;
}

export function closeUnderstandingValidity(id: string, validTo = Date.now()): UserUnderstanding {
  getSqliteDatabase().prepare(`UPDATE user_understandings SET valid_to = ?, updated_at = ?
    WHERE understanding_id = ?`).run(validTo, validTo, id);
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
  input: Omit<ContextEvidence, 'id' | 'ingestedAt' | 'createdAt'> & { ingestedAt?: number },
  principalId = USER_CONTEXT_PRINCIPAL_ID,
): ContextEvidence {
  const existing = getSqliteDatabase().prepare(`SELECT * FROM context_evidence
    WHERE principal_id = ? AND source_type = ?
      AND COALESCE(source_instance_id, '') = COALESCE(?, '') AND source_ref = ?`)
    .get(principalId, input.sourceType, input.sourceInstanceId ?? null, input.sourceRef) as EvidenceRow | undefined;
  const derivedHash = input.contentHash ?? (input.redactedExcerpt
    ? createHash('sha256').update(input.redactedExcerpt).digest('hex')
    : undefined);
  if (existing) {
    getSqliteDatabase().prepare(`UPDATE context_evidence SET
      source_run_id = COALESCE(source_run_id, ?), source_item_id = COALESCE(source_item_id, ?),
      session_id = COALESCE(session_id, ?), turn_id = COALESCE(turn_id, ?),
      message_id = COALESCE(message_id, ?), content_hash = COALESCE(content_hash, ?),
      retention_policy = COALESCE(retention_policy, ?),
      processing_policy = CASE
        WHEN processing_policy = 'local_only' OR ? = 'local_only' THEN 'local_only'
        ELSE COALESCE(processing_policy, ?)
      END,
      extractor_id = COALESCE(extractor_id, ?), extractor_version = COALESCE(extractor_version, ?),
      ingested_at = COALESCE(ingested_at, ?)
      WHERE evidence_id = ?`).run(
      input.sourceRunId ?? null, input.sourceItemId ?? null, input.sessionId ?? null,
      input.turnId ?? null, input.messageId ?? null, derivedHash ?? null,
      input.retentionPolicy ?? null, input.processingPolicy ?? null, input.processingPolicy ?? null,
      input.extractorId ?? null, input.extractorVersion ?? null,
      input.ingestedAt ?? Date.now(), existing.evidence_id,
    );
    return evidenceFromRow(getSqliteDatabase().prepare('SELECT * FROM context_evidence WHERE evidence_id = ?')
      .get(existing.evidence_id) as EvidenceRow);
  }
  const createdAt = Date.now();
  const evidence: ContextEvidence = {
    ...input,
    id: randomUUID(),
    ...(derivedHash ? { contentHash: derivedHash } : {}),
    ingestedAt: input.ingestedAt ?? createdAt,
    createdAt,
  };
  getSqliteDatabase().prepare(`INSERT INTO context_evidence (
    evidence_id, principal_id, source_type, source_instance_id, source_ref, source_run_id,
    source_item_id, session_id, turn_id, message_id, content_hash, retention_policy,
    processing_policy, extractor_id, extractor_version, redacted_excerpt, trust_level,
    observed_at, ingested_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(evidence.id, principalId, evidence.sourceType, evidence.sourceInstanceId ?? null,
      evidence.sourceRef, evidence.sourceRunId ?? null, evidence.sourceItemId ?? null,
      evidence.sessionId ?? null, evidence.turnId ?? null, evidence.messageId ?? null,
      evidence.contentHash ?? null, evidence.retentionPolicy ?? null, evidence.processingPolicy ?? null,
      evidence.extractorId ?? null, evidence.extractorVersion ?? null, evidence.redactedExcerpt ?? null,
      evidence.trustLevel, evidence.observedAt, evidence.ingestedAt, evidence.createdAt);
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
    ORDER BY e.observed_at DESC`).all(understandingId, relation ?? null, relation ?? null) as EvidenceRow[];
  return rows.map(evidenceFromRow);
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
  const auditedQuery = retrievalQueryAuditValue(input.query);
  const existing = getSqliteDatabase().prepare('SELECT context_run_id FROM context_runs WHERE turn_id = ?')
    .get(input.turnId) as { context_run_id: string } | undefined;
  const runId = existing?.context_run_id ?? randomUUID();
  runSqliteWriteTransaction((db) => {
    if (existing) {
      db.prepare(`UPDATE context_runs SET principal_id = ?, session_key = ?, query = ?, budget = ?, duration_ms = ?
        WHERE context_run_id = ?`).run(input.principalId ?? USER_CONTEXT_PRINCIPAL_ID,
        input.sessionKey, auditedQuery, input.budget, input.durationMs, runId);
      db.prepare('DELETE FROM context_run_items WHERE context_run_id = ?').run(runId);
    } else {
      db.prepare(`INSERT INTO context_runs (
        context_run_id, principal_id, turn_id, session_key, query, budget, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(runId, input.principalId ?? USER_CONTEXT_PRINCIPAL_ID,
        input.turnId, input.sessionKey, auditedQuery, input.budget, input.durationMs, Date.now());
    }
    const insert = db.prepare(`INSERT INTO context_run_items (
      context_run_id, object_type, object_id, version_id, decision, reason, content_snapshot,
      source_label, origin, rank, score, injected_chars
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of input.items) {
      insert.run(runId, item.objectType, item.objectId, item.versionId ?? null, item.decision,
        item.reason, item.content, item.sourceLabel, item.origin,
        item.rank ?? null, item.score ?? null, item.injectedChars);
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
      origin: PersonalizationItem['origin']; rank: number | null; score: number | null; injected_chars: number;
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
      origin: row.origin,
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

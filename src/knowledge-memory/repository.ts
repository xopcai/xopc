import { randomUUID } from 'node:crypto';

import type { DatabaseSync } from 'node:sqlite';
import { inferMemorySensitivity } from '../agent/memory/sensitivity.js';

import { memoryFingerprint, isMemorySuppressed, suppressMemory, restoreMemory, clearMemoryAudit } from '../user-context/memory-suppression.js';
import { memorySearchQuery } from './search-text.js';
import { canUseKnowledge, knowledgeContentSources } from './usage-policy.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { USER_MODEL_PRINCIPAL_ID, validateScope, type UserModelScope } from '../user-model/domain.js';
import type {
  KnowledgeItem,
  KnowledgeKind,
  KnowledgeOriginClass,
  KnowledgeRecordClass,
  KnowledgeContentSource,
  KnowledgeReadPolicy,
  KnowledgeStatus,
  KnowledgeReviewAction,
  KnowledgeStatusActor,
  KnowledgeStatusEvent,
  KnowledgeVisibilityContext,
} from './domain.js';

type KnowledgeRow = {
  claim_mode: KnowledgeItem['claimMode'];
  verification: KnowledgeItem['verification'];
  sensitivity: KnowledgeItem['sensitivity'];
  knowledge_id: string;
  principal_id: string;
  kind: KnowledgeKind;
  scope_type: UserModelScope['type'];
  scope_id: string | null;
  content: string;
  canonical_key: string;
  record_class: KnowledgeRecordClass;
  status: KnowledgeStatus;
  confidence: number;
  importance: number;
  valid_from: number | null;
  valid_to: number | null;
  expires_at: number | null;
  review_at: number | null;
  origin_class: KnowledgeOriginClass;
  source_agent_id: string | null;
  source_conversation_id: string | null;
  source_turn_id: string | null;
  derived_from_recalled_context: number;
  source_json: string;
  created_at: number;
  updated_at: number;
};

export interface WriteKnowledgeInput {
  claimMode?: KnowledgeItem['claimMode'];
  verification?: KnowledgeItem['verification'];
  sensitivity?: KnowledgeItem['sensitivity'];
  evidence?: Array<{ id: string; contentHash?: string; consentReceiptId?: string }>;
  principalId?: string;
  kind: KnowledgeKind;
  scope: UserModelScope;
  content: string;
  canonicalKey: string;
  recordClass?: KnowledgeRecordClass;
  status?: KnowledgeStatus;
  confidence: number;
  importance: number;
  validFrom?: number;
  validTo?: number;
  expiresAt?: number;
  reviewAt?: number;
  originClass: KnowledgeOriginClass;
  sourceAgentId?: string;
  sourceConversationId?: string;
  sourceTurnId?: string;
  derivedFromRecalledContext?: boolean;
  source?: Record<string, unknown>;
  replaceExisting?: boolean;
  restoreDeleted?: boolean;
  now?: number;
}

export class KnowledgeReviewConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeReviewConflictError';
  }
}

function fromRow(row: KnowledgeRow): KnowledgeItem {
  return {
    id: row.knowledge_id,
    claimMode: row.claim_mode,
    verification: row.verification,
    sensitivity: row.sensitivity,
    principalId: row.principal_id,
    kind: row.kind,
    scope: { type: row.scope_type, ...(row.scope_id ? { id: row.scope_id } : {}) },
    content: row.content,
    canonicalKey: row.canonical_key,
    recordClass: row.record_class,
    status: row.status,
    confidence: row.confidence,
    importance: row.importance,
    ...(row.valid_from === null ? {} : { validFrom: row.valid_from }),
    ...(row.valid_to === null ? {} : { validTo: row.valid_to }),
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.review_at === null ? {} : { reviewAt: row.review_at }),
    originClass: row.origin_class,
    ...(row.source_agent_id ? { sourceAgentId: row.source_agent_id } : {}),
    ...(row.source_conversation_id ? { sourceConversationId: row.source_conversation_id } : {}),
    ...(row.source_turn_id ? { sourceTurnId: row.source_turn_id } : {}),
    derivedFromRecalledContext: row.derived_from_recalled_context === 1,
    source: JSON.parse(row.source_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bounded(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1.`);
}

function statusActorForOrigin(origin: KnowledgeOriginClass): KnowledgeStatusActor {
  return origin === 'owner' ? 'user' : origin === 'agent' ? 'agent' : 'runtime';
}

function insertStatusEvent(
  db: DatabaseSync,
  input: {
    knowledgeId: string;
    fromStatus: KnowledgeStatus | null;
    toStatus: KnowledgeStatus;
    actor: KnowledgeStatusActor;
    reason: string;
    now: number;
  },
): void {
  db.prepare(`INSERT INTO knowledge_item_status_events (
    event_id, knowledge_id, from_status, to_status, actor_type, reason, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    randomUUID(), input.knowledgeId, input.fromStatus, input.toStatus,
    input.actor, input.reason, input.now,
  );
}

export function writeKnowledgeItem(input: WriteKnowledgeInput): { item: KnowledgeItem; created: boolean } | { item?: undefined; created: false; suppressed: true } {
  validateScope(input.scope);
  bounded(input.confidence, 'confidence');
  bounded(input.importance, 'importance');
  if (!input.content.trim()) throw new Error('Knowledge content is required.');
  if (!input.canonicalKey.trim()) throw new Error('Knowledge canonical key is required.');
  if (input.validFrom !== undefined && input.validTo !== undefined && input.validTo < input.validFrom) {
    throw new Error('Knowledge validTo must be greater than or equal to validFrom.');
  }
  const principalId = input.principalId ?? USER_MODEL_PRINCIPAL_ID;
  const now = input.now ?? Date.now();
  const supportedExternal = input.originClass === 'untrusted' && input.verification === 'supported' && Boolean(input.evidence?.length) && input.confidence >= 0.7;
  const admittedStatus = input.status ?? (supportedExternal || input.originClass === 'owner' || (input.originClass !== 'untrusted'
    && input.confidence >= 0.7 && !input.derivedFromRecalledContext) ? 'active' : 'candidate');
  return runSqliteWriteTransaction((db) => {
    const keys = knowledgeFingerprints(input);
    if (input.restoreDeleted && input.originClass === 'owner') restoreMemory(db, keys);
    if (isMemorySuppressed(db, keys)) return { created: false, suppressed: true };
    const existingStatuses = input.replaceExisting
      ? ['candidate', 'active', 'needs_review', 'stale', 'archived']
      : ['candidate', 'active', 'needs_review', 'stale'];
    const existing = db.prepare(`SELECT * FROM knowledge_items WHERE principal_id = ?
      AND canonical_key = ? AND scope_type = ? AND COALESCE(scope_id, '') = COALESCE(?, '')
      AND status IN (${existingStatuses.map(() => '?').join(', ')})`)
      .get(principalId, input.canonicalKey.trim(), input.scope.type, input.scope.id ?? null,
        ...existingStatuses) as KnowledgeRow | undefined;
    if (existing && (!input.replaceExisting || (existing.origin_class === 'owner' && input.originClass !== 'owner'))) return { item: fromRow(existing), created: false };
    if (existing) {
      db.prepare('INSERT INTO knowledge_revisions(revision_id, knowledge_id, content, source_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), existing.knowledge_id, existing.content, existing.source_json, now);
      const nextStatus = admittedStatus;
      db.prepare(`UPDATE knowledge_items SET kind = ?, content = ?, record_class = ?, status = ?, confidence = ?,
        importance = ?, valid_from = ?, valid_to = ?, expires_at = ?, review_at = ?,
        origin_class = ?, source_agent_id = ?, source_conversation_id = ?, source_turn_id = ?,
        derived_from_recalled_context = ?, source_json = ?, updated_at = ? WHERE knowledge_id = ?`)
        .run(input.kind, input.content.trim(), input.recordClass ?? 'memory', nextStatus,
          input.confidence, input.importance, input.validFrom ?? null, input.validTo ?? null,
          input.expiresAt ?? null, input.reviewAt ?? null, input.originClass, input.sourceAgentId ?? null,
          input.sourceConversationId ?? null, input.sourceTurnId ?? null, input.derivedFromRecalledContext ? 1 : 0,
          JSON.stringify(input.source ?? {}), now, existing.knowledge_id);
      if (existing.status !== nextStatus) insertStatusEvent(db, {
        knowledgeId: existing.knowledge_id,
        fromStatus: existing.status,
        toStatus: nextStatus,
        actor: statusActorForOrigin(input.originClass),
        reason: 'Knowledge replaced from its source.',
        now,
      });
      writeEvidence(db, existing.knowledge_id, input);
      return {
        item: fromRow(db.prepare('SELECT * FROM knowledge_items WHERE knowledge_id = ?')
          .get(existing.knowledge_id) as KnowledgeRow),
        created: false,
      };
    }

    const id = randomUUID();
    const status = admittedStatus;
    db.prepare(`INSERT INTO knowledge_items (
      knowledge_id, principal_id, kind, scope_type, scope_id, content, canonical_key, record_class,
      status, confidence, importance, valid_from, valid_to, expires_at, review_at,
      origin_class, source_agent_id, source_conversation_id, source_turn_id,
      derived_from_recalled_context, source_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, principalId, input.kind, input.scope.type, input.scope.id ?? null, input.content.trim(),
        input.canonicalKey.trim(), input.recordClass ?? 'memory',
        status,
        input.confidence, input.importance, input.validFrom ?? null, input.validTo ?? null,
        input.expiresAt ?? null, input.reviewAt ?? null, input.originClass,
        input.sourceAgentId ?? null, input.sourceConversationId ?? null, input.sourceTurnId ?? null,
        input.derivedFromRecalledContext ? 1 : 0, JSON.stringify(input.source ?? {}), now, now);
    insertStatusEvent(db, {
      knowledgeId: id,
      fromStatus: null,
      toStatus: status,
      actor: statusActorForOrigin(input.originClass),
      reason: 'Knowledge admitted.',
      now,
    });
    writeEvidence(db, id, input);
    return {
      item: fromRow(db.prepare('SELECT * FROM knowledge_items WHERE knowledge_id = ?').get(id) as KnowledgeRow),
      created: true,
    };
  });
}

export function getKnowledgeItem(id: string): KnowledgeItem | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM knowledge_items WHERE knowledge_id = ?')
    .get(id) as KnowledgeRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function listKnowledgeItems(input: {
  principalId?: string;
  scope?: UserModelScope;
  canonicalKey?: string;
  statuses?: KnowledgeStatus[];
  recordClass?: KnowledgeRecordClass;
  limit?: number;
} = {}): KnowledgeItem[] {
  const statuses = input.statuses ?? ['active', 'candidate', 'needs_review', 'stale'];
  if (!statuses.length) return [];
  const placeholders = statuses.map(() => '?').join(', ');
  const rows = getSqliteDatabase().prepare(`SELECT * FROM knowledge_items
    WHERE principal_id = ? AND status IN (${placeholders})
      ${input.recordClass ? 'AND record_class = ?' : ''}
      ${input.scope ? "AND scope_type = ? AND COALESCE(scope_id, '') = COALESCE(?, '')" : ''}
      ${input.canonicalKey ? 'AND canonical_key = ?' : ''}
    ORDER BY importance DESC, updated_at DESC LIMIT ?`).all(
      input.principalId ?? USER_MODEL_PRINCIPAL_ID,
      ...statuses,
      ...(input.recordClass ? [input.recordClass] : []),
      ...(input.scope ? [input.scope.type, input.scope.id ?? null] : []),
      ...(input.canonicalKey ? [input.canonicalKey] : []),
      Math.max(1, Math.min(2_000, input.limit ?? 200)),
    ) as KnowledgeRow[];
  return rows.map(fromRow);
}

export function transitionKnowledgeStatus(input: {
  id: string;
  status: KnowledgeStatus;
  actor: KnowledgeStatusActor;
  reason: string;
  expectedStatus?: KnowledgeStatus;
  content?: string;
  now?: number;
}): KnowledgeItem | undefined {
  const reason = input.reason.trim();
  if (!reason) throw new Error('A knowledge status change reason is required.');
  const content = input.content?.trim();
  if (input.content !== undefined && !content) throw new Error('Knowledge content is required.');
  const now = input.now ?? Date.now();
  return runSqliteWriteTransaction((db) => {
    const current = db.prepare('SELECT * FROM knowledge_items WHERE knowledge_id = ?')
      .get(input.id) as KnowledgeRow | undefined;
    if (!current) return undefined;
    if (input.expectedStatus && current.status !== input.expectedStatus) {
      throw new KnowledgeReviewConflictError(
        `Knowledge status changed from ${input.expectedStatus} to ${current.status}.`,
      );
    }
    db.prepare(`UPDATE knowledge_items SET status = ?, content = COALESCE(?, content),
      origin_class = CASE WHEN ? THEN 'owner' ELSE origin_class END, updated_at = ?
      WHERE knowledge_id = ?`).run(input.status, content ?? null, input.actor === 'user' && input.status === 'active' ? 1 : 0, now, input.id);
    if (input.actor === 'user' && input.status === 'active') {
      db.prepare("UPDATE knowledge_items SET claim_mode = 'explicit', verification = 'supported' WHERE knowledge_id = ?").run(input.id);
    }
    if (content !== undefined) {
      db.prepare('INSERT INTO knowledge_revisions(revision_id, knowledge_id, content, source_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), input.id, current.content, current.source_json, now);
      db.prepare('DELETE FROM knowledge_evidence_links WHERE knowledge_id = ?').run(input.id);
      db.prepare("UPDATE knowledge_items SET claim_mode = 'explicit', verification = 'supported', source_json = '{}' WHERE knowledge_id = ?").run(input.id);
    }
    if (input.actor === 'user' && (input.status === 'rejected' || input.status === 'archived')) {
      suppressMemory(db, knowledgeFingerprints(fromRow(current)), now);
    }
    insertStatusEvent(db, {
      knowledgeId: input.id,
      fromStatus: current.status,
      toStatus: input.status,
      actor: input.actor,
      reason,
      now,
    });
    return fromRow(db.prepare('SELECT * FROM knowledge_items WHERE knowledge_id = ?').get(input.id) as KnowledgeRow);
  });
}

const REVIEW_TRANSITIONS: Record<KnowledgeReviewAction, {
  from: readonly KnowledgeStatus[];
  to: KnowledgeStatus;
  requiresContent?: boolean;
}> = {
  approve: { from: ['candidate', 'needs_review', 'stale'], to: 'active' },
  edit_and_approve: { from: ['candidate', 'needs_review', 'stale', 'active'], to: 'active', requiresContent: true },
  reject: { from: ['candidate', 'needs_review', 'stale'], to: 'rejected' },
  archive: { from: ['candidate', 'needs_review', 'stale', 'active'], to: 'archived' },
};

export function reviewKnowledgeItem(input: {
  id: string;
  action: KnowledgeReviewAction;
  actor: KnowledgeStatusActor;
  reason: string;
  expectedStatus?: KnowledgeStatus;
  content?: string;
  now?: number;
}): KnowledgeItem | undefined {
  const current = getKnowledgeItem(input.id);
  if (!current) return undefined;
  const transition = REVIEW_TRANSITIONS[input.action];
  if (!transition.from.includes(current.status)) {
    throw new KnowledgeReviewConflictError(`Cannot ${input.action} knowledge with status ${current.status}.`);
  }
  if (transition.requiresContent && !input.content?.trim()) {
    throw new Error('Edited knowledge content is required.');
  }
  return transitionKnowledgeStatus({
    id: input.id,
    status: transition.to,
    actor: input.actor,
    reason: input.reason,
    expectedStatus: input.expectedStatus ?? current.status,
    ...(input.content === undefined ? {} : { content: input.content }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export function listKnowledgeStatusEvents(knowledgeId: string): KnowledgeStatusEvent[] {
  return (getSqliteDatabase().prepare(`SELECT event_id, knowledge_id, from_status, to_status,
    actor_type, reason, created_at FROM knowledge_item_status_events
    WHERE knowledge_id = ? ORDER BY created_at ASC, event_id ASC`).all(knowledgeId) as Array<{
      event_id: string;
      knowledge_id: string;
      from_status: KnowledgeStatus | null;
      to_status: KnowledgeStatus;
      actor_type: KnowledgeStatusActor;
      reason: string;
      created_at: number;
    }>).map((row) => ({
      id: row.event_id,
      knowledgeId: row.knowledge_id,
      ...(row.from_status === null ? {} : { fromStatus: row.from_status }),
      toStatus: row.to_status,
      actor: row.actor_type,
      reason: row.reason,
      createdAt: row.created_at,
    }));
}

function visibilityClause(
  context: KnowledgeVisibilityContext,
  policy?: KnowledgeReadPolicy,
): { sql: string; values: string[] } {
  const allowed = new Set(policy?.scopes ?? ['global', 'agent', 'workspace', 'project', 'session']);
  const parts: string[] = [];
  const values: string[] = [];
  if (allowed.has('global')) parts.push("k.scope_type = 'global'");
  if (allowed.has('agent')) {
    parts.push("(k.scope_type = 'agent' AND k.scope_id = ?)");
    values.push(context.agentId ?? '');
  }
  if (allowed.has('workspace')) {
    parts.push("(k.scope_type = 'workspace' AND k.scope_id = ?)");
    values.push(context.workspaceId ?? '');
  }
  if (allowed.has('session')) {
    parts.push("(k.scope_type = 'session' AND k.scope_id = ?)");
    values.push(context.conversationId ?? '');
  }
  if (allowed.has('project') && context.projectId) {
    parts.push("(k.scope_type = 'project' AND k.scope_id = ?)");
    values.push(context.projectId);
  }
  return { sql: `(${parts.length ? parts.join(' OR ') : '0'})`, values };
}

export function searchKnowledgeItems(input: {
  query: string;
  context: KnowledgeVisibilityContext;
  principalId?: string;
  asOf?: number;
  recordClass?: KnowledgeRecordClass;
  trustedOnly?: boolean;
  policy?: KnowledgeReadPolicy;
  limit?: number;
}): KnowledgeItem[] {
  const principalId = input.principalId ?? USER_MODEL_PRINCIPAL_ID;
  const asOf = input.asOf ?? Date.now();
  const limit = Math.max(1, Math.min(100, input.limit ?? 12));
  const visible = visibilityClause(input.context, input.policy);
  const fts = memorySearchQuery(input.query);
  if (!fts) return [];
  const rows = getSqliteDatabase().prepare(`SELECT k.*, bm25(knowledge_search_fts) AS rank
    FROM knowledge_search_fts JOIN knowledge_items k ON k.knowledge_id = knowledge_search_fts.knowledge_id
    WHERE knowledge_search_fts MATCH ? AND k.principal_id = ? AND k.status = 'active'
      AND (k.valid_from IS NULL OR k.valid_from <= ?)
      AND (k.valid_to IS NULL OR k.valid_to >= ?)
      AND (k.expires_at IS NULL OR k.expires_at >= ?)
      AND (k.review_at IS NULL OR k.review_at > ?)
      ${input.recordClass ? 'AND k.record_class = ?' : ''}
      ${input.trustedOnly ? "AND k.origin_class != 'untrusted'" : ''}
      AND ${visible.sql}
    ORDER BY rank ASC, k.importance DESC, k.updated_at DESC LIMIT ?`)
    .all(fts, principalId, asOf, asOf, asOf, asOf,
      ...(input.recordClass ? [input.recordClass] : []), ...visible.values, Math.min(1000, limit * 10)) as KnowledgeRow[];
  const selected = rows.map(fromRow).filter(item => canUseKnowledge(item, input.context, input.policy, asOf));
  const chunks = getSqliteDatabase().prepare(`SELECT k.*, c.text AS chunk_text
    FROM knowledge_chunks_fts f JOIN knowledge_source_chunks c ON c.chunk_id = f.chunk_id
    JOIN knowledge_source_items s ON s.item_id = c.source_item_id AND s.content_hash = c.source_version
    JOIN knowledge_items k ON json_extract(k.source_json, '$.sourceItemId') = s.item_id
    WHERE knowledge_chunks_fts MATCH ? AND s.deleted_at IS NULL AND k.principal_id = ?
      AND c.consent_receipt_id = json_extract(k.source_json, '$.consentReceiptId')
      ${input.recordClass ? 'AND k.record_class = ?' : ''} AND ${visible.sql}
    ORDER BY bm25(knowledge_chunks_fts) LIMIT ?`).all(fts, principalId,
      ...(input.recordClass ? [input.recordClass] : []), ...visible.values, Math.min(1000, limit * 10)) as Array<KnowledgeRow & { chunk_text: string }>;
  const seen = new Set(selected.map(item => item.id));
  for (const row of chunks) {
    const item = fromRow(row);
    if (!seen.has(item.id) && (!input.trustedOnly || item.originClass !== 'untrusted')
      && canUseKnowledge(item, input.context, input.policy, asOf)) {
      selected.push({ ...item, retrievalSnippet: row.chunk_text });
      seen.add(item.id);
    }
  }
  return selected.slice(0, limit);
}

export function classifyKnowledgeContentSource(item: KnowledgeItem): KnowledgeContentSource {
  if (item.recordClass === 'memory') return 'memory';
  return item.source.kind === 'product_import' ? 'local_import' : 'connector';
}

export function knowledgeItemAllowed(
  item: KnowledgeItem,
  policy: KnowledgeReadPolicy,
): boolean {
  return policy.scopes.includes(item.scope.type)
    && knowledgeContentSources(item).every(source => policy.contentSources.includes(source));
}

function knowledgeFingerprints(input: Pick<WriteKnowledgeInput, 'principalId' | 'scope' | 'canonicalKey' | 'content'>): string[] {
  const principal = input.principalId ?? USER_MODEL_PRINCIPAL_ID;
  return [
    memoryFingerprint(['knowledge-key', principal, input.scope.type, input.scope.id ?? '', input.canonicalKey]),
    memoryFingerprint(['knowledge-content', principal, input.scope.type, input.scope.id ?? '', input.content]),
  ];
}

export function deleteKnowledgeItem(id: string, now = Date.now()): boolean {
  return runSqliteWriteTransaction((db) => {
    const rows = db.prepare(`WITH RECURSIVE deleted(id) AS (
      SELECT knowledge_id FROM knowledge_items WHERE knowledge_id = ?
      UNION SELECT k.knowledge_id FROM knowledge_items k JOIN deleted d
        ON json_extract(k.source_json, '$.episodeKnowledgeId') = d.id
        OR k.knowledge_id = (SELECT json_extract(source_json, '$.episodeKnowledgeId')
          FROM knowledge_items WHERE knowledge_id = d.id)
    ) SELECT * FROM knowledge_items WHERE knowledge_id IN (SELECT id FROM deleted)`).all(id) as KnowledgeRow[];
    for (const row of rows) {
      const item = fromRow(row);
      suppressMemory(db, knowledgeFingerprints(item), now);
      clearMemoryAudit(db, 'knowledge', item.id);
      if (item.recordClass === 'source_index' && typeof item.source.sourceItemId === 'string') {
        db.prepare('DELETE FROM knowledge_source_chunks WHERE source_item_id = ?').run(item.source.sourceItemId);
      }
      db.prepare('DELETE FROM knowledge_items WHERE knowledge_id = ?').run(item.id);
    }
    return rows.length > 0;
  });
}

export function isKnowledgeCurrent(item: KnowledgeItem, asOf = Date.now()): boolean {
  return item.status === 'active'
    && (item.validFrom === undefined || item.validFrom <= asOf)
    && (item.validTo === undefined || item.validTo >= asOf)
    && (item.expiresAt === undefined || item.expiresAt >= asOf)
    && (item.reviewAt === undefined || item.reviewAt > asOf);
}

function writeEvidence(db: DatabaseSync, id: string, input: WriteKnowledgeInput): void {
  db.prepare('UPDATE knowledge_items SET claim_mode = ?, verification = ?, sensitivity = ? WHERE knowledge_id = ?')
    .run(input.claimMode ?? (input.originClass === 'owner' ? 'explicit' : input.originClass === 'untrusted' ? 'reported' : 'observed'),
      input.verification ?? (input.originClass === 'untrusted' && (input.recordClass ?? 'memory') === 'memory' ? 'tentative' : 'supported'),
      input.sensitivity ?? inferMemorySensitivity(input.content), id);
  db.prepare('DELETE FROM knowledge_evidence_links WHERE knowledge_id = ?').run(id);
  for (const evidence of input.evidence ?? []) {
    db.prepare('INSERT INTO knowledge_evidence_links(knowledge_id, evidence_id, content_hash, consent_receipt_id) VALUES (?, ?, ?, ?)')
      .run(id, evidence.id, evidence.contentHash ?? null, evidence.consentReceiptId ?? null);
  }
}

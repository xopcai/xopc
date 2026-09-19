import { randomUUID } from 'node:crypto';

import type { DatabaseSync } from 'node:sqlite';

import { buildFts5SearchQuery } from '../storage/sqlite/fts.js';
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

export function writeKnowledgeItem(input: WriteKnowledgeInput): { item: KnowledgeItem; created: boolean } {
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
  return runSqliteWriteTransaction((db) => {
    const existingStatuses = input.replaceExisting
      ? ['candidate', 'active', 'needs_review', 'stale', 'archived']
      : ['candidate', 'active', 'needs_review', 'stale'];
    const existing = db.prepare(`SELECT * FROM knowledge_items WHERE principal_id = ?
      AND canonical_key = ? AND scope_type = ? AND COALESCE(scope_id, '') = COALESCE(?, '')
      AND status IN (${existingStatuses.map(() => '?').join(', ')})`)
      .get(principalId, input.canonicalKey.trim(), input.scope.type, input.scope.id ?? null,
        ...existingStatuses) as KnowledgeRow | undefined;
    if (existing && !input.replaceExisting) return { item: fromRow(existing), created: false };
    if (existing) {
      const nextStatus = input.status ?? (input.originClass === 'owner' ? 'active' : 'candidate');
      db.prepare(`UPDATE knowledge_items SET kind = ?, content = ?, record_class = ?, status = ?, confidence = ?,
        importance = ?, valid_from = ?, valid_to = ?, expires_at = ?, review_at = ?,
        origin_class = ?, source_agent_id = ?, source_conversation_id = ?, source_turn_id = ?,
        derived_from_recalled_context = ?, source_json = ?, updated_at = ? WHERE knowledge_id = ?`)
        .run(input.kind, input.content.trim(), input.recordClass ?? 'memory', nextStatus,
          input.confidence, input.importance, input.validFrom ?? null, input.validTo ?? null,
          input.expiresAt ?? null, input.reviewAt ?? null, input.originClass, input.sourceAgentId ?? null,
          input.sourceConversationId ?? null, input.sourceTurnId ?? null, input.derivedFromRecalledContext ? 1 : 0,
          JSON.stringify(input.source ?? {}), now, existing.knowledge_id);
      db.prepare('DELETE FROM knowledge_items_fts WHERE knowledge_id = ?').run(existing.knowledge_id);
      db.prepare('INSERT INTO knowledge_items_fts(content, knowledge_id) VALUES (?, ?)')
        .run(input.content.trim(), existing.knowledge_id);
      if (existing.status !== nextStatus) insertStatusEvent(db, {
        knowledgeId: existing.knowledge_id,
        fromStatus: existing.status,
        toStatus: nextStatus,
        actor: statusActorForOrigin(input.originClass),
        reason: 'Knowledge replaced from its source.',
        now,
      });
      return {
        item: fromRow(db.prepare('SELECT * FROM knowledge_items WHERE knowledge_id = ?')
          .get(existing.knowledge_id) as KnowledgeRow),
        created: false,
      };
    }

    const id = randomUUID();
    const status = input.status ?? (input.originClass === 'owner' ? 'active' : 'candidate');
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
    db.prepare('INSERT INTO knowledge_items_fts(content, knowledge_id) VALUES (?, ?)')
      .run(input.content.trim(), id);
    insertStatusEvent(db, {
      knowledgeId: id,
      fromStatus: null,
      toStatus: status,
      actor: statusActorForOrigin(input.originClass),
      reason: 'Knowledge admitted.',
      now,
    });
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
    db.prepare(`UPDATE knowledge_items SET status = ?, content = COALESCE(?, content), updated_at = ?
      WHERE knowledge_id = ?`).run(input.status, content ?? null, now, input.id);
    if (content !== undefined) {
      db.prepare('DELETE FROM knowledge_items_fts WHERE knowledge_id = ?').run(input.id);
      db.prepare('INSERT INTO knowledge_items_fts(content, knowledge_id) VALUES (?, ?)')
        .run(content, input.id);
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
  edit_and_approve: { from: ['candidate', 'needs_review', 'stale'], to: 'active', requiresContent: true },
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

function contentSourceClause(policy?: KnowledgeReadPolicy): string {
  if (!policy) return '1';
  const allowed = new Set(policy.contentSources);
  const importedSource = "COALESCE(json_extract(k.source_json, '$.kind'), '') = 'product_import'";
  const parts: string[] = [];
  if (allowed.has('memory')) parts.push("k.record_class = 'memory'");
  if (allowed.has('local_import')) parts.push(`(k.record_class = 'source_index' AND ${importedSource})`);
  if (allowed.has('connector')) parts.push(`(k.record_class = 'source_index' AND NOT (${importedSource}))`);
  return `(${parts.length ? parts.join(' OR ') : '0'})`;
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
  const contentSource = contentSourceClause(input.policy);
  const fts = buildFts5SearchQuery(input.query);
  if (!fts) return [];
  const rows = getSqliteDatabase().prepare(`SELECT k.*, bm25(knowledge_items_fts) AS rank
    FROM knowledge_items_fts JOIN knowledge_items k ON k.knowledge_id = knowledge_items_fts.knowledge_id
    WHERE knowledge_items_fts MATCH ? AND k.principal_id = ? AND k.status = 'active'
      AND (k.valid_from IS NULL OR k.valid_from <= ?)
      AND (k.valid_to IS NULL OR k.valid_to >= ?)
      AND (k.expires_at IS NULL OR k.expires_at >= ?)
      ${input.recordClass ? 'AND k.record_class = ?' : ''}
      ${input.trustedOnly ? "AND k.origin_class != 'untrusted'" : ''}
      AND ${contentSource}
      AND ${visible.sql}
    ORDER BY rank ASC, k.importance DESC, k.updated_at DESC LIMIT ?`)
    .all(fts, principalId, asOf, asOf, asOf,
      ...(input.recordClass ? [input.recordClass] : []), ...visible.values, limit) as KnowledgeRow[];
  return rows.map(fromRow);
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
    && policy.contentSources.includes(classifyKnowledgeContentSource(item));
}

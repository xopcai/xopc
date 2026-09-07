import { randomUUID } from 'node:crypto';

import { buildFts5SearchQuery } from '../storage/sqlite/fts.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { USER_MODEL_PRINCIPAL_ID, validateScope, type UserModelScope } from '../user-model/domain.js';
import type {
  KnowledgeItem,
  KnowledgeKind,
  KnowledgeOriginClass,
  KnowledgeRecordClass,
  KnowledgeSource,
  KnowledgeStatus,
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
  source_session_id: string | null;
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
  sourceSessionId?: string;
  sourceTurnId?: string;
  derivedFromRecalledContext?: boolean;
  source?: Record<string, unknown>;
  replaceExisting?: boolean;
  now?: number;
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
    ...(row.source_session_id ? { sourceSessionId: row.source_session_id } : {}),
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
      db.prepare(`UPDATE knowledge_items SET kind = ?, content = ?, record_class = ?, status = ?, confidence = ?,
        importance = ?, valid_from = ?, valid_to = ?, expires_at = ?, review_at = ?,
        origin_class = ?, source_agent_id = ?, source_session_id = ?, source_turn_id = ?,
        derived_from_recalled_context = ?, source_json = ?, updated_at = ? WHERE knowledge_id = ?`)
        .run(input.kind, input.content.trim(), input.recordClass ?? 'memory',
          input.status ?? (input.originClass === 'owner' ? 'active' : 'candidate'),
          input.confidence, input.importance, input.validFrom ?? null, input.validTo ?? null,
          input.expiresAt ?? null, input.reviewAt ?? null, input.originClass, input.sourceAgentId ?? null,
          input.sourceSessionId ?? null, input.sourceTurnId ?? null, input.derivedFromRecalledContext ? 1 : 0,
          JSON.stringify(input.source ?? {}), now, existing.knowledge_id);
      db.prepare('DELETE FROM knowledge_items_fts WHERE knowledge_id = ?').run(existing.knowledge_id);
      db.prepare('INSERT INTO knowledge_items_fts(content, knowledge_id) VALUES (?, ?)')
        .run(input.content.trim(), existing.knowledge_id);
      return {
        item: fromRow(db.prepare('SELECT * FROM knowledge_items WHERE knowledge_id = ?')
          .get(existing.knowledge_id) as KnowledgeRow),
        created: false,
      };
    }

    const id = randomUUID();
    db.prepare(`INSERT INTO knowledge_items (
      knowledge_id, principal_id, kind, scope_type, scope_id, content, canonical_key, record_class,
      status, confidence, importance, valid_from, valid_to, expires_at, review_at,
      origin_class, source_agent_id, source_session_id, source_turn_id,
      derived_from_recalled_context, source_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, principalId, input.kind, input.scope.type, input.scope.id ?? null, input.content.trim(),
        input.canonicalKey.trim(), input.recordClass ?? 'memory',
        input.status ?? (input.originClass === 'owner' ? 'active' : 'candidate'),
        input.confidence, input.importance, input.validFrom ?? null, input.validTo ?? null,
        input.expiresAt ?? null, input.reviewAt ?? null, input.originClass,
        input.sourceAgentId ?? null, input.sourceSessionId ?? null, input.sourceTurnId ?? null,
        input.derivedFromRecalledContext ? 1 : 0, JSON.stringify(input.source ?? {}), now, now);
    db.prepare('INSERT INTO knowledge_items_fts(content, knowledge_id) VALUES (?, ?)')
      .run(input.content.trim(), id);
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
    ORDER BY importance DESC, updated_at DESC LIMIT ?`).all(
      input.principalId ?? USER_MODEL_PRINCIPAL_ID,
      ...statuses,
      ...(input.recordClass ? [input.recordClass] : []),
      Math.max(1, Math.min(2_000, input.limit ?? 200)),
    ) as KnowledgeRow[];
  return rows.map(fromRow);
}

export function setKnowledgeStatus(id: string, status: KnowledgeStatus, now = Date.now()): KnowledgeItem | undefined {
  const result = getSqliteDatabase().prepare(`UPDATE knowledge_items SET status = ?, updated_at = ?
    WHERE knowledge_id = ?`).run(status, now, id);
  return result.changes ? getKnowledgeItem(id) : undefined;
}

function visibilityClause(context: KnowledgeVisibilityContext): { sql: string; values: string[] } {
  const parts = ["k.scope_type = 'global'", "(k.scope_type = 'agent' AND k.scope_id = ?)",
    "(k.scope_type = 'workspace' AND k.scope_id = ?)", "(k.scope_type = 'session' AND k.scope_id = ?)"];
  const values = [context.agentId ?? '', context.workspaceId ?? '', context.sessionId ?? ''];
  if (context.projectId) {
    parts.push("(k.scope_type = 'project' AND k.scope_id = ?)");
    values.push(context.projectId);
  }
  return { sql: `(${parts.join(' OR ')})`, values };
}

export function searchKnowledgeItems(input: {
  query: string;
  context: KnowledgeVisibilityContext;
  principalId?: string;
  asOf?: number;
  recordClass?: KnowledgeRecordClass;
  trustedOnly?: boolean;
  sources?: readonly KnowledgeSource[];
  limit?: number;
}): KnowledgeItem[] {
  const principalId = input.principalId ?? USER_MODEL_PRINCIPAL_ID;
  const asOf = input.asOf ?? Date.now();
  const limit = Math.max(1, Math.min(100, input.limit ?? 12));
  const visible = visibilityClause(input.context);
  const sourceParts: string[] = [];
  const sourceValues: string[] = [];
  if (input.sources?.includes('connector')) sourceParts.push("k.record_class = 'source_index'");
  const memoryScopes = input.sources?.filter((source) => source !== 'connector') ?? [];
  if (memoryScopes.length) {
    sourceParts.push(`(k.record_class = 'memory' AND k.scope_type IN (${memoryScopes.map(() => '?').join(', ')}))`);
    sourceValues.push(...memoryScopes);
  }
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
      ${input.sources ? `AND (${sourceParts.length ? sourceParts.join(' OR ') : '0'})` : ''}
      AND ${visible.sql}
    ORDER BY rank ASC, k.importance DESC, k.updated_at DESC LIMIT ?`)
    .all(fts, principalId, asOf, asOf, asOf,
      ...(input.recordClass ? [input.recordClass] : []), ...sourceValues, ...visible.values, limit) as KnowledgeRow[];
  return rows.map(fromRow);
}

export function knowledgeSourceAllowed(
  item: KnowledgeItem,
  sources: readonly KnowledgeSource[],
): boolean {
  if (item.recordClass === 'source_index') return sources.includes('connector');
  return item.scope.type === 'session'
    ? sources.includes('session')
    : item.scope.type === 'workspace'
      ? sources.includes('workspace')
      : item.scope.type === 'project'
        ? sources.includes('project')
        : false;
}

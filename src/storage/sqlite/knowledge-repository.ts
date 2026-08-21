import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  KnowledgeSourceChange,
  KnowledgeSourceItem,
  KnowledgeSourceItemInput,
  KnowledgeSyncRun,
  KnowledgeSyncRunStatus,
  KnowledgeSynthesisPipeline,
  KnowledgeSynthesisStatus,
} from '../../knowledge/types.js';
import type { MemoryEvidence, MemoryEvidenceRelation } from '../../agent/memory/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type KnowledgeSourceItemRow = {
  item_id: string;
  source_instance_id: string;
  collection_scope: string;
  external_id: string;
  item_type: string;
  author_role: string | null;
  occurred_at: number | null;
  source_updated_at: number | null;
  content_hash: string;
  normalized_text: string | null;
  payload_ref: string | null;
  metadata_json: string;
  sensitivity: string;
  retention_class: string;
  synthesis_pipeline: string;
  synthesis_status: string;
  synthesis_attempts: number;
  synthesis_claimed_at: number | null;
  synthesis_claimed_by: string | null;
  synthesis_error: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
};

type KnowledgeSourceChangeRow = {
  sequence: number;
  change_id: string;
  source_instance_id: string;
  source_item_id: string;
  change_kind: string;
  old_hash: string | null;
  new_hash: string | null;
  changed_at: number;
};

type KnowledgeSyncRunRow = {
  run_id: string;
  source_instance_id: string;
  status: string;
  cursor_before: string | null;
  cursor_after: string | null;
  items_seen: number;
  items_created: number;
  items_updated: number;
  warnings_json: string;
  error: string | null;
  started_at: number;
  finished_at: number | null;
};

type MemoryEvidenceRow = {
  evidence_id: string;
  record_id: string;
  source_item_id: string | null;
  relation: string;
  excerpt: string | null;
  confidence: number | null;
  observed_at: number | null;
  session_key: string | null;
  turn_id: string | null;
  tool_call_id: string | null;
  created_at: number;
};

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampToIso(value: number | null): string | undefined {
  return value == null ? undefined : new Date(value).toISOString();
}

function parseRecord(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseStrings(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function sourceItemFromRow(row: KnowledgeSourceItemRow): KnowledgeSourceItem {
  return {
    id: row.item_id,
    sourceInstanceId: row.source_instance_id,
    collectionScope: row.collection_scope,
    externalId: row.external_id,
    itemType: row.item_type,
    ...(row.author_role ? { authorRole: row.author_role as KnowledgeSourceItem['authorRole'] } : {}),
    ...(timestampToIso(row.occurred_at) ? { occurredAt: timestampToIso(row.occurred_at) } : {}),
    ...(timestampToIso(row.source_updated_at) ? { sourceUpdatedAt: timestampToIso(row.source_updated_at) } : {}),
    contentHash: row.content_hash,
    ...(row.normalized_text ? { normalizedText: row.normalized_text } : {}),
    ...(row.payload_ref ? { payloadRef: row.payload_ref } : {}),
    metadata: parseRecord(row.metadata_json),
    sensitivity: row.sensitivity as KnowledgeSourceItem['sensitivity'],
    retentionClass: row.retention_class as KnowledgeSourceItem['retentionClass'],
    synthesisPipeline: row.synthesis_pipeline as KnowledgeSourceItem['synthesisPipeline'],
    synthesisStatus: row.synthesis_status as KnowledgeSourceItem['synthesisStatus'],
    synthesisAttempts: row.synthesis_attempts,
    ...(timestampToIso(row.synthesis_claimed_at) ? { synthesisClaimedAt: timestampToIso(row.synthesis_claimed_at) } : {}),
    ...(row.synthesis_claimed_by ? { synthesisClaimedBy: row.synthesis_claimed_by } : {}),
    ...(row.synthesis_error ? { synthesisError: row.synthesis_error } : {}),
    ...(timestampToIso(row.deleted_at) ? { deletedAt: timestampToIso(row.deleted_at) } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function sourceChangeFromRow(row: KnowledgeSourceChangeRow): KnowledgeSourceChange {
  return {
    sequence: row.sequence,
    id: row.change_id,
    sourceInstanceId: row.source_instance_id,
    sourceItemId: row.source_item_id,
    kind: row.change_kind as KnowledgeSourceChange['kind'],
    ...(row.old_hash ? { oldHash: row.old_hash } : {}),
    ...(row.new_hash ? { newHash: row.new_hash } : {}),
    changedAt: new Date(row.changed_at).toISOString(),
  };
}

function syncRunFromRow(row: KnowledgeSyncRunRow): KnowledgeSyncRun {
  return {
    id: row.run_id,
    sourceInstanceId: row.source_instance_id,
    status: row.status as KnowledgeSyncRunStatus,
    ...(row.cursor_before ? { cursorBefore: row.cursor_before } : {}),
    ...(row.cursor_after ? { cursorAfter: row.cursor_after } : {}),
    itemsSeen: row.items_seen,
    itemsCreated: row.items_created,
    itemsUpdated: row.items_updated,
    warnings: parseStrings(row.warnings_json),
    ...(row.error ? { error: row.error } : {}),
    startedAt: new Date(row.started_at).toISOString(),
    ...(timestampToIso(row.finished_at) ? { finishedAt: timestampToIso(row.finished_at) } : {}),
  };
}

export function startKnowledgeSyncRun(input: {
  sourceInstanceId: string;
  cursorBefore?: string;
  nowMs?: number;
}): KnowledgeSyncRun {
  const id = randomUUID();
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO knowledge_sync_runs (
        run_id, source_instance_id, status, cursor_before, started_at
      ) VALUES (?, ?, 'running', ?, ?)`,
    ).run(id, input.sourceInstanceId, input.cursorBefore ?? null, now);
  });
  return {
    id,
    sourceInstanceId: input.sourceInstanceId,
    status: 'running',
    ...(input.cursorBefore ? { cursorBefore: input.cursorBefore } : {}),
    itemsSeen: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    warnings: [],
    startedAt: new Date(now).toISOString(),
  };
}

export function finishKnowledgeSyncRun(input: {
  runId: string;
  status: Exclude<KnowledgeSyncRunStatus, 'running'>;
  cursorAfter?: string;
  itemsSeen?: number;
  itemsCreated?: number;
  itemsUpdated?: number;
  warnings?: string[];
  error?: string;
  nowMs?: number;
}): KnowledgeSyncRun {
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE knowledge_sync_runs SET
        status = ?, cursor_after = ?, items_seen = ?, items_created = ?,
        items_updated = ?, warnings_json = ?, error = ?, finished_at = ?
       WHERE run_id = ?`,
    ).run(
      input.status,
      input.cursorAfter ?? null,
      input.itemsSeen ?? 0,
      input.itemsCreated ?? 0,
      input.itemsUpdated ?? 0,
      JSON.stringify(input.warnings ?? []),
      input.error ?? null,
      now,
      input.runId,
    );
  });
  const row = getSqliteDatabase()
    .prepare(`SELECT * FROM knowledge_sync_runs WHERE run_id = ?`)
    .get(input.runId) as KnowledgeSyncRunRow | undefined;
  if (!row) throw new Error(`Knowledge sync run not found: ${input.runId}`);
  return syncRunFromRow(row);
}

export function listKnowledgeSyncRuns(options: {
  sourceInstanceId?: string;
  status?: KnowledgeSyncRunStatus;
  limit?: number;
} = {}): KnowledgeSyncRun[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.sourceInstanceId) {
    where.push('source_instance_id = ?');
    params.push(options.sourceInstanceId);
  }
  if (options.status) {
    where.push('status = ?');
    params.push(options.status);
  }
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT * FROM knowledge_sync_runs
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY started_at DESC LIMIT ?`,
    )
    .all(...params, limit) as KnowledgeSyncRunRow[];
  return rows.map(syncRunFromRow);
}

export function getKnowledgeSourceCursor(sourceInstanceId: string, collectionScope: string): string | undefined {
  const row = getSqliteDatabase()
    .prepare(`SELECT cursor FROM knowledge_collection_state WHERE source_instance_id = ? AND collection_scope = ?`)
    .get(sourceInstanceId, collectionScope) as { cursor: string | null } | undefined;
  return row?.cursor ?? undefined;
}

export function setKnowledgeSourceCursor(sourceInstanceId: string, collectionScope: string, cursor: string | undefined): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO knowledge_collection_state (source_instance_id, collection_scope, cursor, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(source_instance_id, collection_scope) DO UPDATE SET
         cursor = excluded.cursor,
         updated_at = excluded.updated_at`,
    ).run(sourceInstanceId, collectionScope, cursor ?? null, Date.now());
  });
}

export function upsertKnowledgeSourceItems(
  inputs: KnowledgeSourceItemInput[],
  nowMs = Date.now(),
): { items: KnowledgeSourceItem[]; created: number; updated: number; unchanged: number } {
  return runSqliteWriteTransaction((db) => {
    const items: KnowledgeSourceItem[] = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const input of inputs) {
      const existing = db.prepare(
        `SELECT * FROM knowledge_source_items
         WHERE source_instance_id = ? AND collection_scope = ? AND external_id = ?`,
      ).get(input.sourceInstanceId, input.collectionScope, input.externalId) as KnowledgeSourceItemRow | undefined;
      const id = existing?.item_id ?? input.id ?? randomUUID();
      if (existing?.content_hash === input.contentHash && existing.deleted_at === parseTimestamp(input.deletedAt)) {
        unchanged += 1;
        items.push(sourceItemFromRow(existing));
        continue;
      }
      db.prepare(
        `INSERT INTO knowledge_source_items (
          item_id, source_instance_id, collection_scope, external_id, item_type, author_role,
          occurred_at, source_updated_at, content_hash, normalized_text,
          payload_ref, metadata_json, sensitivity, retention_class,
          synthesis_pipeline, synthesis_status, deleted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_instance_id, collection_scope, external_id) DO UPDATE SET
          item_type = excluded.item_type,
          collection_scope = excluded.collection_scope,
          author_role = excluded.author_role,
          occurred_at = excluded.occurred_at,
          source_updated_at = excluded.source_updated_at,
          content_hash = excluded.content_hash,
          normalized_text = excluded.normalized_text,
          payload_ref = excluded.payload_ref,
          metadata_json = excluded.metadata_json,
          sensitivity = excluded.sensitivity,
          retention_class = excluded.retention_class,
          synthesis_pipeline = excluded.synthesis_pipeline,
          synthesis_status = excluded.synthesis_status,
          synthesis_attempts = 0,
          synthesis_claimed_at = NULL,
          synthesis_claimed_by = NULL,
          synthesis_error = NULL,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at`,
      ).run(
        id,
        input.sourceInstanceId,
        input.collectionScope,
        input.externalId,
        input.itemType,
        input.authorRole ?? null,
        parseTimestamp(input.occurredAt),
        parseTimestamp(input.sourceUpdatedAt),
        input.contentHash,
        input.normalizedText ?? null,
        input.payloadRef ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.sensitivity ?? 'normal',
        input.retentionClass ?? 'bounded',
        input.synthesisPipeline ?? 'user_understanding',
        input.synthesisStatus ?? 'pending',
        parseTimestamp(input.deletedAt),
        existing?.created_at ?? nowMs,
        nowMs,
      );
      const row = db.prepare(`SELECT * FROM knowledge_source_items WHERE item_id = ?`).get(id) as KnowledgeSourceItemRow;
      items.push(sourceItemFromRow(row));
      const changeKind = input.deletedAt ? 'deleted' : existing ? 'modified' : 'added';
      db.prepare(
        `INSERT INTO knowledge_source_changes (
          change_id, source_instance_id, source_item_id, change_kind,
          old_hash, new_hash, changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        input.sourceInstanceId,
        id,
        changeKind,
        existing?.content_hash ?? null,
        input.deletedAt ? null : input.contentHash,
        nowMs,
      );
      if (existing) updated += 1;
      else created += 1;
    }
    return { items, created, updated, unchanged };
  });
}

export function getKnowledgeSourceItem(itemId: string): KnowledgeSourceItem | null {
  const row = getSqliteDatabase()
    .prepare(`SELECT * FROM knowledge_source_items WHERE item_id = ?`)
    .get(itemId) as KnowledgeSourceItemRow | undefined;
  return row ? sourceItemFromRow(row) : null;
}

export function listKnowledgeSourceChanges(options: {
  sourceInstanceId?: string;
  afterSequence?: number;
  limit?: number;
} = {}): KnowledgeSourceChange[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.sourceInstanceId) {
    where.push('source_instance_id = ?');
    params.push(options.sourceInstanceId);
  }
  if (options.afterSequence != null) {
    where.push('sequence > ?');
    params.push(Math.max(0, options.afterSequence));
  }
  const limit = Math.max(1, Math.min(1_000, options.limit ?? 100));
  const rows = getSqliteDatabase().prepare(
    `SELECT * FROM knowledge_source_changes
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY sequence ASC LIMIT ?`,
  ).all(...params, limit) as KnowledgeSourceChangeRow[];
  return rows.map(sourceChangeFromRow);
}

export function getKnowledgeConsumerWatermark(consumerId: string, sourceInstanceId: string): number {
  const row = getSqliteDatabase().prepare(
    `SELECT last_sequence FROM knowledge_consumer_watermarks
     WHERE consumer_id = ? AND source_instance_id = ?`,
  ).get(consumerId, sourceInstanceId) as { last_sequence: number } | undefined;
  return row?.last_sequence ?? 0;
}

export function setKnowledgeConsumerWatermark(
  consumerId: string,
  sourceInstanceId: string,
  sequence: number,
  nowMs = Date.now(),
): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO knowledge_consumer_watermarks (
        consumer_id, source_instance_id, last_sequence, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(consumer_id, source_instance_id) DO UPDATE SET
        last_sequence = MAX(last_sequence, excluded.last_sequence),
        updated_at = excluded.updated_at`,
    ).run(consumerId, sourceInstanceId, Math.max(0, sequence), nowMs);
  });
}

export function listKnowledgeSourceItems(options: {
  sourceInstanceId?: string;
  collectionScope?: string;
  itemType?: string;
  synthesisStatus?: KnowledgeSynthesisStatus;
  occurredAfterMs?: number;
  occurredBeforeMs?: number;
  orderBy?: 'recency_desc' | 'occurred_asc';
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
} = {}): KnowledgeSourceItem[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.sourceInstanceId) {
    where.push('source_instance_id = ?');
    params.push(options.sourceInstanceId);
  }
  if (options.collectionScope) {
    where.push('collection_scope = ?');
    params.push(options.collectionScope);
  }
  if (options.itemType) {
    where.push('item_type = ?');
    params.push(options.itemType);
  }
  if (options.synthesisStatus) {
    where.push('synthesis_status = ?');
    params.push(options.synthesisStatus);
  }
  if (options.occurredAfterMs !== undefined) {
    where.push('occurred_at > ?');
    params.push(options.occurredAfterMs);
  }
  if (options.occurredBeforeMs !== undefined) {
    where.push('occurred_at <= ?');
    params.push(options.occurredBeforeMs);
  }
  if (!options.includeDeleted) where.push('deleted_at IS NULL');
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT * FROM knowledge_source_items
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${options.orderBy === 'occurred_asc'
         ? 'occurred_at ASC, item_id ASC'
         : 'COALESCE(source_updated_at, occurred_at, updated_at) DESC'}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as KnowledgeSourceItemRow[];
  return rows.map(sourceItemFromRow);
}

export function pruneBoundedKnowledgeSourceItems(
  sourceInstanceId: string,
  olderThanMs: number,
): number {
  return runSqliteWriteTransaction((db) => Number(db.prepare(
    `DELETE FROM knowledge_source_items
     WHERE source_instance_id = ? AND retention_class = 'bounded'
       AND COALESCE(source_updated_at, occurred_at, updated_at) < ?`,
  ).run(sourceInstanceId, olderThanMs).changes));
}

export function setKnowledgeSourceItemSynthesisStatus(
  itemIds: string[],
  status: KnowledgeSynthesisStatus,
  nowMs = Date.now(),
): number {
  if (itemIds.length === 0) return 0;
  return runSqliteWriteTransaction((db) => {
    const placeholders = itemIds.map(() => '?').join(', ');
    const result = db.prepare(
      `UPDATE knowledge_source_items SET synthesis_status = ?, updated_at = ?
       WHERE item_id IN (${placeholders})`,
    ).run(status, nowMs, ...itemIds);
    return Number(result.changes);
  });
}

export function claimKnowledgeSourceItems(options: {
  workerId: string;
  sourceInstanceId?: string;
  synthesisPipeline?: KnowledgeSynthesisPipeline;
  limit?: number;
  leaseMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
  nowMs?: number;
}): KnowledgeSourceItem[] {
  const now = options.nowMs ?? Date.now();
  const leaseCutoff = now - Math.max(1_000, options.leaseMs ?? 5 * 60_000);
  const retryCutoff = now - Math.max(1_000, options.retryDelayMs ?? 30_000);
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  return runSqliteWriteTransaction((db) => {
    const rows = db.prepare(
      `SELECT * FROM knowledge_source_items
       WHERE synthesis_attempts < ?
         ${options.sourceInstanceId ? 'AND source_instance_id = ?' : ''}
         ${options.synthesisPipeline ? 'AND synthesis_pipeline = ?' : ''}
         AND (
           synthesis_status = 'pending'
           OR (synthesis_status = 'failed' AND updated_at < ?)
           OR (synthesis_status = 'processing' AND synthesis_claimed_at < ?)
         )
       ORDER BY COALESCE(source_updated_at, occurred_at, updated_at) ASC
       LIMIT ?`,
    ).all(
      maxAttempts,
      ...(options.sourceInstanceId ? [options.sourceInstanceId] : []),
      ...(options.synthesisPipeline ? [options.synthesisPipeline] : []),
      retryCutoff,
      leaseCutoff,
      limit,
    ) as KnowledgeSourceItemRow[];
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.item_id);
    const placeholders = ids.map(() => '?').join(', ');
    db.prepare(
      `UPDATE knowledge_source_items SET
        synthesis_status = 'processing',
        synthesis_attempts = synthesis_attempts + 1,
        synthesis_claimed_at = ?,
        synthesis_claimed_by = ?,
        synthesis_error = NULL,
        updated_at = ?
       WHERE item_id IN (${placeholders})`,
    ).run(now, options.workerId, now, ...ids);
    const claimed = db.prepare(
      `SELECT * FROM knowledge_source_items WHERE item_id IN (${placeholders})`,
    ).all(...ids) as KnowledgeSourceItemRow[];
    return claimed.map(sourceItemFromRow);
  });
}

export function completeKnowledgeSourceItemSynthesis(input: {
  itemId: string;
  workerId: string;
  status: 'completed' | 'failed' | 'ignored';
  error?: string;
  nowMs?: number;
}): boolean {
  const now = input.nowMs ?? Date.now();
  return runSqliteWriteTransaction((db) => {
    const result = db.prepare(
      `UPDATE knowledge_source_items SET
        synthesis_status = ?,
        synthesis_claimed_at = NULL,
        synthesis_claimed_by = NULL,
        synthesis_error = ?,
        updated_at = ?
       WHERE item_id = ? AND synthesis_status = 'processing' AND synthesis_claimed_by = ?`,
    ).run(input.status, input.error ?? null, now, input.itemId, input.workerId);
    return Number(result.changes) > 0;
  });
}

export interface AttachMemoryEvidenceInput {
  recordId: string;
  sourceItemId?: string;
  relation?: MemoryEvidenceRelation;
  excerpt?: string;
  confidence?: number;
  observedAt?: string;
  sessionKey?: string;
  turnId?: string;
  toolCallId?: string;
  nowMs?: number;
}

function upsertMemoryEvidenceRow(db: DatabaseSync, input: AttachMemoryEvidenceInput): MemoryEvidence {
  let evidenceId: string = randomUUID();
  const now = input.nowMs ?? Date.now();
  const observedAt = parseTimestamp(input.observedAt);
  db.prepare(
      `INSERT INTO memory_evidence (
        evidence_id, record_id, source_item_id, relation, excerpt,
        confidence, observed_at, session_key, turn_id, tool_call_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET
        excerpt = COALESCE(excluded.excerpt, memory_evidence.excerpt),
        confidence = MAX(COALESCE(memory_evidence.confidence, 0), COALESCE(excluded.confidence, 0)),
        observed_at = MAX(COALESCE(memory_evidence.observed_at, 0), COALESCE(excluded.observed_at, 0)),
        session_key = COALESCE(memory_evidence.session_key, excluded.session_key),
        turn_id = COALESCE(memory_evidence.turn_id, excluded.turn_id),
        tool_call_id = COALESCE(memory_evidence.tool_call_id, excluded.tool_call_id)`,
    ).run(
      evidenceId,
      input.recordId,
      input.sourceItemId ?? null,
      input.relation ?? 'supports',
      input.excerpt ?? null,
      input.confidence ?? null,
      observedAt,
      input.sessionKey ?? null,
      input.turnId ?? null,
      input.toolCallId ?? null,
      now,
    );
  if (input.sourceItemId) {
    const stored = db.prepare(
      `SELECT evidence_id FROM memory_evidence
       WHERE record_id = ? AND source_item_id = ? AND relation = ?`,
    ).get(input.recordId, input.sourceItemId, input.relation ?? 'supports') as { evidence_id: string } | undefined;
    evidenceId = stored?.evidence_id ?? evidenceId;
  }
  return {
    evidenceId,
    ...(input.sourceItemId ? { sourceItemId: input.sourceItemId } : {}),
    relation: input.relation ?? 'supports',
    ...(input.excerpt ? { sourceText: input.excerpt } : {}),
    ...(input.confidence != null ? { confidence: input.confidence } : {}),
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    ...(observedAt != null ? { observedAt: new Date(observedAt).toISOString() } : {}),
  };
}

export function attachMemoryEvidence(input: AttachMemoryEvidenceInput): MemoryEvidence {
  return runSqliteWriteTransaction((db) => upsertMemoryEvidenceRow(db, input));
}

export function replaceMemoryEvidenceForRecord(
  db: DatabaseSync,
  recordId: string,
  evidence: MemoryEvidence[],
  nowMs = Date.now(),
): void {
  db.prepare(`DELETE FROM memory_evidence WHERE record_id = ?`).run(recordId);
  for (const item of evidence) {
    upsertMemoryEvidenceRow(db, {
      recordId,
      sourceItemId: item.sourceItemId,
      relation: item.relation,
      excerpt: item.sourceText,
      confidence: item.confidence,
      observedAt: item.observedAt,
      sessionKey: item.sessionKey,
      turnId: item.turnId,
      toolCallId: item.toolCallId,
      nowMs,
    });
  }
}

export function deleteMemoryEvidenceForRecord(
  recordId: string,
  relation?: MemoryEvidenceRelation,
): number {
  return runSqliteWriteTransaction((db) => {
    const result = relation
      ? db.prepare(`DELETE FROM memory_evidence WHERE record_id = ? AND relation = ?`).run(recordId, relation)
      : db.prepare(`DELETE FROM memory_evidence WHERE record_id = ?`).run(recordId);
    return Number(result.changes);
  });
}

export function listMemoryEvidence(recordId: string): MemoryEvidence[] {
  const rows = getSqliteDatabase()
    .prepare(`SELECT * FROM memory_evidence WHERE record_id = ? ORDER BY created_at ASC`)
    .all(recordId) as MemoryEvidenceRow[];
  return rows.map((row) => ({
    evidenceId: row.evidence_id,
    ...(row.source_item_id ? { sourceItemId: row.source_item_id } : {}),
    relation: row.relation as MemoryEvidenceRelation,
    ...(row.excerpt ? { sourceText: row.excerpt } : {}),
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    ...(row.turn_id ? { turnId: row.turn_id } : {}),
    ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {}),
    ...(timestampToIso(row.observed_at) ? { observedAt: timestampToIso(row.observed_at) } : {}),
  }));
}

export function listMemoryEvidenceForRecords(recordIds: string[]): Map<string, MemoryEvidence[]> {
  const uniqueIds = [...new Set(recordIds.filter(Boolean))];
  const output = new Map<string, MemoryEvidence[]>();
  if (uniqueIds.length === 0) return output;
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = getSqliteDatabase()
    .prepare(`SELECT * FROM memory_evidence WHERE record_id IN (${placeholders}) ORDER BY created_at ASC`)
    .all(...uniqueIds) as MemoryEvidenceRow[];
  for (const row of rows) {
    const group = output.get(row.record_id) ?? [];
    group.push({
      evidenceId: row.evidence_id,
      ...(row.source_item_id ? { sourceItemId: row.source_item_id } : {}),
      relation: row.relation as MemoryEvidenceRelation,
      ...(row.excerpt ? { sourceText: row.excerpt } : {}),
      ...(row.confidence != null ? { confidence: row.confidence } : {}),
      ...(row.session_key ? { sessionKey: row.session_key } : {}),
      ...(row.turn_id ? { turnId: row.turn_id } : {}),
      ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {}),
      ...(timestampToIso(row.observed_at) ? { observedAt: timestampToIso(row.observed_at) } : {}),
    });
    output.set(row.record_id, group);
  }
  return output;
}

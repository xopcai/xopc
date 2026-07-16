import { randomUUID } from 'node:crypto';

import type {
  KnowledgeSourceItem,
  KnowledgeSourceItemInput,
  KnowledgeSyncRun,
  KnowledgeSyncRunStatus,
  KnowledgeSynthesisStatus,
} from '../../knowledge/types.js';
import type { MemoryEvidence, MemoryEvidenceRelation } from '../../agent/memory/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type KnowledgeSourceItemRow = {
  item_id: string;
  source_instance_id: string;
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
  synthesis_status: string;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
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
    synthesisStatus: row.synthesis_status as KnowledgeSourceItem['synthesisStatus'],
    ...(timestampToIso(row.deleted_at) ? { deletedAt: timestampToIso(row.deleted_at) } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
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

export function getKnowledgeSourceCursor(sourceInstanceId: string): string | undefined {
  const row = getSqliteDatabase()
    .prepare(`SELECT cursor FROM knowledge_source_state WHERE source_instance_id = ?`)
    .get(sourceInstanceId) as { cursor: string | null } | undefined;
  return row?.cursor ?? undefined;
}

export function setKnowledgeSourceCursor(sourceInstanceId: string, cursor: string | undefined): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO knowledge_source_state (source_instance_id, cursor, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(source_instance_id) DO UPDATE SET
         cursor = excluded.cursor,
         updated_at = excluded.updated_at`,
    ).run(sourceInstanceId, cursor ?? null, Date.now());
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
         WHERE source_instance_id = ? AND external_id = ?`,
      ).get(input.sourceInstanceId, input.externalId) as KnowledgeSourceItemRow | undefined;
      const id = existing?.item_id ?? input.id ?? randomUUID();
      if (existing?.content_hash === input.contentHash && existing.deleted_at === parseTimestamp(input.deletedAt)) {
        unchanged += 1;
        items.push(sourceItemFromRow(existing));
        continue;
      }
      db.prepare(
        `INSERT INTO knowledge_source_items (
          item_id, source_instance_id, external_id, item_type, author_role,
          occurred_at, source_updated_at, content_hash, normalized_text,
          payload_ref, metadata_json, sensitivity, retention_class,
          synthesis_status, deleted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_instance_id, external_id) DO UPDATE SET
          item_type = excluded.item_type,
          author_role = excluded.author_role,
          occurred_at = excluded.occurred_at,
          source_updated_at = excluded.source_updated_at,
          content_hash = excluded.content_hash,
          normalized_text = excluded.normalized_text,
          payload_ref = excluded.payload_ref,
          metadata_json = excluded.metadata_json,
          sensitivity = excluded.sensitivity,
          retention_class = excluded.retention_class,
          synthesis_status = excluded.synthesis_status,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at`,
      ).run(
        id,
        input.sourceInstanceId,
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
        input.synthesisStatus ?? 'pending',
        parseTimestamp(input.deletedAt),
        existing?.created_at ?? nowMs,
        nowMs,
      );
      const row = db.prepare(`SELECT * FROM knowledge_source_items WHERE item_id = ?`).get(id) as KnowledgeSourceItemRow;
      items.push(sourceItemFromRow(row));
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

export function listKnowledgeSourceItems(options: {
  sourceInstanceId?: string;
  synthesisStatus?: KnowledgeSynthesisStatus;
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
  if (options.synthesisStatus) {
    where.push('synthesis_status = ?');
    params.push(options.synthesisStatus);
  }
  if (!options.includeDeleted) where.push('deleted_at IS NULL');
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT * FROM knowledge_source_items
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY COALESCE(source_updated_at, occurred_at, updated_at) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as KnowledgeSourceItemRow[];
  return rows.map(sourceItemFromRow);
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

export function attachMemoryEvidence(input: {
  recordId: string;
  sourceItemId?: string;
  relation?: MemoryEvidenceRelation;
  excerpt?: string;
  confidence?: number;
  observedAt?: string;
  nowMs?: number;
}): MemoryEvidence {
  const evidenceId = randomUUID();
  const now = input.nowMs ?? Date.now();
  const observedAt = parseTimestamp(input.observedAt);
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO memory_evidence (
        evidence_id, record_id, source_item_id, relation, excerpt,
        confidence, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      evidenceId,
      input.recordId,
      input.sourceItemId ?? null,
      input.relation ?? 'supports',
      input.excerpt ?? null,
      input.confidence ?? null,
      observedAt,
      now,
    );
  });
  return {
    evidenceId,
    ...(input.sourceItemId ? { sourceItemId: input.sourceItemId } : {}),
    relation: input.relation ?? 'supports',
    ...(input.excerpt ? { sourceText: input.excerpt } : {}),
    ...(input.confidence != null ? { confidence: input.confidence } : {}),
    ...(observedAt != null ? { observedAt: new Date(observedAt).toISOString() } : {}),
  };
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
    ...(timestampToIso(row.observed_at) ? { observedAt: timestampToIso(row.observed_at) } : {}),
  }));
}

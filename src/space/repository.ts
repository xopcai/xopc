import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { SQLInputValue } from 'node:sqlite';

import type { SpaceDetail, SpaceItem, SpaceList, SpaceOrigin, SpaceVersion } from '@xopcai/gateway-contract';

import { parseByteRange } from '../media-shared/http/byte-range.js';
import { MEDIA_ARTIFACT_MAX_BYTES, resolveMediaBufferPath } from '../media/store.js';
import { escapeFts5Query, escapeSqlLike } from '../storage/sqlite/fts.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { archiveSpaceContent, spaceMarkdown, SPACE_VIDEO_MAX_BYTES } from './ingest.js';

type VersionRow = {
  id: string; item_id: string; ordinal: number; file_name: string; mime_type: string; size_bytes: number;
  created_at: number; index_status: SpaceVersion['indexStatus']; media_id: string | null; body: string | null; sha256: string | null;
};
type ItemRow = VersionRow & {
  item_id: string; title: string; kind: string; favorite: number; trashed_at: number | null;
  updated_at: number; revision: number; rank?: number; hit_body?: string; hit_locator?: string;
};
type OriginRow = {
  kind: SpaceOrigin['kind']; version_id: string | null; conversation_id: string; transcript_id: string | null; entry_id: string | null;
  project_id: string | null; task_id: string | null; automation_run_id: string | null; label: string | null; available: number;
};

export const SPACE_TRASH_RETENTION_MS = 30 * 24 * 60 * 60_000;

const itemSelect = `SELECT v.id, v.ordinal, v.file_name, v.mime_type, v.size_bytes, v.created_at, v.index_status,
  i.id AS item_id, i.title, i.kind, i.favorite, i.trashed_at, i.updated_at, i.revision`;
const itemJoin = 'FROM space_items i JOIN space_versions v ON v.id = i.current_version_id';

function version(row: VersionRow): SpaceVersion {
  return { id: row.id, ordinal: row.ordinal, fileName: row.file_name, mimeType: row.mime_type,
    sizeBytes: row.size_bytes, createdAt: row.created_at, indexStatus: row.index_status };
}

function origins(id: string): SpaceOrigin[] {
  const rows = getSqliteDatabase().prepare(`SELECT o.*, CASE WHEN o.kind = 'task'
    THEN EXISTS(SELECT 1 FROM tasks WHERE task_id = o.task_id)
    WHEN o.kind = 'automation' THEN EXISTS(SELECT 1 FROM automation_runs WHERE run_id = o.automation_run_id)
    ELSE EXISTS(SELECT 1 FROM sessions s WHERE s.conversation_id = o.conversation_id)
      AND (o.entry_id IS NULL OR EXISTS(SELECT 1 FROM transcript_entries e WHERE e.entry_id = o.entry_id)) END AS available
    FROM space_origins o WHERE o.item_id = ? AND o.source_key NOT LIKE 'media:%'
    ORDER BY available DESC, CASE o.kind WHEN 'task' THEN 0 WHEN 'automation' THEN 1 ELSE 2 END, o.rowid DESC LIMIT 30`).all(id) as OriginRow[];
  return rows.map(row => ({ kind: row.kind, versionId: row.version_id ?? undefined, conversationId: row.conversation_id,
    transcriptId: row.transcript_id ?? undefined, entryId: row.entry_id ?? undefined,
    projectId: row.project_id ?? undefined, taskId: row.task_id ?? undefined,
    automationRunId: row.automation_run_id ?? undefined, label: row.label ?? undefined, available: Boolean(row.available) }));
}

function item(row: ItemRow, origin?: SpaceOrigin): SpaceItem {
  return { id: row.item_id, title: row.title, kind: row.kind, favorite: Boolean(row.favorite), trashedAt: row.trashed_at,
    updatedAt: row.updated_at, revision: row.revision, currentVersion: version(row), origin,
    ...(row.hit_body !== undefined && row.hit_body !== null ? { hit: { text: row.hit_body, locator: JSON.parse(row.hit_locator ?? '{}') } } : {}) };
}

export function getSpaceItem(id: string): SpaceDetail | null {
  const db = getSqliteDatabase();
  const row = db.prepare(`${itemSelect} ${itemJoin} WHERE i.id = ?`).get(id) as ItemRow | undefined;
  if (!row) return null;
  const source = origins(id);
  return { ...item(row, source[0]), origins: source,
    versions: (db.prepare('SELECT * FROM space_versions WHERE item_id = ? ORDER BY created_at DESC, ordinal DESC').all(id) as VersionRow[]).map(version) };
}

type ListInput = { view: 'all' | 'favorites' | 'trash'; q?: string; kind?: string; projectId?: string; taskId?: string; cursor?: string };

export function spaceHanPairs(text: string): string {
  const terms = new Set<string>();
  for (const match of text.matchAll(/\p{Script=Han}{2,}/gu)) {
    const characters = Array.from(match[0]);
    for (let index = 1; index < characters.length; index++) terms.add(characters[index - 1] + characters[index]);
  }
  return [...terms].join(' ');
}

export function listSpaceItems(input: ListInput): SpaceList {
  const db = getSqliteDatabase();
  const q = input.q?.normalize('NFKC').trim().toLowerCase().slice(0, 160) ?? '';
  const pattern = `%${escapeSqlLike(q)}%`;
  const filters = [input.view === 'trash' ? 'i.trashed_at IS NOT NULL' : 'i.trashed_at IS NULL'];
  const params: SQLInputValue[] = [];
  if (input.view === 'favorites') filters.push('i.favorite = 1');
  if (input.kind === 'document') filters.push("i.kind IN ('document', 'pdf')");
  else if (input.kind === 'file') filters.push("i.kind IN ('file', 'site')");
  else if (input.kind) { filters.push('i.kind = ?'); params.push(input.kind); }
  if (input.projectId) {
    filters.push('EXISTS(SELECT 1 FROM space_origins o WHERE o.item_id = i.id AND o.project_id = ?)');
    params.push(input.projectId);
  }
  if (input.taskId) {
    filters.push('EXISTS(SELECT 1 FROM space_origins o WHERE o.item_id = i.id AND o.task_id = ?)');
    params.push(input.taskId);
  }
  const index = Array.from(q).length >= 3 ? 'space_search'
    : /^\p{Script=Han}{2}$/u.test(q) ? 'space_search_short' : null;
  const titleMatch = "(xopc_space_search_text(i.title) LIKE ? ESCAPE '\\' OR xopc_space_search_text(v.file_name) LIKE ? ESCAPE '\\')";
  const matchCte = index ? `WITH matches AS (
    SELECT version_id, body, locator, row_number() OVER (PARTITION BY version_id ORDER BY rowid) AS hit_number
    FROM ${index} WHERE ${index} MATCH ?${index === 'space_search_short' ? ' AND instr(body, ?) > 0' : ''}
  )` : '';
  const searchJoin = index ? 'LEFT JOIN matches m ON m.version_id = v.id AND m.hit_number = 1' : '';
  const rank = q ? `CASE WHEN xopc_space_search_text(i.title) = ? OR xopc_space_search_text(v.file_name) = ? THEN 0
    WHEN ${titleMatch} THEN 1 ${index ? 'WHEN m.version_id IS NOT NULL THEN 2' : ''} ELSE 3 END` : '0';
  if (q) {
    filters.push(`(${titleMatch} OR EXISTS(SELECT 1 FROM space_origins o WHERE o.item_id = i.id AND xopc_space_search_text(o.label) LIKE ? ESCAPE '\\')${index ? ' OR m.version_id IS NOT NULL' : ''})`);
    params.push(pattern, pattern, pattern);
  }
  let cursor: [number, number, string] | undefined;
  if (input.cursor) {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
      if (Array.isArray(parsed) && parsed.length === 3 && Number.isInteger(parsed[0]) && Number.isSafeInteger(parsed[1]) && typeof parsed[2] === 'string') cursor = [parsed[0], parsed[1], parsed[2]];
    } catch { /* An expired or malformed cursor restarts at the first page. */ }
  }
  const bindings: SQLInputValue[] = index ? [escapeFts5Query(q), ...(index === 'space_search_short' ? [q] : [])] : [];
  if (q) bindings.push(q, q, pattern, pattern);
  bindings.push(...params);
  if (cursor) bindings.push(cursor[0], cursor[0], cursor[1], cursor[1], cursor[2]);
  const pageSize = 40;
  const rows = db.prepare(`${matchCte} SELECT * FROM (
    ${itemSelect}, ${rank} AS rank ${index ? ', m.body AS hit_body, m.locator AS hit_locator' : ''}
    ${itemJoin} ${searchJoin} WHERE ${filters.join(' AND ')}
  ) ${cursor ? 'WHERE rank > ? OR (rank = ? AND (updated_at < ? OR (updated_at = ? AND item_id < ?)))' : ''}
  ORDER BY rank ASC, updated_at DESC, item_id DESC LIMIT ?`).all(...bindings, pageSize + 1) as ItemRow[];
  const last = rows[pageSize - 1];
  const nextCursor = rows.length > pageSize && last
    ? Buffer.from(JSON.stringify([last.rank, last.updated_at, last.item_id])).toString('base64url') : undefined;
  return { items: rows.slice(0, pageSize).map(row => item(row, origins(row.item_id)[0])), nextCursor };
}

type SpaceLink = { id: string; versionId?: string };

export function findSpaceArtifact(mediaId: string): SpaceLink | null {
  const row = getSqliteDatabase().prepare(`SELECT i.id, v.id AS version_id FROM space_versions v JOIN space_items i ON i.id = v.item_id
    WHERE v.media_id = ? AND i.trashed_at IS NULL LIMIT 1`).get(mediaId);
  return typeof row?.id === 'string' ? { id: row.id, versionId: String(row.version_id) } : null;
}

export function findSpaceTaskDelivery(deliveryId: string): SpaceLink | null {
  const id = deliveryId.replace(/^reply:/, '');
  const row = getSqliteDatabase().prepare(`SELECT i.id, o.version_id FROM space_origins o JOIN space_items i ON i.id = o.item_id
    WHERE i.trashed_at IS NULL AND (o.source_key = ? OR o.source_key LIKE ? ESCAPE '\\')
    ORDER BY o.source_key = ? DESC, i.updated_at DESC LIMIT 1`)
    .get(`delivery-body:${id}`, `${escapeSqlLike(`delivery:${id}:`)}%`, `delivery-body:${id}`);
  return typeof row?.id === 'string' ? { id: row.id, versionId: typeof row.version_id === 'string' ? row.version_id : undefined } : null;
}

export function saveSpaceReply(conversationId: string, reference: string | { turnId: string }): string | null {
  return runSqliteWriteTransaction(db => {
    const byEntry = typeof reference === 'string';
    const row = db.prepare(`SELECT e.entry_id, e.payload_json, e.transcript_id, e.created_at, s.name, s.project_id
      FROM transcript_entries e JOIN transcripts t ON t.transcript_id = e.transcript_id
      JOIN sessions s ON s.conversation_id = t.conversation_id
      WHERE ${byEntry ? 'e.entry_id = ?' : "json_extract(e.payload_json, '$.turnId') = ?"}
        AND t.conversation_id = ? AND e.role = 'assistant' AND e.entry_kind = 'message'
      ORDER BY e.created_at DESC, e.seq DESC LIMIT 1`).get(byEntry ? reference : reference.turnId, conversationId);
    if (!row) return null;
    const message = JSON.parse(String(row.payload_json)) as { stopReason?: string; content?: unknown; metadata?: { hiddenFromClient?: boolean } };
    if (message.metadata?.hiddenFromClient || message.stopReason === 'aborted' || message.stopReason === 'error') return null;
    const body = typeof message.content === 'string' ? message.content.trim() : Array.isArray(message.content)
      ? message.content.filter(block => block?.type === 'text' && block.presentation !== 'narration' && typeof block.text === 'string').map(block => block.text).join('\n\n').trim() : '';
    if (!body || body === 'NO_REPLY') return null;
    const title = body.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim().slice(0, 100) || 'Chat reply';
    const entryId = String(row.entry_id);
    const key = `reply:${entryId}`;
    return archiveSpaceContent(db, { key, kind: 'chat', conversationId, entryId,
      transcriptId: String(row.transcript_id), createdAt: Date.now(), label: (row.name as string | null) ?? undefined,
      projectId: (row.project_id as string | null) ?? undefined }, key, title, spaceMarkdown(title, body), true);
  });
}

export function changeSpaceItem(id: string, revision: number, patch: { title?: string; favorite?: boolean; trash?: boolean }): 'ok' | 'missing' | 'conflict' {
  return runSqliteWriteTransaction(db => {
    const row = db.prepare('SELECT revision, trashed_at FROM space_items WHERE id = ?').get(id);
    if (!row) return 'missing';
    if (row.revision !== revision) return 'conflict';
    if (row.trashed_at !== null && patch.trash !== false) return 'conflict';
    if (row.trashed_at === null && patch.trash === false) return 'conflict';
    db.prepare(`UPDATE space_items SET title = COALESCE(?, title), favorite = COALESCE(?, favorite),
      trashed_at = CASE ? WHEN 1 THEN ? WHEN 0 THEN NULL ELSE trashed_at END, revision = revision + 1
      WHERE id = ?`).run(patch.title ?? null, patch.favorite === undefined ? null : Number(patch.favorite),
      patch.trash === undefined ? null : Number(patch.trash), Date.now(), id);
    return 'ok';
  });
}

export function purgeSpaceItem(id: string, revision: number): 'ok' | 'missing' | 'conflict' {
  return runSqliteWriteTransaction(db => {
    const row = db.prepare('SELECT revision, trashed_at FROM space_items WHERE id = ?').get(id);
    if (!row) return 'missing';
    if (row.revision !== revision || row.trashed_at === null) return 'conflict';
    db.prepare('DELETE FROM space_search WHERE version_id IN (SELECT id FROM space_versions WHERE item_id = ?)').run(id);
    db.prepare('DELETE FROM space_search_short WHERE version_id IN (SELECT id FROM space_versions WHERE item_id = ?)').run(id);
    db.prepare('INSERT OR IGNORE INTO space_media_cleanup SELECT media_id FROM space_versions WHERE item_id = ? AND media_id IS NOT NULL').run(id);
    db.prepare('DELETE FROM space_items WHERE id = ?').run(id);
    return 'ok';
  });
}

type SpaceContent = {
  body: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array<ArrayBuffer>> | null;
  version: SpaceVersion;
  range: ReturnType<typeof parseByteRange>;
  size: number;
};

export async function readSpaceContent(itemId: string, versionId: string, rangeHeader?: string): Promise<SpaceContent | null> {
  const row = getSqliteDatabase().prepare('SELECT * FROM space_versions WHERE item_id = ? AND id = ?').get(itemId, versionId) as VersionRow | undefined;
  if (!row) return null;
  const size = row.size_bytes;
  const range = parseByteRange(rangeHeader, size);
  const metadata = { version: version(row), size, range };
  if (range === 'invalid') return { ...metadata, body: null };
  if (row.body !== null) {
    const bytes = Uint8Array.from(Buffer.from(row.body));
    return { ...metadata, body: range ? bytes.subarray(range.start, range.end + 1) : bytes };
  }
  if (!row.media_id) return null;
  try {
    const handle = await open(resolveMediaBufferPath(row.media_id, 'outbound'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let handedOff = false;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== size || stat.size > (row.mime_type === 'video/mp4' ? SPACE_VIDEO_MAX_BYTES : MEDIA_ARTIFACT_MAX_BYTES)) return null;
      if (!row.sha256) {
        const stream = handle.createReadStream(range ?? undefined);
        const body = Readable.toWeb(stream) as ReadableStream<Uint8Array<ArrayBuffer>>;
        handedOff = true;
        return { ...metadata, body };
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) return null;
        offset += bytesRead;
      }
      if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) return null;
      return { ...metadata, body: range ? bytes.subarray(range.start, range.end + 1) : bytes };
    } finally {
      if (!handedOff) await handle.close();
    }
  } catch { return null; }
}

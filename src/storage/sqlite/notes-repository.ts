import type { Note, NoteIndexEntry, NotesListQuery } from '../../notes/types.js';
import { buildNoteIndexMeta, extractAttachmentFileNames, notePlainText } from '../../notes/note-index-meta.js';
import { escapeFts5Query } from './fts.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type NoteRow = {
  note_id: string;
  title: string | null;
  kind: string;
  status: string;
  payload_json: string;
  created_at: number;
  updated_at: number;
  pinned: number;
  tags_json: string;
  snippet: string | null;
  cover_attachment_id: string | null;
  voice_attachment_id: string | null;
  voice_duration_sec: number | null;
  attachment_names_json: string | null;
  group_id: string | null;
  last_opened_at: number | null;
  task_done: number | null;
  task_due_at: number | null;
  heading_count: number | null;
  task_count: number | null;
  unchecked_task_count: number | null;
  link_count: number | null;
};

function parseTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function parseAttachmentNames(json: string | null): string[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : undefined;
  } catch {
    return undefined;
  }
}

function rowToIndexEntry(row: NoteRow): NoteIndexEntry {
  return {
    id: row.note_id,
    title: row.title ?? undefined,
    kind: row.kind as NoteIndexEntry['kind'],
    status: row.status as NoteIndexEntry['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinned: row.pinned ? true : undefined,
    tags: parseTags(row.tags_json),
    snippet: row.snippet ?? undefined,
    coverAttachmentId: row.cover_attachment_id ?? undefined,
    voiceAttachmentId: row.voice_attachment_id ?? undefined,
    voiceDurationSec: row.voice_duration_sec ?? undefined,
    attachmentNames: parseAttachmentNames(row.attachment_names_json),
    groupId: row.group_id ?? undefined,
    lastOpenedAt: row.last_opened_at ?? undefined,
    taskDone: row.task_done != null ? Boolean(row.task_done) : undefined,
    taskDueAt: row.task_due_at ?? undefined,
    headingCount: row.heading_count ?? undefined,
    taskCount: row.task_count ?? undefined,
    uncheckedTaskCount: row.unchecked_task_count ?? undefined,
    linkCount: row.link_count ?? undefined,
  };
}

function noteSearchContent(note: Note): string {
  const plain = notePlainText(note);
  const attachmentText = note.attachments?.map((a) => a.transcript).filter(Boolean).join(' ') ?? '';
  const attachmentNames = extractAttachmentFileNames(note)?.join(' ') ?? '';
  return [note.title, plain, attachmentText, attachmentNames, ...(note.tags ?? [])].filter(Boolean).join('\n');
}

function noteToRow(note: Note): Omit<NoteRow, 'payload_json'> & { payload_json: string } {
  const meta = buildNoteIndexMeta(note);
  return {
    note_id: note.id,
    title: note.title ?? null,
    kind: note.kind,
    status: note.status,
    payload_json: JSON.stringify(note),
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    pinned: note.pinned ? 1 : 0,
    tags_json: JSON.stringify(note.tags ?? []),
    snippet: meta.snippet ?? null,
    cover_attachment_id: meta.coverAttachmentId ?? null,
    voice_attachment_id: meta.voiceAttachmentId ?? null,
    voice_duration_sec: meta.voiceDurationSec ?? null,
    attachment_names_json: meta.attachmentNames ? JSON.stringify(meta.attachmentNames) : null,
    group_id: note.groupId ?? null,
    last_opened_at: note.lastOpenedAt ?? null,
    task_done: note.taskMeta?.done != null ? (note.taskMeta.done ? 1 : 0) : null,
    task_due_at: note.taskMeta?.dueAt ?? null,
    heading_count: meta.headingCount ?? null,
    task_count: meta.taskCount ?? null,
    unchecked_task_count: meta.uncheckedTaskCount ?? null,
    link_count: meta.linkCount ?? null,
  };
}

function upsertNoteFts(db: ReturnType<typeof getSqliteDatabase>, note: Note): void {
  db.prepare(`DELETE FROM notes_fts WHERE note_id = ?`).run(note.id);
  const content = noteSearchContent(note);
  if (!content.trim()) {
    return;
  }
  db.prepare(`INSERT INTO notes_fts (content, note_id) VALUES (?, ?)`).run(content, note.id);
}

export function upsertNoteRecord(note: Note): void {
  const row = noteToRow(note);
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO notes (
        note_id, title, kind, status, payload_json, created_at, updated_at,
        pinned, tags_json, snippet, cover_attachment_id, voice_attachment_id,
        voice_duration_sec, attachment_names_json, group_id, last_opened_at,
        task_done, task_due_at, heading_count, task_count, unchecked_task_count, link_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(note_id) DO UPDATE SET
        title = excluded.title,
        kind = excluded.kind,
        status = excluded.status,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at,
        pinned = excluded.pinned,
        tags_json = excluded.tags_json,
        snippet = excluded.snippet,
        cover_attachment_id = excluded.cover_attachment_id,
        voice_attachment_id = excluded.voice_attachment_id,
        voice_duration_sec = excluded.voice_duration_sec,
        attachment_names_json = excluded.attachment_names_json,
        group_id = excluded.group_id,
        last_opened_at = excluded.last_opened_at,
        task_done = excluded.task_done,
        task_due_at = excluded.task_due_at,
        heading_count = excluded.heading_count,
        task_count = excluded.task_count,
        unchecked_task_count = excluded.unchecked_task_count,
        link_count = excluded.link_count`,
    ).run(
      row.note_id,
      row.title,
      row.kind,
      row.status,
      row.payload_json,
      row.created_at,
      row.updated_at,
      row.pinned,
      row.tags_json,
      row.snippet,
      row.cover_attachment_id,
      row.voice_attachment_id,
      row.voice_duration_sec,
      row.attachment_names_json,
      row.group_id,
      row.last_opened_at,
      row.task_done,
      row.task_due_at,
      row.heading_count,
      row.task_count,
      row.unchecked_task_count,
      row.link_count,
    );
    upsertNoteFts(db, note);
  });
}

export function getNoteRecord(noteId: string): Note | null {
  const db = getSqliteDatabase();
  const row = db.prepare(`SELECT payload_json FROM notes WHERE note_id = ?`).get(noteId) as
    | { payload_json: string }
    | undefined;
  if (!row?.payload_json) {
    return null;
  }
  try {
    return JSON.parse(row.payload_json) as Note;
  } catch {
    return null;
  }
}

export function deleteNoteRecord(noteId: string): boolean {
  return runSqliteWriteTransaction((db) => {
    const existing = db.prepare(`SELECT note_id FROM notes WHERE note_id = ?`).get(noteId);
    if (!existing) {
      return false;
    }
    db.prepare(`DELETE FROM notes_fts WHERE note_id = ?`).run(noteId);
    db.prepare(`DELETE FROM notes WHERE note_id = ?`).run(noteId);
    return true;
  });
}

export function listNoteRecords(
  query: NotesListQuery = {},
): { items: NoteIndexEntry[]; total: number; limit: number; offset: number; hasMore: boolean } {
  const db = getSqliteDatabase();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.status) {
    conditions.push(`status = ?`);
    params.push(query.status);
  } else {
    conditions.push(`status != ?`);
    params.push('trashed');
  }
  if (query.kind) {
    conditions.push(`kind = ?`);
    params.push(query.kind);
  }
  if (query.pinned !== undefined) {
    conditions.push(`pinned = ?`);
    params.push(query.pinned ? 1 : 0);
  }
  if (query.groupId !== undefined) {
    if (query.groupId === 'ungrouped') {
      conditions.push(`(group_id IS NULL OR group_id = '')`);
    } else {
      conditions.push(`group_id = ?`);
      params.push(query.groupId);
    }
  }
  if (query.pendingTasksOnly) {
    conditions.push(`kind = 'task' AND (task_done IS NULL OR task_done = 0)`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT note_id, title, kind, status, payload_json, created_at, updated_at,
              pinned, tags_json, snippet, cover_attachment_id, voice_attachment_id,
              voice_duration_sec, attachment_names_json, group_id, last_opened_at,
              task_done, task_due_at, heading_count, task_count, unchecked_task_count, link_count
       FROM notes ${where}`,
    )
    .all(...params) as NoteRow[];

  let entries = rows.map(rowToIndexEntry);

  if (query.tag) {
    entries = entries.filter((entry) => entry.tags?.includes(query.tag!));
  }

  if (query.search) {
    const ftsQuery = escapeFts5Query(query.search);
    const ftsIds = new Set<string>();
    if (ftsQuery) {
      const ftsRows = db
        .prepare(
          `SELECT note_id FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank`,
        )
        .all(ftsQuery) as Array<{ note_id: string }>;
      for (const row of ftsRows) {
        ftsIds.add(row.note_id);
      }
    }
    entries = entries.filter((entry) => ftsIds.has(entry.id));
  }

  const sortField = query.sortBy || 'createdAt';
  const sortDir = query.sortOrder === 'asc' ? 1 : -1;
  entries = [...entries].sort((a, b) => {
    const aVal = (a[sortField] as number | undefined) ?? 0;
    const bVal = (b[sortField] as number | undefined) ?? 0;
    return (aVal - bVal) * sortDir;
  });

  const total = entries.length;
  const offset = query.offset || 0;
  const limit = Math.min(query.limit || 50, 200);
  const items = entries.slice(offset, offset + limit);
  const hasMore = offset + items.length < total;

  return { items, total, limit, offset, hasMore };
}

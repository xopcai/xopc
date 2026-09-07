import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import {
  deleteNoteAgentContextRecord,
  deleteNoteRecord,
  getNoteRecord,
  listNoteRecords,
  requireXopcDatabase,
  upsertNoteRecord,
} from '../storage/sqlite/index.js';
import { buildNoteIndexMeta } from './note-index-meta.js';
import { resolveNoteMediaDir } from './paths.js';
import type {
  Note,
  NoteIndexEntry,
  NoteSnapshot,
  NoteSnapshotEntry,
  NotesListQuery,
  SnapshotTrigger,
} from './types.js';

const log = createLogger('NotesStore');

export class NotesStore {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    requireXopcDatabase();
    this.initialized = true;
    log.debug('NotesStore initialized');
  }

  async addNote(note: Note): Promise<void> {
    requireXopcDatabase();
    upsertNoteRecord(note);
  }

  async getNote(id: string): Promise<Note | null> {
    requireXopcDatabase();
    return getNoteRecord(id);
  }

  async updateNote(id: string, patch: Partial<Note>): Promise<Note | null> {
    const existing = await this.getNote(id);
    if (!existing) return null;

    const updated: Note = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };

    requireXopcDatabase();
    upsertNoteRecord(updated);
    return updated;
  }

  async deleteNote(id: string): Promise<boolean> {
    requireXopcDatabase();
    const deleted = deleteNoteRecord(id);
    if (!deleted) {
      return false;
    }

    deleteNoteAgentContextRecord(id);
    const mediaDir = resolveNoteMediaDir(id);
    await rm(mediaDir, { recursive: true, force: true }).catch(() => undefined);
    return true;
  }

  async listNotes(query: NotesListQuery = {}): Promise<{
    items: NoteIndexEntry[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }> {
    requireXopcDatabase();
    return listNoteRecords(query);
  }

  async saveAttachment(
    noteId: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<{ relativePath: string; size: number }> {
    const mediaDir = resolveNoteMediaDir(noteId);
    await mkdir(mediaDir, { recursive: true });
    const safeName = `${randomUUID().slice(0, 8)}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const filePath = join(mediaDir, safeName);
    await writeFile(filePath, buffer);
    return { relativePath: safeName, size: buffer.length };
  }

  resolveAttachmentPath(noteId: string, relativePath: string): string {
    return join(resolveNoteMediaDir(noteId), relativePath);
  }

  async deleteAttachmentFile(noteId: string, relativePath: string): Promise<void> {
    const filePath = this.resolveAttachmentPath(noteId, relativePath);
    await rm(filePath, { force: true }).catch((err) => {
      log.warn({ err, noteId, relativePath }, 'Failed to remove note attachment file');
    });
  }

  async saveSnapshot(note: Note, trigger: SnapshotTrigger): Promise<void> {
    requireXopcDatabase();
    runSqliteWriteTransaction(db => {
      const row = db.prepare('SELECT MAX(timestamp) AS timestamp FROM note_snapshots WHERE note_id = ?').get(note.id) as { timestamp: number | null };
      const snapshot: NoteSnapshot = {
        noteId: note.id,
        timestamp: Math.max(Date.now(), (row.timestamp ?? 0) + 1),
        trigger,
        title: note.title,
        markdown: note.markdown,
        tags: note.tags,
        kind: note.kind,
        status: note.status,
      };
      db.prepare('INSERT INTO note_snapshots(note_id, timestamp, payload) VALUES (?, ?, ?)')
        .run(note.id, snapshot.timestamp, JSON.stringify(snapshot));
    });
  }

  async listSnapshots(noteId: string): Promise<NoteSnapshotEntry[]> {
    const rows = requireXopcDatabase().db.prepare('SELECT payload FROM note_snapshots WHERE note_id = ? ORDER BY timestamp DESC')
      .all(noteId) as Array<{ payload: string }>;
    return rows.map(row => {
      const snapshot = JSON.parse(row.payload) as NoteSnapshot;
      return { timestamp: snapshot.timestamp, trigger: snapshot.trigger, snippet: snapshot.markdown?.slice(0, 80) || undefined };
    });
  }

  async getSnapshot(noteId: string, timestamp: number): Promise<NoteSnapshot | null> {
    const row = requireXopcDatabase().db.prepare('SELECT payload FROM note_snapshots WHERE note_id = ? AND timestamp = ?')
      .get(noteId, timestamp) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as NoteSnapshot : null;
  }

  async pruneSnapshots(noteId: string, maxCount: number): Promise<void> {
    if (!Number.isSafeInteger(maxCount) || maxCount < 0) throw new Error('Invalid snapshot retention count');
    requireXopcDatabase().db.prepare(`DELETE FROM note_snapshots WHERE note_id = ? AND timestamp NOT IN (
      SELECT timestamp FROM note_snapshots WHERE note_id = ? ORDER BY timestamp DESC LIMIT ?
    )`).run(noteId, noteId, maxCount);
  }

  async deleteAllSnapshots(noteId: string): Promise<void> {
    requireXopcDatabase().db.prepare('DELETE FROM note_snapshots WHERE note_id = ?').run(noteId);
  }
}

export { buildNoteIndexMeta };

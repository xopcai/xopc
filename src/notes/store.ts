import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, writeFile, rm, copyFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import { resolveStateDir } from '../config/paths-state.js';
import { canRemoveRevokedNoteShareArtifact } from '../share/note-share-revocation.js';
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
  private readonly failedCleanupPaths = new Set<string>();

  async initialize(): Promise<void> {
    if (this.initialized) return;
    requireXopcDatabase();
    this.initialized = true;
    log.debug('NotesStore initialized');
  }

  addNote(note: Note): void {
    requireXopcDatabase();
    upsertNoteRecord(note);
  }

  getNote(id: string): Note | null {
    requireXopcDatabase();
    return getNoteRecord(id);
  }

  updateNote(id: string, patch: Partial<Note>): Note | null {
    const existing = this.getNote(id);
    if (!existing) return null;

    const updated: Note = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
    };

    requireXopcDatabase();
    upsertNoteRecord(updated);
    return updated;
  }

  deleteNoteAtomically(id: string): boolean {
    return runSqliteWriteTransaction(db => {
      if (!deleteNoteRecord(id)) return false;
      deleteNoteAgentContextRecord(id);
      db.prepare('DELETE FROM note_snapshots WHERE note_id = ?').run(id);
      this.queueDeletionCleanup('media', id);
      return true;
    });
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
    buffer: Buffer | { filePath: string },
  ): Promise<{ relativePath: string; size: number }> {
    const mediaDir = resolveNoteMediaDir(noteId);
    await mkdir(mediaDir, { recursive: true });
    const safeName = `${randomUUID().slice(0, 8)}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const filePath = join(mediaDir, safeName);
    if (Buffer.isBuffer(buffer)) await writeFile(filePath, buffer);
    else await copyFile(buffer.filePath, filePath);
    return { relativePath: safeName, size: (await stat(filePath)).size };
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

  saveSnapshot(note: Note, trigger: SnapshotTrigger): void {
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

  listSnapshots(noteId: string): NoteSnapshotEntry[] {
    const rows = requireXopcDatabase().db.prepare('SELECT payload FROM note_snapshots WHERE note_id = ? ORDER BY timestamp DESC')
      .all(noteId) as Array<{ payload: string }>;
    return rows.map(row => {
      const snapshot = JSON.parse(row.payload) as NoteSnapshot;
      return { timestamp: snapshot.timestamp, trigger: snapshot.trigger, snippet: snapshot.markdown?.slice(0, 80) || undefined };
    });
  }

  getSnapshot(noteId: string, timestamp: number): NoteSnapshot | null {
    const row = requireXopcDatabase().db.prepare('SELECT payload FROM note_snapshots WHERE note_id = ? AND timestamp = ?')
      .get(noteId, timestamp) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as NoteSnapshot : null;
  }

  pruneSnapshots(noteId: string, maxCount: number): void {
    if (!Number.isSafeInteger(maxCount) || maxCount < 0) throw new Error('Invalid snapshot retention count');
    requireXopcDatabase().db.prepare(`DELETE FROM note_snapshots WHERE note_id = ? AND timestamp NOT IN (
      SELECT timestamp FROM note_snapshots WHERE note_id = ? ORDER BY timestamp DESC LIMIT ?
    )`).run(noteId, noteId, maxCount);
  }

  queueAttachmentCleanup(noteId: string, relativePath: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(noteId) || !relativePath || basename(relativePath) !== relativePath || relativePath === '.' || relativePath === '..') {
      throw new Error('Invalid note attachment cleanup path');
    }
    requireXopcDatabase().db.prepare(`INSERT OR IGNORE INTO note_file_cleanup
      (note_id, relative_path, created_at) VALUES (?, ?, ?)`).run(noteId, relativePath, Date.now());
  }

  queueDeletionCleanup(kind: 'media' | 'share', id: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid note deletion cleanup identity');
    requireXopcDatabase().db.prepare('INSERT OR IGNORE INTO note_deletion_cleanup(kind, object_id, created_at) VALUES (?, ?, ?)')
      .run(kind, id, Date.now());
  }

  drainDeletionCleanup(limit = 100): void {
    const db = requireXopcDatabase().db;
    const rows = db.prepare('SELECT kind, object_id, attempts FROM note_deletion_cleanup WHERE next_attempt_at <= ? ORDER BY created_at LIMIT ?')
      .all(Date.now(), limit) as Array<{ kind: 'media' | 'share'; object_id: string; attempts: number }>;
    for (const row of rows) {
      const key = `${row.kind}:${row.object_id}`;
      try {
        if (!/^[a-zA-Z0-9_-]+$/.test(row.object_id) || !['media', 'share'].includes(row.kind)) throw new Error('Invalid note deletion cleanup identity');
        const removable = row.kind === 'media' ? !this.getNote(row.object_id) : canRemoveRevokedNoteShareArtifact(row.object_id);
        if (removable) {
          const path = row.kind === 'media' ? resolveNoteMediaDir(row.object_id) : join(resolveStateDir(), 'share-artifacts', row.object_id);
          rmSync(path, { recursive: true, force: true });
        }
        db.prepare('DELETE FROM note_deletion_cleanup WHERE kind = ? AND object_id = ?').run(row.kind, row.object_id);
        this.failedCleanupPaths.delete(key);
      } catch (err) {
        db.prepare('UPDATE note_deletion_cleanup SET attempts = attempts + 1, next_attempt_at = ? WHERE kind = ? AND object_id = ?')
          .run(Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(row.attempts, 9)), row.kind, row.object_id);
        if (!this.failedCleanupPaths.has(key)) {
          this.failedCleanupPaths.add(key);
          log.warn({ err, kind: row.kind, objectId: row.object_id }, 'Deferred note deletion cleanup failed; retry scheduled');
        }
      }
    }
  }

  /** Called after commit and on startup. A failed deletion remains durable for the next attempt. */
  drainAttachmentCleanup(limit = 100): void {
    const db = requireXopcDatabase().db;
    const rows = db.prepare('SELECT note_id, relative_path, attempts FROM note_file_cleanup WHERE next_attempt_at <= ? ORDER BY created_at LIMIT ?')
      .all(Date.now(), limit) as Array<{ note_id: string; relative_path: string; attempts: number }>;
    for (const row of rows) {
      const key = `${row.note_id}/${row.relative_path}`;
      try {
        if (!/^[a-zA-Z0-9_-]+$/.test(row.note_id) || !row.relative_path || basename(row.relative_path) !== row.relative_path
          || row.relative_path === '.' || row.relative_path === '..') throw new Error('Invalid note attachment cleanup path');
        const inUse = this.getNote(row.note_id)?.attachments?.some(item => item.relativePath === row.relative_path);
        if (!inUse) rmSync(this.resolveAttachmentPath(row.note_id, row.relative_path), { force: true });
        db.prepare('DELETE FROM note_file_cleanup WHERE note_id = ? AND relative_path = ?').run(row.note_id, row.relative_path);
        this.failedCleanupPaths.delete(key);
      } catch (err) {
        db.prepare('UPDATE note_file_cleanup SET attempts = attempts + 1, next_attempt_at = ? WHERE note_id = ? AND relative_path = ?')
          .run(Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(row.attempts, 9)), row.note_id, row.relative_path);
        if (!this.failedCleanupPaths.has(key)) {
          this.failedCleanupPaths.add(key);
          log.warn({ err, noteId: row.note_id, relativePath: row.relative_path }, 'Deferred note attachment cleanup failed; retry scheduled');
        }
      }
    }
  }
}

export { buildNoteIndexMeta };

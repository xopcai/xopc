import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { writeTextAtomic } from '../infra/write-file-atomic.js';
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
import { resolveNoteMediaDir, resolveNoteHistoryDir } from './paths.js';
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
    const historyDir = resolveNoteHistoryDir(note.id);
    await mkdir(historyDir, { recursive: true });
    const snapshot: NoteSnapshot = {
      noteId: note.id,
      timestamp: Date.now(),
      trigger,
      title: note.title,
      markdown: note.markdown,
      tags: note.tags,
      kind: note.kind,
      status: note.status,
    };
    const filePath = join(historyDir, `${snapshot.timestamp}.json`);
    await writeTextAtomic(filePath, JSON.stringify(snapshot, null, 2));
    log.debug({ noteId: note.id, trigger, timestamp: snapshot.timestamp }, 'Snapshot saved');
  }

  async listSnapshots(noteId: string): Promise<NoteSnapshotEntry[]> {
    const historyDir = resolveNoteHistoryDir(noteId);
    let files: string[];
    try {
      files = await readdir(historyDir);
    } catch {
      return [];
    }
    const entries: NoteSnapshotEntry[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const timestamp = parseInt(file.slice(0, -'.json'.length), 10);
      if (!Number.isFinite(timestamp)) continue;
      try {
        const content = await readFile(join(historyDir, file), 'utf-8');
        const snapshot = JSON.parse(content) as NoteSnapshot;
        const rawText = snapshot.markdown ?? '';
        entries.push({
          timestamp: snapshot.timestamp,
          trigger: snapshot.trigger,
          snippet: rawText.slice(0, 80) || undefined,
        });
      } catch {
        log.debug({ noteId, file }, 'Skipped unreadable snapshot');
      }
    }
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries;
  }

  async getSnapshot(noteId: string, timestamp: number): Promise<NoteSnapshot | null> {
    const filePath = join(resolveNoteHistoryDir(noteId), `${timestamp}.json`);
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as NoteSnapshot;
    } catch {
      return null;
    }
  }

  async pruneSnapshots(noteId: string, maxCount: number): Promise<void> {
    const historyDir = resolveNoteHistoryDir(noteId);
    let files: string[];
    try {
      files = await readdir(historyDir);
    } catch {
      return;
    }
    const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
    if (jsonFiles.length <= maxCount) return;
    const toDelete = jsonFiles.slice(0, jsonFiles.length - maxCount);
    for (const file of toDelete) {
      await rm(join(historyDir, file), { force: true }).catch(() => undefined);
    }
    log.debug({ noteId, deleted: toDelete.length }, 'Pruned old snapshots');
  }

  async deleteAllSnapshots(noteId: string): Promise<void> {
    const historyDir = resolveNoteHistoryDir(noteId);
    await rm(historyDir, { recursive: true, force: true }).catch(() => undefined);
  }

  /** No-op: SQLite writes are synchronous. Kept for API compatibility with tests. */
  async flush(): Promise<void> {}
}

export { buildNoteIndexMeta };

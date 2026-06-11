import { randomUUID } from 'node:crypto';
import { readFile, access, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { writeTextAtomic } from '../infra/write-file-atomic.js';
import { createLogger } from '../utils/logger.js';
import { buildNoteIndexMeta, notePlainText } from './note-index-meta.js';
import { resolveNotesDir, resolveNotesIndexPath, resolveNoteItemPath, resolveNoteMediaDir, resolveNoteHistoryDir } from './paths.js';
import type {
  Note,
  NoteIndexEntry,
  NoteSnapshot,
  NoteSnapshotEntry,
  NotesIndexFile,
  NotesListQuery,
  SnapshotTrigger,
} from './types.js';

const log = createLogger('NotesStore');

const DEFAULT_INDEX: NotesIndexFile = { version: 3, notes: [] };
const INDEX_VERSION = 3;
const DEBOUNCE_MS = 500;

function noteToIndexEntry(note: Note): NoteIndexEntry {
  const { snippet, coverAttachmentId, voiceAttachmentId, voiceDurationSec, attachmentNames } = buildNoteIndexMeta(note);
  return {
    id: note.id,
    title: note.title || undefined,
    kind: note.kind,
    status: note.status,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    pinned: note.pinned || undefined,
    tags: note.tags?.length ? note.tags : undefined,
    snippet,
    coverAttachmentId,
    voiceAttachmentId,
    voiceDurationSec,
    attachmentNames,
    groupId: note.groupId || undefined,
    lastOpenedAt: note.lastOpenedAt || undefined,
    taskDone: note.taskMeta?.done,
    taskDueAt: note.taskMeta?.dueAt,
  };
}

export class NotesStore {
  private indexCache: NotesIndexFile | null = null;
  private dirty = false;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const indexPath = resolveNotesIndexPath();
    try {
      await access(indexPath);
      await this.loadIndex();
      if ((this.indexCache?.version ?? 0) < INDEX_VERSION) {
        await this.rebuildIndexFromItems();
      }
    } catch {
      await this.writeIndex(DEFAULT_INDEX);
      this.indexCache = DEFAULT_INDEX;
    }
    this.initialized = true;
    log.debug('NotesStore initialized');
  }

  async addNote(note: Note): Promise<void> {
    const index = await this.loadIndex();
    await this.writeNoteItem(note);
    index.notes.push(noteToIndexEntry(note));
    index.version++;
    this.scheduleIndexSave(index);
  }

  async getNote(id: string): Promise<Note | null> {
    const itemPath = resolveNoteItemPath(id);
    try {
      const content = await readFile(itemPath, 'utf-8');
      return JSON.parse(content) as Note;
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err
        ? (err as NodeJS.ErrnoException).code : '';
      if (code !== 'ENOENT') {
        log.debug({ err, id }, 'Failed to read note item');
      }
      return null;
    }
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

    await this.writeNoteItem(updated);

    const index = await this.loadIndex();
    const idx = index.notes.findIndex((n) => n.id === id);
    if (idx !== -1) {
      index.notes[idx] = noteToIndexEntry(updated);
    }
    index.version++;
    this.scheduleIndexSave(index);

    return updated;
  }

  async deleteNote(id: string): Promise<boolean> {
    const existing = await this.getNote(id);
    if (!existing) return false;

    const itemPath = resolveNoteItemPath(id);
    await rm(itemPath, { force: true }).catch((err) => {
      log.warn({ err, id }, 'Failed to remove note item file');
    });

    const mediaDir = resolveNoteMediaDir(id);
    await rm(mediaDir, { recursive: true, force: true }).catch(() => undefined);

    const index = await this.loadIndex();
    const before = index.notes.length;
    index.notes = index.notes.filter((n) => n.id !== id);
    if (index.notes.length === before) {
      log.debug({ id }, 'Deleted note file but index entry was missing');
    }
    index.version++;
    this.scheduleIndexSave(index);

    return true;
  }

  async listNotes(query: NotesListQuery = {}): Promise<{ items: NoteIndexEntry[]; total: number }> {
    const index = await this.loadIndex();
    let results = index.notes;

    if (query.status) {
      results = results.filter((n) => n.status === query.status);
    } else {
      results = results.filter((n) => n.status !== 'trashed');
    }
    if (query.kind) {
      results = results.filter((n) => n.kind === query.kind);
    }
    if (query.tag) {
      results = results.filter((n) => n.tags?.includes(query.tag!));
    }
    if (query.pinned !== undefined) {
      results = results.filter((n) => Boolean(n.pinned) === query.pinned);
    }
    if (query.groupId !== undefined) {
      if (query.groupId === 'ungrouped') {
        results = results.filter((n) => !n.groupId);
      } else {
        results = results.filter((n) => n.groupId === query.groupId);
      }
    }
    if (query.pendingTasksOnly) {
      results = results.filter((n) => n.kind === 'task' && !n.taskDone);
    }
    if (query.search) {
      const term = query.search.toLowerCase();
      const indexMatches = results.filter((n) => this.noteIndexEntryMatchesSearch(n, term));
      const indexMatchedIds = new Set(indexMatches.map((n) => n.id));
      const contentMatches: NoteIndexEntry[] = [];
      const candidates = results.filter((n) => !indexMatchedIds.has(n.id));
      for (const candidate of candidates) {
        const note = await this.getNote(candidate.id);
        if (!note) continue;
        const content = [note.title, notePlainText(note), note.attachments?.map((a) => a.transcript).join(' ')]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (content.includes(term)) {
          contentMatches.push(candidate);
        }
      }
      results = [...indexMatches, ...contentMatches];
    }

    const sortField = query.sortBy || 'createdAt';
    const sortDir = query.sortOrder === 'asc' ? 1 : -1;
    results = [...results].sort((a, b) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      return (aVal - bVal) * sortDir;
    });

    const total = results.length;
    const offset = query.offset || 0;
    const limit = Math.min(query.limit || 50, 200);
    const items = results.slice(offset, offset + limit);

    return { items, total };
  }

  private noteIndexEntryMatchesSearch(entry: NoteIndexEntry, term: string): boolean {
    return Boolean(
      entry.title?.toLowerCase().includes(term) ||
      entry.snippet?.toLowerCase().includes(term) ||
      entry.tags?.some((tag) => tag.toLowerCase().includes(term)) ||
      entry.attachmentNames?.some((name) => name.toLowerCase().includes(term)),
    );
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
      text: note.text,
      blocks: note.blocks,
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
        const rawText = snapshot.text ?? '';
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
    const jsonFiles = files
      .filter((f) => f.endsWith('.json'))
      .sort();
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

  async flush(): Promise<void> {
    if (!this.dirty || !this.indexCache) return;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.writeIndex(this.indexCache);
    this.dirty = false;
  }

  private async loadIndex(): Promise<NotesIndexFile> {
    if (this.indexCache) return this.indexCache;
    const indexPath = resolveNotesIndexPath();
    try {
      const content = await readFile(indexPath, 'utf-8');
      const data = JSON.parse(content) as NotesIndexFile;
      if (!data.notes || !Array.isArray(data.notes)) {
        log.warn('Notes index invalid, resetting');
        this.indexCache = DEFAULT_INDEX;
        return this.indexCache;
      }
      this.indexCache = data;
      return data;
    } catch {
      this.indexCache = DEFAULT_INDEX;
      return this.indexCache;
    }
  }

  private async writeIndex(data: NotesIndexFile): Promise<void> {
    const indexPath = resolveNotesIndexPath();
    await writeTextAtomic(indexPath, JSON.stringify(data, null, 2));
    log.debug({ count: data.notes.length }, 'Notes index saved');
  }

  private async writeNoteItem(note: Note): Promise<void> {
    const itemPath = resolveNoteItemPath(note.id);
    await writeTextAtomic(itemPath, JSON.stringify(note, null, 2));
  }

  private scheduleIndexSave(data: NotesIndexFile): void {
    this.indexCache = data;
    this.dirty = true;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.flush().catch((err) => {
        log.error({ err }, 'Failed to flush notes index');
      });
    }, DEBOUNCE_MS);
  }

  private async rebuildIndexFromItems(): Promise<void> {
    const itemsDir = join(resolveNotesDir(), 'items');
    let files: string[];
    try {
      files = await readdir(itemsDir);
    } catch {
      this.indexCache = DEFAULT_INDEX;
      await this.writeIndex(DEFAULT_INDEX);
      return;
    }

    const entries: NoteIndexEntry[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const noteId = file.slice(0, -'.json'.length);
      const note = await this.getNote(noteId);
      if (note) {
        entries.push(noteToIndexEntry(note));
      }
    }

    entries.sort((a, b) => b.createdAt - a.createdAt);
    const index: NotesIndexFile = { version: INDEX_VERSION, notes: entries };
    this.indexCache = index;
    await this.writeIndex(index);
    log.debug({ count: entries.length }, 'Notes index rebuilt');
  }
}

import { randomUUID } from 'node:crypto';
import { readFile, access, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { writeTextAtomic } from '../infra/write-file-atomic.js';
import { createLogger } from '../utils/logger.js';
import { resolveNotesIndexPath, resolveNoteItemPath, resolveNoteMediaDir } from './paths.js';
import type {
  Note,
  NoteIndexEntry,
  NotesIndexFile,
  NotesListQuery,
} from './types.js';

const log = createLogger('NotesStore');

const DEFAULT_INDEX: NotesIndexFile = { version: 1, notes: [] };
const DEBOUNCE_MS = 500;
const SNIPPET_LENGTH = 100;

function buildSnippet(note: Pick<Note, 'text' | 'blocks'>): string | undefined {
  const text = note.text || note.blocks?.map((block) => {
    if (block.type === 'divider') return '';
    if (block.type === 'todo') return block.text;
    return block.text;
  }).join(' ');
  if (!text) return undefined;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > SNIPPET_LENGTH ? `${clean.slice(0, SNIPPET_LENGTH)}…` : clean;
}

function noteToIndexEntry(note: Note): NoteIndexEntry {
  return {
    id: note.id,
    kind: note.kind,
    status: note.status,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    pinned: note.pinned || undefined,
    tags: note.tags?.length ? note.tags : undefined,
    snippet: buildSnippet(note),
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
    if (query.search) {
      const term = query.search.toLowerCase();
      results = results.filter((n) =>
        n.snippet?.toLowerCase().includes(term) ||
        n.tags?.some((t) => t.toLowerCase().includes(term)),
      );
    }

    const sortField = query.sortBy || 'createdAt';
    const sortDir = query.sortOrder === 'asc' ? 1 : -1;
    results = [...results].sort((a, b) => (a[sortField] - b[sortField]) * sortDir);

    const total = results.length;
    const offset = query.offset || 0;
    const limit = Math.min(query.limit || 50, 200);
    const items = results.slice(offset, offset + limit);

    return { items, total };
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
}

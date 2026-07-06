import { access, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { resolveNoteHistoryDir } from '../paths.js';
import { buildNoteAttachmentRef } from '../attachment-ref.js';
import { NotesStore } from '../store.js';
import type { Note } from '../types.js';

describe('NotesStore deleteNote', () => {
  let stateDir: string;
  let previousStateDir: string | undefined;
  let store: NotesStore;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'xopc-notes-'));
    previousStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = stateDir;
    store = new NotesStore();
    await store.initialize();
  });

  afterEach(async () => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    if (previousStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = previousStateDir;
    }
    await rm(stateDir, { recursive: true, force: true });
  });

  it('removes note and index entry on delete', async () => {
    const note: Note = {
      id: 'note-delete-me',
      kind: 'thought',
      status: 'inbox',
      markdown: 'to delete',
      createdAt: 1,
      updatedAt: 1,
      capturedVia: { channel: 'web' },
    };

    await store.addNote(note);
    await store.flush();

    const deleted = await store.deleteNote(note.id);
    await store.flush();

    expect(deleted).toBe(true);
    expect(await store.getNote(note.id)).toBeNull();

    const listed = await store.listNotes();
    expect(listed.items.some((item) => item.id === note.id)).toBe(false);
  });

  it('excludes trashed notes from default list', async () => {
    await store.addNote({
      id: 'active-note',
      kind: 'thought',
      status: 'inbox',
      markdown: 'active',
      createdAt: 2,
      updatedAt: 2,
      capturedVia: { channel: 'web' },
    });
    await store.addNote({
      id: 'trashed-note',
      kind: 'thought',
      status: 'trashed',
      markdown: 'trashed',
      createdAt: 1,
      updatedAt: 1,
      capturedVia: { channel: 'web' },
    });

    const listed = await store.listNotes();
    expect(listed.items.map((item) => item.id)).toEqual(['active-note']);

    const trashedOnly = await store.listNotes({ status: 'trashed' });
    expect(trashedOnly.items.map((item) => item.id)).toEqual(['trashed-note']);
  });

  it('indexes coverAttachmentId for image notes after re-init', async () => {
    const note: Note = {
      id: 'note-with-image',
      kind: 'media',
      status: 'inbox',
      markdown: `![photo.jpg](${buildNoteAttachmentRef('note-with-image', 'att-1')})`,
      attachments: [
        {
          id: 'att-1',
          type: 'image',
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
          size: 10,
          relativePath: 'photo.jpg',
        },
      ],
      createdAt: 2,
      updatedAt: 2,
      capturedVia: { channel: 'web' },
    };

    await store.addNote(note);
    await store.flush();

    const listed = await store.listNotes();
    expect(listed.items[0]).toMatchObject({
      id: 'note-with-image',
      coverAttachmentId: 'att-1',
    });
    expect(listed.items[0]?.snippet).toBeUndefined();

    store = new NotesStore();
    await store.initialize();

    const rebuilt = await store.listNotes();
    expect(rebuilt.items[0]?.coverAttachmentId).toBe('att-1');
  });

  it('prunes orphan attachments when note text is updated via service', async () => {
    const { NotesService } = await import('../service.js');
    const service = new NotesService(store);
    await service.initialize();

    const note: Note = {
      id: 'note-prune',
      kind: 'media',
      status: 'inbox',
      markdown: `![photo.jpg](${buildNoteAttachmentRef('note-prune', 'att-keep')})`,
      attachments: [
        {
          id: 'att-keep',
          type: 'image',
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
          size: 10,
          relativePath: 'keep.jpg',
        },
        {
          id: 'att-orphan',
          type: 'image',
          mimeType: 'image/jpeg',
          fileName: 'orphan.jpg',
          size: 10,
          relativePath: 'orphan.jpg',
        },
      ],
      createdAt: 3,
      updatedAt: 3,
      capturedVia: { channel: 'web' },
    };

    await store.addNote(note);
    const mediaDir = join(stateDir, 'notes', 'media', 'note-prune');
    await mkdir(mediaDir, { recursive: true });
    await writeFile(join(mediaDir, 'keep.jpg'), Buffer.from('keep'));
    await writeFile(join(mediaDir, 'orphan.jpg'), Buffer.from('orphan'));
    await store.flush();

    await service.updateNote('note-prune', { markdown: 'Plain text only' });
    await store.flush();

    const updated = await store.getNote('note-prune');
    expect(updated?.attachments ?? []).toEqual([]);
    await expect(access(join(mediaDir, 'orphan.jpg'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(access(join(mediaDir, 'keep.jpg'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const listed = await store.listNotes();
    expect(listed.items.find((item) => item.id === 'note-prune')).toMatchObject({
      coverAttachmentId: undefined,
      snippet: 'Plain text only',
    });
  });

  it('searches notes by attachment file name', async () => {
    const note: Note = {
      id: 'note-search-file',
      kind: 'media',
      status: 'inbox',
      markdown: `![scan.jpg](${buildNoteAttachmentRef('note-search-file', 'att-1')})`,
      attachments: [
        {
          id: 'att-1',
          type: 'image',
          mimeType: 'image/jpeg',
          fileName: 'Receipt-2024.jpg',
          size: 10,
          relativePath: 'receipt.jpg',
        },
      ],
      createdAt: 3,
      updatedAt: 3,
      capturedVia: { channel: 'web' },
    };

    await store.addNote(note);
    await store.flush();

    const match = await store.listNotes({ search: 'receipt-2024' });
    expect(match.items.map((item) => item.id)).toEqual(['note-search-file']);

    const miss = await store.listNotes({ search: 'invoice' });
    expect(miss.items.map((item) => item.id)).toEqual([]);
  });

  it('searches notes by full body beyond the index snippet', async () => {
    const note: Note = {
      id: 'note-search-body',
      kind: 'thought',
      status: 'inbox',
      markdown: `${'prefix '.repeat(40)}deep-body-keyword`,
      createdAt: 4,
      updatedAt: 4,
      capturedVia: { channel: 'web' },
    };

    await store.addNote(note);
    await store.flush();

    const match = await store.listNotes({ search: 'deep-body-keyword' });
    expect(match.items.map((item) => item.id)).toEqual(['note-search-body']);
  });

  it('searches notes by substring when FTS token matching is too narrow', async () => {
    await store.addNote({
      id: 'note-search-number',
      kind: 'thought',
      status: 'inbox',
      title: '123123',
      markdown: '123123',
      createdAt: 5,
      updatedAt: 5,
      capturedVia: { channel: 'web' },
    });
    await store.flush();

    const match = await store.listNotes({ search: '2' });
    expect(match.items.map((item) => item.id)).toEqual(['note-search-number']);
  });
});

describe('NotesStore snapshots', () => {
  let stateDir: string;
  let previousStateDir: string | undefined;
  let store: NotesStore;

  const makeNote = (id: string, markdown: string): Note => ({
    id,
    kind: 'thought',
    status: 'inbox',
    markdown,
    createdAt: 1,
    updatedAt: 1,
    capturedVia: { channel: 'web' },
  });

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'xopc-snap-'));
    previousStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = stateDir;
    store = new NotesStore();
    await store.initialize();
  });

  afterEach(async () => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    if (previousStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = previousStateDir;
    }
    await rm(stateDir, { recursive: true, force: true });
  });

  it('saves and retrieves a snapshot', async () => {
    const note = makeNote('snap-1', 'hello world');
    await store.addNote(note);
    await store.saveSnapshot(note, 'edit');

    const entries = await store.listSnapshots('snap-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].trigger).toBe('edit');
    expect(entries[0].snippet).toBe('hello world');

    const snapshot = await store.getSnapshot('snap-1', entries[0].timestamp);
    expect(snapshot).toMatchObject({
      noteId: 'snap-1',
      markdown: 'hello world',
      trigger: 'edit',
    });
  });

  it('lists snapshots in reverse chronological order', async () => {
    const note = makeNote('snap-order', 'v1');
    await store.addNote(note);

    await store.saveSnapshot({ ...note, markdown: 'v1' }, 'edit');
    await new Promise((r) => setTimeout(r, 10));
    await store.saveSnapshot({ ...note, markdown: 'v2' }, 'ai_edit');

    const entries = await store.listSnapshots('snap-order');
    expect(entries).toHaveLength(2);
    expect(entries[0].trigger).toBe('ai_edit');
    expect(entries[1].trigger).toBe('edit');
    expect(entries[0].timestamp).toBeGreaterThan(entries[1].timestamp);
  });

  it('prunes oldest snapshots when exceeding maxCount', async () => {
    const note = makeNote('snap-prune', 'text');
    await store.addNote(note);

    for (let i = 0; i < 5; i++) {
      await store.saveSnapshot({ ...note, markdown: `v${i}` }, 'edit');
      await new Promise((r) => setTimeout(r, 5));
    }

    await store.pruneSnapshots('snap-prune', 3);
    const entries = await store.listSnapshots('snap-prune');
    expect(entries).toHaveLength(3);
    expect(entries[0].snippet).toBe('v4');
    expect(entries[2].snippet).toBe('v2');
  });

  it('deleteAllSnapshots removes the history directory', async () => {
    const note = makeNote('snap-del', 'text');
    await store.addNote(note);
    await store.saveSnapshot(note, 'edit');

    const historyDir = resolveNoteHistoryDir('snap-del');
    const filesBefore = await readdir(historyDir);
    expect(filesBefore.length).toBeGreaterThan(0);

    await store.deleteAllSnapshots('snap-del');
    await expect(access(historyDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns null for non-existent snapshot', async () => {
    const snapshot = await store.getSnapshot('no-such-note', 9999);
    expect(snapshot).toBeNull();
  });

  it('returns empty list for note with no history', async () => {
    const entries = await store.listSnapshots('no-history');
    expect(entries).toEqual([]);
  });
});

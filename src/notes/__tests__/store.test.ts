import { access, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveNoteItemPath, resolveNotesIndexPath } from '../paths.js';
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
    if (previousStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = previousStateDir;
    }
    await rm(stateDir, { recursive: true, force: true });
  });

  it('removes note file and index entry on delete', async () => {
    const note: Note = {
      id: 'note-delete-me',
      kind: 'thought',
      status: 'inbox',
      text: 'to delete',
      createdAt: 1,
      updatedAt: 1,
      capturedVia: { channel: 'web' },
    };

    await store.addNote(note);
    await store.flush();

    const deleted = await store.deleteNote(note.id);
    await store.flush();

    expect(deleted).toBe(true);
    await expect(access(resolveNoteItemPath(note.id))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.getNote(note.id)).toBeNull();

    const listed = await store.listNotes();
    expect(listed.items.some((item) => item.id === note.id)).toBe(false);
  });

  it('excludes trashed notes from default list', async () => {
    const indexPath = resolveNotesIndexPath();
    await mkdir(join(stateDir, 'notes', 'items'), { recursive: true });
    await writeFile(
      indexPath,
      JSON.stringify({
        version: 1,
        notes: [
          {
            id: 'active-note',
            kind: 'thought',
            status: 'inbox',
            createdAt: 2,
            updatedAt: 2,
            snippet: 'active',
          },
          {
            id: 'trashed-note',
            kind: 'thought',
            status: 'trashed',
            createdAt: 1,
            updatedAt: 1,
            snippet: 'trashed',
          },
        ],
      }),
    );

    store = new NotesStore();
    await store.initialize();

    const listed = await store.listNotes();
    expect(listed.items.map((item) => item.id)).toEqual(['active-note']);

    const trashedOnly = await store.listNotes({ status: 'trashed' });
    expect(trashedOnly.items.map((item) => item.id)).toEqual(['trashed-note']);
  });
});

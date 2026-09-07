import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { createNoteShare, deleteNote, type Note } from '../notes';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../api/client', () => ({ apiFetch: vi.fn() }));

const request = vi.mocked(apiFetch);
const note = { id: 'note/1', updatedAt: 42, markdown: 'Private note body' } as Note;

beforeEach(() => request.mockReset());

describe('note share links', () => {
  it('creates a version-checked 24-hour snapshot without sending note text', async () => {
    const payload = { id: 'share-1', shareUrl: 'https://example.com/s/token', expiresAt: 1000, sourceVersion: 42 };
    request.mockResolvedValue(new Response(JSON.stringify({ ok: true, payload }), { status: 201 }));
    await expect(createNoteShare(note)).resolves.toEqual(payload);
    expect(request).toHaveBeenCalledWith('/api/notes/note%2F1/shares', {
      method: 'POST', body: JSON.stringify({ expectedNoteVersion: 42, ttlMs: 86_400_000 }),
    });
  });

  it('preserves a version conflict so the user can reopen the latest preview', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: { code: 'note_version_conflict', message: 'Note changed after preview' },
    }), { status: 409 }));
    await expect(createNoteShare(note)).rejects.toMatchObject({
      message: 'Note changed after preview', code: 'note_version_conflict', status: 409,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports ordinary note errors without hiding the message', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ error: 'Note not found', code: 'note_not_found' }), { status: 404 }));
    await expect(deleteNote(note.id)).rejects.toMatchObject({ message: 'Note not found', code: 'note_not_found' });
  });
});

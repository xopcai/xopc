import { beforeEach, describe, expect, it, vi } from 'vitest';

import { noteCreationChatHref, prepareAgentNote, type NoteCreationDraft } from '../note-creation';
import { createNote, openNoteChat, updateNote, uploadNoteMedia } from '../notes-api';

vi.mock('../notes-api', () => ({
  createNote: vi.fn(), openNoteChat: vi.fn(), updateNote: vi.fn(), uploadNoteMedia: vi.fn(),
  noteAttachmentRef: (noteId: string, attachmentId: string) => `note://${noteId}/${attachmentId}`,
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createNote).mockResolvedValue({ id: 'note-1' } as never);
  vi.mocked(updateNote).mockResolvedValue({ id: 'note-1' } as never);
  vi.mocked(openNoteChat).mockResolvedValue({ sessionKey: 'agent:main:note', reused: false });
});

function draft(): NoteCreationDraft {
  return { requestId: 'request-1', title: 'Draft', markdown: 'User request', projectId: 'p1',
    files: [{ name: 'one.txt' }, { name: 'two.txt' }] as File[], attachments: [], materialHeading: 'Material' };
}

describe('agent note creation', () => {
  it('resumes a failed attachment upload without duplicating the note or completed uploads', async () => {
    const pending = draft();
    vi.mocked(uploadNoteMedia)
      .mockResolvedValueOnce({ id: 'a1', fileName: 'one.txt' } as never)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 'a2', fileName: '[two].txt' } as never);
    await expect(prepareAgentNote(pending)).rejects.toThrow('offline');
    expect(openNoteChat).not.toHaveBeenCalled();
    await expect(prepareAgentNote(pending)).resolves.toMatchObject({ noteId: 'note-1' });
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }), 'request-1');
    expect(uploadNoteMedia).toHaveBeenNthCalledWith(3, 'note-1', pending.files[1], 'request-1:file:1');
    expect(updateNote).toHaveBeenCalledWith('note-1', { markdown: 'User request\n\n## Material\n\n[one.txt](note://note-1/a1)\n\n[\\[two\\].txt](note://note-1/a2)' });
    expect(openNoteChat).toHaveBeenCalledWith('note-1', { projectId: 'p1' });
  });

  it('reuses the saved note if opening its agent conversation fails', async () => {
    const pending = { ...draft(), files: [] };
    vi.mocked(openNoteChat).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ sessionKey: 'chat', reused: true });
    await expect(prepareAgentNote(pending)).rejects.toThrow('offline');
    await prepareAgentNote(pending);
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(openNoteChat).toHaveBeenCalledTimes(2);
  });

  it('preserves the request key after an uncertain create response and safely encodes the handoff', async () => {
    const pending = { ...draft(), files: [] };
    vi.mocked(createNote).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ id: 'note-1' } as never);
    await expect(prepareAgentNote(pending)).rejects.toThrow();
    await prepareAgentNote(pending);
    expect(vi.mocked(createNote).mock.calls.map((call) => call[1])).toEqual(['request-1', 'request-1']);
    const href = noteCreationChatHref('agent:main:a/b', 'note-1', 'Update {{id}} & retain sources');
    expect(href).toContain('/chat/agent%3Amain%3Aa%2Fb?');
    const query = new URLSearchParams(href.split('?')[1]);
    expect(query.get('draft')).toBe('Update note-1 & retain sources');
    expect(query.get('autoSend')).toBe('1');
  });
});

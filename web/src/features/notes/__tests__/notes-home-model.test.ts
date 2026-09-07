import { describe, expect, it } from 'vitest';
import { noteHomePreview, notesHomeQuery } from '../notes-home-model';
import type { NoteIndexEntry } from '../notes-api';

describe('notes home queries', () => {
  it('applies project, agent, full-text search and pagination on the server', () => {
    expect(notesHomeQuery(new URLSearchParams('projectId=p1&view=agent&page=2'), ' brief ')).toMatchObject({
      projectId: 'p1', agentEdited: true, search: 'brief', offset: 24, limit: 12, sortBy: 'updatedAt', sortOrder: 'desc',
    });
  });
  it('keeps unassigned scope when switching to favorites and rejects invalid page numbers', () => {
    expect(notesHomeQuery(new URLSearchParams('unassigned=true&view=favorites&page=-2'), '')).toMatchObject({
      unassigned: true, pinned: true, offset: 0, search: undefined,
    });
    expect(notesHomeQuery(new URLSearchParams('page=not-a-number'), '').offset).toBe(0);
  });
  it('removes a repeated title while preserving a distinct preview', () => {
    expect(noteHomePreview({ title: 'Design', snippet: 'Design · The next steps' } as NoteIndexEntry)).toBe('The next steps');
    expect(noteHomePreview({ title: 'Design', snippet: 'Key decisions' } as NoteIndexEntry)).toBe('Key decisions');
  });
});

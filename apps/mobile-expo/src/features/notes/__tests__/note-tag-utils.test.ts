import { describe, expect, it } from 'vitest';

import {
  collectTagsFromNotes,
  getNotePrimaryTag,
  getNoteTags,
  isValidTagName,
  mergeTagLists,
  noteHasTag,
  noteMatchesTagFilter,
  normalizeTagName,
} from '../note-tag-utils';

describe('note-tag-utils', () => {
  it('normalizes tag names', () => {
    expect(normalizeTagName('  work  notes  ')).toBe('work notes');
  });

  it('validates tag names', () => {
    expect(isValidTagName('工作')).toBe(true);
    expect(isValidTagName('')).toBe(false);
    expect(isValidTagName('a'.repeat(25))).toBe(false);
  });

  it('reads tags from note', () => {
    expect(getNoteTags({ tags: ['工作', '生活', '工作'] })).toEqual(['工作', '生活']);
    expect(getNotePrimaryTag({ tags: ['工作', '生活'] })).toBe('工作');
    expect(getNoteTags({ tags: [] })).toEqual([]);
  });

  it('filters notes by tag', () => {
    const notes = [
      { tags: ['工作'] },
      { tags: ['生活'] },
      { tags: ['工作', '生活'] },
      { tags: undefined },
    ];
    expect(notes.filter((note) => noteMatchesTagFilter(note, '工作'))).toHaveLength(2);
    expect(notes.filter((note) => noteMatchesTagFilter(note, '生活'))).toHaveLength(2);
    expect(notes.filter((note) => noteMatchesTagFilter(note, 'all'))).toHaveLength(4);
    expect(noteHasTag({ tags: ['工作', '生活'] }, '生活')).toBe(true);
  });

  it('collects unique tags from notes', () => {
    expect(collectTagsFromNotes([
      { tags: ['工作'] },
      { tags: ['生活', '工作'] },
      { tags: ['工作'] },
    ])).toEqual(['工作', '生活']);
  });

  it('merges tag lists without duplicates', () => {
    expect(mergeTagLists(['工作'], ['生活', '工作'])).toEqual(['工作', '生活']);
  });
});

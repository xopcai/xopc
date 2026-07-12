import { describe, expect, it } from 'vitest';

import type { NoteIndexEntry } from '../../../query/notes';
import {
  buildInboxOrganizePatch,
  buildInboxOrganizeSuggestions,
} from '../ai-organize';

function note(overrides: Partial<NoteIndexEntry>): NoteIndexEntry {
  return {
    id: 'note',
    kind: 'thought',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('buildInboxOrganizeSuggestions', () => {
  it('groups active inbox items by actionable kind', () => {
    const suggestions = buildInboxOrganizeSuggestions([
      note({ id: 'link-1', kind: 'bookmark' }),
      note({ id: 'todo-1', kind: 'todo' }),
      note({ id: 'voice-1', kind: 'voice' }),
      note({ id: 'old-link', kind: 'bookmark', status: 'processed' }),
    ]);

    expect(suggestions).toEqual([
      { id: 'bookmark', itemIds: ['link-1'], count: 1 },
      { id: 'todo', itemIds: ['todo-1'], count: 1 },
      { id: 'voice', itemIds: ['voice-1'], count: 1 },
    ]);
  });

  it('builds conservative patches that preserve existing tags', () => {
    expect(buildInboxOrganizePatch(note({ kind: 'bookmark', tags: ['read'] }), 'bookmark')).toEqual({
      status: 'processed',
      tags: ['read', 'link'],
    });
    expect(buildInboxOrganizePatch(note({ kind: 'voice', tags: ['voice'] }), 'voice')).toEqual({
      tags: ['voice'],
    });
  });
});

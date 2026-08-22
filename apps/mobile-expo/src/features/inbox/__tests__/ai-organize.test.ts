import { describe, expect, it, vi } from 'vitest';

import type { NoteIndexEntry } from '../../../query/notes';
import {
  applyInboxOrganizeSuggestion,
  buildInboxOrganizePatch,
  buildInboxOrganizeSuggestions,
  restoreInboxOrganizeSnapshot,
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

  it('rolls back earlier changes when a later update fails', async () => {
    const items = [
      note({ id: 'link-1', kind: 'bookmark', tags: ['read'] }),
      note({ id: 'link-2', kind: 'bookmark' }),
    ];
    const update = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('update failed'))
      .mockResolvedValueOnce(undefined);

    await expect(applyInboxOrganizeSuggestion({
      suggestion: { id: 'bookmark', itemIds: ['link-1', 'link-2'], count: 2 },
      itemsById: new Map(items.map((item) => [item.id, item])),
      update,
    })).rejects.toThrow('update failed');

    expect(update).toHaveBeenLastCalledWith('link-1', { status: 'inbox', tags: ['read'] });
  });

  it('restores the complete snapshot for undo', async () => {
    const update = vi.fn().mockResolvedValue(undefined);

    await restoreInboxOrganizeSnapshot([
      { id: 'link-1', status: 'inbox', tags: undefined },
      { id: 'voice-1', status: 'processed', tags: ['voice'] },
    ], update);

    expect(update).toHaveBeenCalledWith('link-1', { status: 'inbox', tags: [] });
    expect(update).toHaveBeenCalledWith('voice-1', { status: 'processed', tags: ['voice'] });
  });
});

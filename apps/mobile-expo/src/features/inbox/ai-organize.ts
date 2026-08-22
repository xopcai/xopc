import type { NoteIndexEntry, NoteStatus } from '../../query/notes';

export type InboxOrganizePatch = {
  status?: NoteStatus;
  tags?: string[];
};

export type InboxOrganizeSuggestionKind = 'bookmark' | 'todo' | 'voice' | 'media';

export type InboxOrganizeSuggestion = {
  id: InboxOrganizeSuggestionKind;
  itemIds: string[];
  count: number;
};

export type InboxOrganizeSnapshot = Array<Pick<NoteIndexEntry, 'id' | 'status' | 'tags'>>;

type UpdateNote = (id: string, patch: InboxOrganizePatch) => Promise<unknown>;

function withTag(item: NoteIndexEntry, tag: string): string[] {
  const tags = item.tags ?? [];
  return tags.includes(tag) ? tags : [...tags, tag];
}

export function buildInboxOrganizeSuggestions(items: NoteIndexEntry[]): InboxOrganizeSuggestion[] {
  const activeItems = items.filter((item) => item.status === 'inbox');
  const groups: Array<[InboxOrganizeSuggestionKind, (item: NoteIndexEntry) => boolean]> = [
    ['bookmark', (item) => item.kind === 'bookmark'],
    ['todo', (item) => item.kind === 'todo' || item.kind === 'task'],
    ['voice', (item) => item.kind === 'voice'],
    ['media', (item) => item.kind === 'media'],
  ];

  return groups.flatMap(([id, predicate]) => {
    const matching = activeItems.filter(predicate);
    if (matching.length === 0) return [];
    return [{ id, itemIds: matching.map((item) => item.id), count: matching.length }];
  });
}

export function buildInboxOrganizePatch(
  item: NoteIndexEntry,
  suggestion: InboxOrganizeSuggestionKind,
): InboxOrganizePatch {
  switch (suggestion) {
    case 'bookmark':
      return { status: 'processed', tags: withTag(item, 'link') };
    case 'todo':
      return { status: 'processed', tags: withTag(item, 'task') };
    case 'voice':
      return { tags: withTag(item, 'voice') };
    case 'media':
      return { tags: withTag(item, 'media') };
  }
}

export async function applyInboxOrganizeSuggestion(input: {
  suggestion: InboxOrganizeSuggestion;
  itemsById: Map<string, NoteIndexEntry>;
  update: UpdateNote;
}): Promise<InboxOrganizeSnapshot> {
  const snapshots = input.suggestion.itemIds.flatMap((id) => {
    const item = input.itemsById.get(id);
    return item ? [{ id: item.id, status: item.status, tags: item.tags ? [...item.tags] : undefined }] : [];
  });
  const applied: InboxOrganizeSnapshot = [];

  try {
    for (const snapshot of snapshots) {
      const item = input.itemsById.get(snapshot.id);
      if (!item) continue;
      await input.update(snapshot.id, buildInboxOrganizePatch(item, input.suggestion.id));
      applied.push(snapshot);
    }
    return snapshots;
  } catch (error) {
    await Promise.allSettled(applied.map((snapshot) => input.update(snapshot.id, {
      status: snapshot.status,
      tags: snapshot.tags ?? [],
    })));
    throw error;
  }
}

export async function restoreInboxOrganizeSnapshot(
  snapshot: InboxOrganizeSnapshot,
  update: UpdateNote,
): Promise<void> {
  await Promise.all(snapshot.map((item) => update(item.id, {
    status: item.status,
    tags: item.tags ?? [],
  })));
}

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

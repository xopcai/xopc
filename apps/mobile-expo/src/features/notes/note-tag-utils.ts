import type { Note, NoteIndexEntry } from '../../query/notes';
import { colors as tokenColors, type ColorScheme } from '../../theme/tokens';

export type NoteTagFilter = 'all' | string;

function noteTagPalette(colors: ColorScheme) {
  return [
    { bg: colors.accent.soft, fg: colors.accent.primary },
    { bg: colors.surface.input, fg: colors.semantic.success },
    { bg: colors.surface.input, fg: colors.semantic.warning },
    { bg: colors.surface.input, fg: colors.semantic.errorBold },
    { bg: colors.surface.input, fg: colors.text.secondary },
    { bg: colors.accent.selectionBg, fg: colors.accent.primary },
  ] as const;
}

export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function isValidTagName(raw: string): boolean {
  const name = normalizeTagName(raw);
  return name.length > 0 && name.length <= 24;
}

export function getNoteTags(note: Pick<Note | NoteIndexEntry, 'tags'>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of note.tags ?? []) {
    const tag = normalizeTagName(raw);
    if (!isValidTagName(tag) || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

export function getNotePrimaryTag(note: Pick<Note | NoteIndexEntry, 'tags'>): string | null {
  return getNoteTags(note)[0] ?? null;
}

export function noteHasTag(note: Pick<NoteIndexEntry, 'tags'>, tag: string): boolean {
  return getNoteTags(note).includes(tag);
}

export function noteMatchesTagFilter(
  note: Pick<NoteIndexEntry, 'tags'>,
  filter: NoteTagFilter,
): boolean {
  if (filter === 'all') return true;
  return noteHasTag(note, filter);
}

export function getTagPaletteIndex(tag: string, tags: readonly string[]): number {
  const index = tags.indexOf(tag);
  return index >= 0 ? index : 0;
}

export function getTagColors(
  tag: string | null,
  tags: readonly string[],
  colors: ColorScheme = tokenColors.light,
) {
  const palette = noteTagPalette(colors);
  if (!tag) return palette[0];
  const index = getTagPaletteIndex(tag, tags);
  return palette[index % palette.length];
}

export function collectTagsFromNotes(notes: readonly Pick<NoteIndexEntry, 'tags'>[]): string[] {
  const seen = new Set<string>();
  const collected: string[] = [];
  for (const note of notes) {
    for (const tag of getNoteTags(note)) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      collected.push(tag);
    }
  }
  return collected;
}

export function mergeTagLists(...lists: readonly string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const tag = normalizeTagName(raw);
      if (!isValidTagName(tag) || seen.has(tag)) continue;
      seen.add(tag);
      merged.push(tag);
    }
  }
  return merged;
}

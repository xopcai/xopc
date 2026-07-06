import { create } from 'zustand';

import {
  isValidTagName,
  mergeTagLists,
  normalizeTagName,
} from '../features/notes/note-tag-utils';
import { KEYS, storage } from '../storage/mmkv';

type NoteTagsState = {
  tags: string[];
  addTag: (raw: string) => string | null;
  removeTag: (tag: string) => void;
  ensureTags: (incoming: readonly string[]) => void;
  hydrate: () => void;
};

function readStoredTags(): string[] {
  const raw = storage.getString(KEYS.noteTags);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return mergeTagLists(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return [];
  }
}

function writeStoredTags(tags: string[]): void {
  storage.set(KEYS.noteTags, JSON.stringify(tags));
}

export const useNoteTagsStore = create<NoteTagsState>((set, get) => ({
  tags: [],

  addTag: (raw) => {
    const name = normalizeTagName(raw);
    if (!isValidTagName(name)) return null;
    const existing = get().tags;
    if (existing.includes(name)) return name;
    const next = [...existing, name];
    writeStoredTags(next);
    set({ tags: next });
    return name;
  },

  removeTag: (tag) => {
    const next = get().tags.filter((item) => item !== tag);
    writeStoredTags(next);
    set({ tags: next });
  },

  ensureTags: (incoming) => {
    const next = mergeTagLists(get().tags, [...incoming]);
    if (next.length === get().tags.length && next.every((tag, index) => tag === get().tags[index])) {
      return;
    }
    writeStoredTags(next);
    set({ tags: next });
  },

  hydrate: () => {
    set({ tags: readStoredTags() });
  },
}));

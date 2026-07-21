import { create } from 'zustand';

export type ActivityTone = 'info' | 'success' | 'warning' | 'error';
export type ActivityStatus = 'running' | 'done' | 'attention' | 'failed';

export type ActivityItem = {
  id: string;
  tone: ActivityTone;
  status: ActivityStatus;
  title: string;
  message?: string;
  source?: string;
  href?: string;
  dedupeKey?: string;
  createdAt: number;
  updatedAt: number;
  read: boolean;
  occurrences: number;
};

export type ActivityInput = {
  tone?: ActivityTone;
  status?: ActivityStatus;
  title: string;
  message?: string;
  source?: string;
  href?: string;
  dedupeKey?: string;
  read?: boolean;
};

type ActivityState = {
  items: ActivityItem[];
  add: (input: ActivityInput) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  clear: () => void;
};

// Keep the existing key so moving activity into the workbench does not discard history.
const STORAGE_KEY = 'xopc.activity-center.v1';
const MAX_ITEMS = 80;

function statusForTone(tone: ActivityTone): ActivityStatus {
  if (tone === 'error') return 'failed';
  if (tone === 'warning') return 'attention';
  return 'done';
}

function currentHref(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const hash = window.location.hash.replace(/^#/, '');
  return hash || `${window.location.pathname}${window.location.search}` || undefined;
}

function loadItems(): ActivityItem[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: ActivityItem[] };
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items
      .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function persistItems(items: ActivityItem[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ items }));
  } catch {
    // Activity history is a convenience; storage failures must not block the product flow.
  }
}

function nextId(now: number): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useActivityStore = create<ActivityState>((set) => ({
  items: loadItems(),
  add: (input) =>
    set((state) => {
      const title = input.title.trim();
      if (!title) return state;
      const now = Date.now();
      const tone = input.tone ?? 'info';
      const existingIndex = input.dedupeKey
        ? state.items.findIndex((item) => item.dedupeKey === input.dedupeKey)
        : -1;
      const nextItem: ActivityItem = {
        id: existingIndex >= 0 ? state.items[existingIndex].id : nextId(now),
        tone,
        status: input.status ?? statusForTone(tone),
        title,
        message: input.message?.trim() || undefined,
        source: input.source?.trim() || undefined,
        href: input.href ?? currentHref(),
        dedupeKey: input.dedupeKey,
        createdAt: existingIndex >= 0 ? state.items[existingIndex].createdAt : now,
        updatedAt: now,
        read: input.read ?? false,
        occurrences: existingIndex >= 0 ? state.items[existingIndex].occurrences + 1 : 1,
      };
      const withoutExisting =
        existingIndex >= 0 ? state.items.filter((_, index) => index !== existingIndex) : state.items;
      const items = [nextItem, ...withoutExisting].slice(0, MAX_ITEMS);
      persistItems(items);
      return { items };
    }),
  markAllRead: () =>
    set((state) => {
      const items = state.items.map((item) => ({ ...item, read: true }));
      persistItems(items);
      return { items };
    }),
  remove: (id) =>
    set((state) => {
      const items = state.items.filter((item) => item.id !== id);
      persistItems(items);
      return { items };
    }),
  clearFinished: () =>
    set((state) => {
      const items = state.items.filter((item) => item.status !== 'done');
      persistItems(items);
      return { items };
    }),
  clear: () => {
    persistItems([]);
    set({ items: [] });
  },
}));

export function showActivity(input: ActivityInput): void {
  useActivityStore.getState().add(input);
}

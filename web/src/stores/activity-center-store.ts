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

type ActivityCenterState = {
  open: boolean;
  items: ActivityItem[];
  setOpen: (open: boolean) => void;
  add: (input: ActivityInput) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
};

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

export const useActivityCenterStore = create<ActivityCenterState>((set) => ({
  open: false,
  items: loadItems(),
  setOpen: (open) =>
    set((state) => {
      const items = open ? state.items.map((item) => ({ ...item, read: true })) : state.items;
      if (open) persistItems(items);
      return { open, items };
    }),
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
        read: input.read ?? state.open,
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
  clear: () => {
    persistItems([]);
    set({ items: [] });
  },
}));

export function showActivity(input: ActivityInput): void {
  useActivityCenterStore.getState().add(input);
}

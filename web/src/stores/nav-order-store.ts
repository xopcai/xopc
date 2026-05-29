import { create } from 'zustand';

const STORAGE_KEY = 'xopc-web-sidebar-nav-order';

function readOrder(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function writeOrder(order: string[]) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* ignore quota / private mode */
  }
}

export type MovePosition = 'before' | 'after';

export type NavOrderState = {
  order: string[];
  move: (fromId: string, toId: string, position: MovePosition) => void;
  moveToEnd: (id: string) => void;
  setOrder: (order: string[]) => void;
};

function applyMove(
  order: string[],
  fromId: string,
  toId: string,
  position: MovePosition,
  knownIds: ReadonlySet<string>,
): string[] {
  if (fromId === toId) return order;
  const filtered = order.filter((id) => id !== fromId);
  const targetIndex = filtered.indexOf(toId);
  const insertIndex = targetIndex === -1
    ? filtered.length
    : position === 'before' ? targetIndex : targetIndex + 1;
  const next = [...filtered.slice(0, insertIndex), fromId, ...filtered.slice(insertIndex)];
  return ensureAllKnown(next, knownIds);
}

function applyMoveToEnd(
  order: string[],
  id: string,
  knownIds: ReadonlySet<string>,
): string[] {
  const filtered = order.filter((existing) => existing !== id);
  return ensureAllKnown([...filtered, id], knownIds);
}

/** Seed any not-yet-tracked known ids onto the end so the persisted list is stable. */
function ensureAllKnown(order: string[], knownIds: ReadonlySet<string>): string[] {
  const present = new Set(order);
  const missing: string[] = [];
  for (const id of knownIds) {
    if (!present.has(id)) missing.push(id);
  }
  return missing.length === 0 ? order : [...order, ...missing];
}

export const useNavOrderStore = create<NavOrderState>((set, get) => ({
  order: readOrder(),
  move: (fromId, toId, position) => {
    const next = applyMove(get().order, fromId, toId, position, new Set(get().order));
    if (next === get().order) return;
    set({ order: next });
    queueMicrotask(() => writeOrder(next));
  },
  moveToEnd: (id) => {
    const next = applyMoveToEnd(get().order, id, new Set(get().order));
    if (next === get().order) return;
    set({ order: next });
    queueMicrotask(() => writeOrder(next));
  },
  setOrder: (order) => {
    set({ order });
    queueMicrotask(() => writeOrder(order));
  },
}));

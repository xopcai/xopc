import { create } from 'zustand';

const STORAGE_KEY = 'xopc-web-sidebar-nav-order';

function readOrder(): string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))] : [];
  } catch {
    return [];
  }
}

export const useNavOrderStore = create<{
  order: string[];
  setOrder: (order: string[]) => void;
}>((set) => ({
  order: readOrder(),
  setOrder: (order) => {
    const next = [...new Set(order)];
    set({ order: next });
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Keep sorting available when browser storage is unavailable.
    }
  },
}));

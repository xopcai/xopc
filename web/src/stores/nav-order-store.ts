import { create } from 'zustand';

const STORAGE_KEY = 'xopc-web-sidebar-nav-order';

function readOrder(): string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeOrder(order: string[]) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* Ignore unavailable storage and private-mode quota errors. */
  }
}

type NavOrderState = {
  order: string[];
  setOrder: (order: string[]) => void;
};

export const useNavOrderStore = create<NavOrderState>((set) => ({
  order: readOrder(),
  setOrder: (order) => {
    set({ order });
    queueMicrotask(() => writeOrder(order));
  },
}));

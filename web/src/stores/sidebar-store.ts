import { create } from 'zustand';

const STORAGE_KEY = 'xopcbot-web-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}

type SidebarState = {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
};

export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: readCollapsed(),
  setCollapsed: (collapsed) => {
    set({ collapsed });
    queueMicrotask(() => writeCollapsed(collapsed));
  },
  toggleCollapsed: () => {
    get().setCollapsed(!get().collapsed);
  },
}));

import { create } from 'zustand';

const STORAGE_KEY = 'xopc-web-sidebar-collapsed';
const WIDTH_STORAGE_KEY = 'xopc-web-sidebar-expanded-width-px';

/** Room for traffic-light inset + toggle + search + back/forward on Electron (sidebar chrome row). */
export const SIDEBAR_EXPANDED_WIDTH_MIN = 248;
export const SIDEBAR_EXPANDED_WIDTH_MAX = 480;
export const SIDEBAR_EXPANDED_WIDTH_DEFAULT = 256;

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

function clampExpandedWidthPx(px: number): number {
  return Math.min(
    SIDEBAR_EXPANDED_WIDTH_MAX,
    Math.max(SIDEBAR_EXPANDED_WIDTH_MIN, Math.round(px)),
  );
}

function readExpandedWidthPx(): number {
  try {
    const raw = globalThis.localStorage?.getItem(WIDTH_STORAGE_KEY);
    if (raw == null) return clampExpandedWidthPx(SIDEBAR_EXPANDED_WIDTH_DEFAULT);
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return clampExpandedWidthPx(SIDEBAR_EXPANDED_WIDTH_DEFAULT);
    return clampExpandedWidthPx(n);
  } catch {
    return clampExpandedWidthPx(SIDEBAR_EXPANDED_WIDTH_DEFAULT);
  }
}

function writeExpandedWidthPx(px: number) {
  try {
    globalThis.localStorage?.setItem(WIDTH_STORAGE_KEY, String(px));
  } catch {
    /* ignore quota / private mode */
  }
}

type SidebarState = {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  expandedWidthPx: number;
  setExpandedWidthPx: (px: number) => void;
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
  expandedWidthPx: readExpandedWidthPx(),
  setExpandedWidthPx: (px) => {
    const expandedWidthPx = clampExpandedWidthPx(px);
    set({ expandedWidthPx });
    queueMicrotask(() => writeExpandedWidthPx(expandedWidthPx));
  },
}));

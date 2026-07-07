import { create } from 'zustand';

const STORAGE_KEY = 'xopc-web-workspace-panel-open';
const WIDTH_STORAGE_KEY = 'xopc-web-workspace-panel-width-px';

export const WORKSPACE_PANEL_WIDTH_MIN = 200;
export const WORKSPACE_PANEL_WIDTH_MAX = 520;
export const WORKSPACE_PANEL_WIDTH_DEFAULT = 320;

function readOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}

export function clampWorkspacePanelWidthPx(px: number): number {
  return Math.min(
    WORKSPACE_PANEL_WIDTH_MAX,
    Math.max(WORKSPACE_PANEL_WIDTH_MIN, Math.round(px)),
  );
}

function readWidthPx(): number {
  try {
    const raw = globalThis.localStorage?.getItem(WIDTH_STORAGE_KEY);
    if (raw == null) return WORKSPACE_PANEL_WIDTH_DEFAULT;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return WORKSPACE_PANEL_WIDTH_DEFAULT;
    return clampWorkspacePanelWidthPx(n);
  } catch {
    return WORKSPACE_PANEL_WIDTH_DEFAULT;
  }
}

function writeWidthPx(px: number) {
  try {
    globalThis.localStorage?.setItem(WIDTH_STORAGE_KEY, String(px));
  } catch {
    /* ignore quota / private mode */
  }
}

type WorkspacePanelState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  widthPx: number;
  setWidthPx: (px: number) => void;
};

export const useWorkspacePanelStore = create<WorkspacePanelState>((set, get) => ({
  open: readOpen(),
  setOpen: (open) => {
    set({ open });
    queueMicrotask(() => writeOpen(open));
  },
  toggleOpen: () => {
    get().setOpen(!get().open);
  },
  widthPx: readWidthPx(),
  setWidthPx: (px) => {
    const widthPx = clampWorkspacePanelWidthPx(px);
    if (get().widthPx === widthPx) return;
    set({ widthPx });
    queueMicrotask(() => writeWidthPx(widthPx));
  },
}));

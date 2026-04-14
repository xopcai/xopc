import { create } from 'zustand';

const STORAGE_KEY = 'xopc-web-workspace-panel-open';

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

type WorkspacePanelState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
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
}));

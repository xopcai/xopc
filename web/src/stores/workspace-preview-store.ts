import { create } from 'zustand';

type WorkspacePreviewState = {
  path: string | null;
  line: number | null;
  setPath: (path: string | null, line?: number | null) => void;
};

export const useWorkspacePreviewStore = create<WorkspacePreviewState>((set) => ({
  path: null,
  line: null,
  setPath: (path, line) =>
    set({
      path,
      line: path && typeof line === 'number' && Number.isFinite(line) && line > 0 ? Math.floor(line) : null,
    }),
}));

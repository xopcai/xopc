import { create } from 'zustand';

type WorkspacePreviewState = {
  path: string | null;
  setPath: (path: string | null) => void;
};

export const useWorkspacePreviewStore = create<WorkspacePreviewState>((set) => ({
  path: null,
  setPath: (path) => set({ path }),
}));

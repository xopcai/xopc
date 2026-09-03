import { create } from 'zustand';

type WorkspacePreviewState = {
  path: string | null;
  line: number | null;
  projectId: string | null;
  sessionKey: string | null;
  setPath: (path: string | null, line?: number | null, projectId?: string | null, sessionKey?: string | null) => void;
};

export const useWorkspacePreviewStore = create<WorkspacePreviewState>((set) => ({
  path: null,
  line: null,
  projectId: null,
  sessionKey: null,
  setPath: (path, line, projectId, sessionKey) =>
    set({
      path,
      line: path && typeof line === 'number' && Number.isFinite(line) && line > 0 ? Math.floor(line) : null,
      projectId: path ? projectId?.trim() || null : null,
      sessionKey: path ? sessionKey?.trim() || null : null,
    }),
}));

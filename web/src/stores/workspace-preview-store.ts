import { create } from 'zustand';

type WorkspacePreviewState = {
  path: string | null;
  line: number | null;
  projectId: string | null;
  conversationId: string | null;
  setPath: (path: string | null, line?: number | null, projectId?: string | null, conversationId?: string | null) => void;
};

export const useWorkspacePreviewStore = create<WorkspacePreviewState>((set) => ({
  path: null,
  line: null,
  projectId: null,
  conversationId: null,
  setPath: (path, line, projectId, conversationId) =>
    set({
      path,
      line: path && typeof line === 'number' && Number.isFinite(line) && line > 0 ? Math.floor(line) : null,
      projectId: path ? projectId?.trim() || null : null,
      conversationId: path ? conversationId?.trim() || null : null,
    }),
}));

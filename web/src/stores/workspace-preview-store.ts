import { create } from 'zustand';

type WorkspacePreviewState = {
  path: string | null;
  resultRevision?: number;
  line: number | null;
  projectId: string | null;
  conversationId: string | null;
  setPath: (path: string | null, line?: number | null, projectId?: string | null, conversationId?: string | null, resultRevision?: number) => void;
};

export const useWorkspacePreviewStore = create<WorkspacePreviewState>((set) => ({
  path: null,
  line: null,
  projectId: null,
  conversationId: null,
  setPath: (path, line, projectId, conversationId, resultRevision) =>
    set({
      path,
      resultRevision: path ? resultRevision : undefined,
      line: path && typeof line === 'number' && Number.isFinite(line) && line > 0 ? Math.floor(line) : null,
      projectId: path ? projectId?.trim() || null : null,
      conversationId: path ? conversationId?.trim() || null : null,
    }),
}));

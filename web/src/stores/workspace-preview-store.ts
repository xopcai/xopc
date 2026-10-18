import { create } from 'zustand';

import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';

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
    {
      if (path) {
        const owner = useRightWorkspaceStore.getState().scope;
        useRightWorkspaceStore.getState().openFile({
          path, line, projectId: projectId || undefined,
          conversationId: conversationId || (owner !== 'new' ? owner : undefined),
          agentId: useWorkspaceEditorAgentStore.getState().agentId || undefined, resultRevision,
        });
      }
      set({
      path,
      resultRevision: path ? resultRevision : undefined,
      line: path && typeof line === 'number' && Number.isFinite(line) && line > 0 ? Math.floor(line) : null,
      projectId: path ? projectId?.trim() || null : null,
      conversationId: path ? conversationId?.trim() || null : null,
    });
    },
}));

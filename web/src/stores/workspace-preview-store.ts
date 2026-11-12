import { create } from 'zustand';

import { useRightWorkspaceStore, type FileTab } from '@/stores/right-workspace-store';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';
import type { FileReferencePreview } from '@/features/workspace/file-reference-preview';

type WorkspacePreviewState = {
  path: string | null;
  resultRevision?: number;
  line: number | null;
  projectId: string | null;
  conversationId: string | null;
  setPath: (path: string | null, line?: number | null, projectId?: string | null, conversationId?: string | null, resultRevision?: number,
    pending?: { id: string; scope: string; reference: FileReferencePreview; defaultWorkspace?: boolean; resolvedFile?: FileTab['resolvedFile'] }) => void;
};

export const useWorkspacePreviewStore = create<WorkspacePreviewState>((set) => ({
  path: null,
  line: null,
  projectId: null,
  conversationId: null,
  setPath: (path, line, projectId, conversationId, resultRevision, pending) =>
    {
      if (path) {
        const workspace = useRightWorkspaceStore.getState();
        const owner = pending?.scope ?? workspace.scope;
        const file = {
          path, line, projectId: projectId || undefined,
          conversationId: conversationId || (!pending?.defaultWorkspace && owner !== 'new' ? owner : undefined),
          agentId: !pending?.defaultWorkspace ? useWorkspaceEditorAgentStore.getState().agentId || undefined : undefined,
          resultRevision,
          resolvedFile: pending?.resolvedFile,
        };
        if (pending) {
          if (!workspace.finishFileReference(pending.id, owner, pending.reference, file) || owner !== workspace.scope) return;
        } else workspace.openFile(file);
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

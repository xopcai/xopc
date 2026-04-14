import { create } from 'zustand';

/**
 * Chat-selected agent id for workspace editor API (`/api/workspace/editor/*?agentId=`).
 * Empty when not on chat — server uses default agent workspace.
 */
type WorkspaceEditorAgentState = {
  agentId: string;
  setAgentId: (agentId: string) => void;
};

export const useWorkspaceEditorAgentStore = create<WorkspaceEditorAgentState>((set) => ({
  agentId: '',
  setAgentId: (agentId) => set({ agentId }),
}));

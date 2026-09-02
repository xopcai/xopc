import { create } from 'zustand';

/**
 * Chat-selected agent id for resolving the active managed file space.
 * Empty when not on chat.
 */
type WorkspaceEditorAgentState = {
  agentId: string;
  setAgentId: (agentId: string) => void;
};

export const useWorkspaceEditorAgentStore = create<WorkspaceEditorAgentState>((set) => ({
  agentId: '',
  setAgentId: (agentId) => set({ agentId }),
}));

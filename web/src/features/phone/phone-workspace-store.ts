import { create } from 'zustand';

export const usePhoneWorkspaceStore = create<{
  activation: number; open: boolean; selected: string | null; controlConversationId: string | null;
  displayMode: 'docked' | 'floating'; position: { x: number; y: number } | null;
  floatingWidth: number; setFloatingWidth: (width: number) => void;
  setDisplayMode: (mode: 'docked' | 'floating') => void;
  setPosition: (position: { x: number; y: number }) => void;
  show: (deviceOrSessionId?: string, activate?: boolean, controlConversationId?: string) => void;
  hide: () => void;
}>((set) => ({
  activation: 0, open: false, selected: null, controlConversationId: null,
  displayMode: 'docked', position: null, floatingWidth: 288,
  setFloatingWidth: floatingWidth => set({ floatingWidth }),
  setDisplayMode: displayMode => set({ displayMode }),
  setPosition: position => set(state => state.position?.x === position.x && state.position?.y === position.y ? state : { position }),
  show: (id, activate = true, controlConversationId) => set(state => ({
    activation: state.activation + (activate ? 1 : 0),
    selected: activate || !state.selected ? id ?? state.selected : state.selected, open: activate || state.open,
    controlConversationId: activate || !state.open ? controlConversationId ?? null : state.controlConversationId,
  })),
  hide: () => set({ open: false }),
}));

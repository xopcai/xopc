import { create } from 'zustand';

/** Shared only by the root chat composer and its tab dock. */
export const useChatChromeStore = create<{ actionPanelOpen: boolean; setActionPanelOpen: (open: boolean) => void }>(set => ({
  actionPanelOpen: false,
  setActionPanelOpen: actionPanelOpen => set({ actionPanelOpen }),
}));

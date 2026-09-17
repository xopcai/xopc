import { create } from 'zustand';

type ChatChromeState = {
  actionPanelOpen: boolean;
  setActionPanelOpen: (open: boolean) => void;
};

/** Shared only by the root chat composer and its tab dock. */
export const useChatChromeStore = create<ChatChromeState>(set => ({
  actionPanelOpen: false,
  setActionPanelOpen: actionPanelOpen => set({ actionPanelOpen }),
}));

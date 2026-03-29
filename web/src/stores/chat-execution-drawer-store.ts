import { create } from 'zustand';

type State = {
  open: boolean;
  /** Index into `messages[]` for the assistant message whose steps are shown. */
  focusedMessageIndex: number | null;
  setOpen: (open: boolean) => void;
  toggleForMessage: (index: number) => void;
  closeDrawer: () => void;
};

export const useChatExecutionDrawerStore = create<State>((set, get) => ({
  open: false,
  focusedMessageIndex: null,
  setOpen: (open) => set({ open }),
  toggleForMessage: (index) => {
    const { open, focusedMessageIndex } = get();
    if (open && focusedMessageIndex === index) {
      set({ open: false, focusedMessageIndex: null });
    } else {
      set({ open: true, focusedMessageIndex: index });
    }
  },
  closeDrawer: () => set({ open: false, focusedMessageIndex: null }),
}));

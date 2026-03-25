import { create } from 'zustand';

/** Mobile drawer open state (fixed overlay + backdrop). Desktop collapse uses `useSidebarStore`. */
type AppShellState = {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
};

export const useAppShellStore = create<AppShellState>((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
}));

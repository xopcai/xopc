import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Local UI preferences for developer-facing affordances. Currently a single
 * boolean: whether tool-call steps should reveal the raw JSON details panel
 * instead of (or in addition to) the structured cards.
 *
 * Persisted to localStorage; never crosses the gateway boundary.
 */
type DevViewState = {
  showRawToolData: boolean;
  setShowRawToolData: (value: boolean) => void;
};

export const useDevViewStore = create(
  persist<DevViewState>(
    (set) => ({
      showRawToolData: false,
      setShowRawToolData: (showRawToolData) => set({ showRawToolData }),
    }),
    {
      name: 'xopc-web-dev-view',
    },
  ),
);

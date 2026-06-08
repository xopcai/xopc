import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Settings shell navigation density — simple hides power-user rail items. */
export type SettingsMode = 'simple' | 'advanced';

type SettingsModeState = {
  mode: SettingsMode;
  setMode: (mode: SettingsMode) => void;
  setShowAdvanced: (show: boolean) => void;
};

export const useSettingsModeStore = create(
  persist<SettingsModeState>(
    (set) => ({
      mode: 'simple',
      setMode: (mode) => set({ mode }),
      setShowAdvanced: (show) => set({ mode: show ? 'advanced' : 'simple' }),
    }),
    {
      name: 'xopc-web-settings-mode',
    },
  ),
);

export function useShowAdvancedSettings(): boolean {
  return useSettingsModeStore((s) => s.mode === 'advanced');
}

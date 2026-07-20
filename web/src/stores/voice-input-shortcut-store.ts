import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { isMacPlatform, normalizeShortcut } from '@/stores/quick-capture-shortcut-store';

/** Application shortcut; Electron global capture can build on the same preference later. */
export function defaultVoiceInputShortcut(isMac = isMacPlatform()): string {
  return isMac ? 'meta+shift+m' : 'control+shift+m';
}

type VoiceInputShortcutState = {
  shortcut: string;
  setShortcut: (shortcut: string) => void;
};

export const useVoiceInputShortcutStore = create(
  persist<VoiceInputShortcutState>(
    (set) => ({
      shortcut: defaultVoiceInputShortcut(),
      setShortcut: (shortcut) => set({
        shortcut: normalizeShortcut(shortcut) || defaultVoiceInputShortcut(),
      }),
    }),
    {
      name: 'xopc-voice-input-shortcut',
      version: 1,
    },
  ),
);

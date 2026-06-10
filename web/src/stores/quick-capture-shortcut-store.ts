import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const DEFAULT_SHORTCUT = 'meta+.';

type QuickCaptureShortcutState = {
  shortcut: string;
  setShortcut: (shortcut: string) => void;
};

export const useQuickCaptureShortcutStore = create(
  persist<QuickCaptureShortcutState>(
    (set) => ({
      shortcut: DEFAULT_SHORTCUT,
      setShortcut: (shortcut) => set({ shortcut }),
    }),
    { name: 'xopc-quick-capture-shortcut' },
  ),
);

const KEY_ALIASES: Record<string, string> = {
  cmd: 'meta',
  command: 'meta',
  ctrl: 'control',
  ctl: 'control',
  opt: 'alt',
  option: 'alt',
};

function normalizeKey(k: string): string {
  const lower = k.toLowerCase().trim();
  return KEY_ALIASES[lower] ?? lower;
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+').map(normalizeKey);
  const modifiers = new Set(parts.filter((p) => ['meta', 'control', 'alt', 'shift'].includes(p)));
  const key = parts.find((p) => !modifiers.has(p));
  if (!key) return false;

  if (modifiers.has('meta') !== event.metaKey) return false;
  if (modifiers.has('control') !== event.ctrlKey) return false;
  if (modifiers.has('alt') !== event.altKey) return false;
  if (modifiers.has('shift') !== event.shiftKey) return false;

  return event.key.toLowerCase() === key || event.code.toLowerCase() === key;
}

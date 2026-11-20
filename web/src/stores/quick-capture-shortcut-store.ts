import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform?.includes('Mac') ?? navigator.userAgent.includes('Mac');
}

export function shortcutDisplayKeys(shortcut: string, isMac = isMacPlatform()): string[] {
  const platform = typeof window === 'undefined' ? undefined : window.electronAPI?.platform;
  return normalizeShortcut(shortcut).split('+').map((key) => {
    if (key === 'control') return 'Ctrl';
    if (key === 'meta') return isMac ? '⌘' : platform === 'linux' ? 'Super' : 'Win';
    if (key === 'alt') return isMac ? 'Option' : 'Alt';
    if (key === 'shift') return 'Shift';
    if (key === 'space') return 'Space';
    return key.length === 1 ? key.toUpperCase() : key;
  });
}

/** Keep the default aligned with the shortcut displayed in the settings UI. */
export function defaultQuickCaptureShortcut(isMac = isMacPlatform()): string {
  return isMac ? 'meta+.' : 'control+.';
}

export function normalizeShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map(normalizeKey)
    .filter(Boolean)
    .join('+');
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent, keyOverride = event.key): string | null {
  if (event.key === 'Escape') return null;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null;

  const key = event.key === ' ' ? 'space' : normalizeKey(keyOverride);
  if (!key) return null;

  const modifiers = [
    event.metaKey ? 'meta' : '',
    event.ctrlKey ? 'control' : '',
    event.altKey ? 'alt' : '',
    event.shiftKey ? 'shift' : '',
  ].filter(Boolean);

  return [...modifiers, key].join('+');
}

const PHYSICAL_PUNCTUATION: Readonly<Record<string, string>> = {
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
};

export function shortcutFromPhysicalKeyboardEvent(event: KeyboardEvent): string | null {
  const key = /^(?:Key|Digit)([A-Z0-9])$/.exec(event.code)?.[1] ?? PHYSICAL_PUNCTUATION[event.code];
  return shortcutFromKeyboardEvent(event, key);
}

type QuickCaptureShortcutState = {
  shortcut: string;
  setShortcut: (shortcut: string) => void;
};

export const useQuickCaptureShortcutStore = create(
  persist<QuickCaptureShortcutState>(
    (set) => ({
      shortcut: defaultQuickCaptureShortcut(),
      setShortcut: (shortcut) => set({ shortcut: normalizeShortcut(shortcut) || defaultQuickCaptureShortcut() }),
    }),
    {
      name: 'xopc-quick-capture-shortcut',
      version: 2,

    },
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
  const parts = normalizeShortcut(shortcut).split('+');
  const modifiers = new Set(parts.filter((p) => ['meta', 'control', 'alt', 'shift'].includes(p)));
  const key = parts.find((p) => !modifiers.has(p));
  if (!key) return false;

  if (modifiers.has('meta') !== event.metaKey) return false;
  if (modifiers.has('control') !== event.ctrlKey) return false;
  if (modifiers.has('alt') !== event.altKey) return false;
  if (modifiers.has('shift') !== event.shiftKey) return false;

  return event.key.toLowerCase() === key || event.code.toLowerCase() === key;
}

import type { Keybinding, KeybindingsManager } from '@earendil-works/pi-tui';

import { XOPC_TUI_HOTKEY_ORDER } from './xopc-tui-keybindings.js';
import { getTuiKeybindingsPath } from './tui-keybindings-file.js';
import { theme } from './theme.js';

export type KeyTextFormatOptions = {
  capitalize?: boolean;
};

export function formatKeyText(key: string, options: KeyTextFormatOptions = {}): string {
  return key
    .split('/')
    .map((part) =>
      part
        .split('+')
        .map((keyPart) => {
          const display =
            process.platform === 'darwin' && keyPart.toLowerCase() === 'alt' ? 'option' : keyPart;
          return options.capitalize ? display.charAt(0).toUpperCase() + display.slice(1) : display;
        })
        .join('+'),
    )
    .join('/');
}

export function formatKeyIds(
  manager: KeybindingsManager,
  id: Keybinding,
  options: KeyTextFormatOptions = {},
): string {
  const keys = manager.getKeys(id);
  if (keys.length === 0) return '(not bound)';
  return keys.map((key) => formatKeyText(key, options)).join(' · ');
}

export function keyHint(manager: KeybindingsManager, id: Keybinding, description: string): string {
  return `${theme.dim(formatKeyIds(manager, id))} ${theme.dim(description)}`;
}

export interface TuiHotkeyExtensionShortcut {
  key: string;
  description?: string;
}

/** Human-readable shortcut list for `/hotkeys` (resolved keys, pi-style). */
export function formatXopcTuiHotkeys(
  manager: KeybindingsManager,
  extensionShortcuts: TuiHotkeyExtensionShortcut[] = [],
): string {
  const lines: string[] = ['Keyboard shortcuts (resolved):'];
  for (const id of XOPC_TUI_HOTKEY_ORDER) {
    const def = manager.getDefinition(id);
    const desc = def.description ?? id;
    lines.push(`  ${formatKeyIds(manager, id)} — ${desc}`);
  }
  if (extensionShortcuts.length > 0) {
    lines.push('', 'Extensions:');
    for (const shortcut of extensionShortcuts) {
      const key = formatKeyText(shortcut.key, { capitalize: true });
      lines.push(`  ${key} — ${shortcut.description?.trim() || 'Extension shortcut'}`);
    }
  }
  lines.push('', `Customize in ${getTuiKeybindingsPath()} (/reload to apply).`);
  return lines.join('\n');
}

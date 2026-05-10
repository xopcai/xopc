import type { KeybindingsManager } from '@earendil-works/pi-tui';

import { XOPC_TUI_HOTKEY_ORDER, type XopcTuiAppKeybinding } from './xopc-tui-keybindings.js';

function formatKeyIds(manager: KeybindingsManager, id: XopcTuiAppKeybinding): string {
  const keys = manager.getKeys(id);
  if (keys.length === 0) return '(not bound)';
  return keys.join(' · ');
}

/** Human-readable shortcut list for `/hotkeys` (resolved keys, pi-style). */
export function formatXopcTuiHotkeys(manager: KeybindingsManager): string {
  const lines: string[] = ['Keyboard shortcuts (resolved):'];
  for (const id of XOPC_TUI_HOTKEY_ORDER) {
    const def = manager.getDefinition(id);
    const desc = def.description ?? id;
    lines.push(`  ${formatKeyIds(manager, id)} — ${desc}`);
  }
  return lines.join('\n');
}

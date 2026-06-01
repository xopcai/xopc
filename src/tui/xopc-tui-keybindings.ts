import {
  TUI_KEYBINDINGS,
  type KeybindingDefinitions,
} from '@earendil-works/pi-tui';

// Re-export removed — `./tui-keybindings-file.js` imports `XOPC_TUI_KEYBINDINGS`
// from this file, so re-exporting from it created a circular cycle. Callers
// (tui.ts, test files) import the manager directly from `./tui-keybindings-file.js`.

/** App-level bindings wired by xopc TUI (subset of pi coding-agent). */
export type XopcTuiAppKeybinding =
  | 'app.interrupt'
  | 'app.clear'
  | 'app.exit'
  | 'app.suspend'
  | 'app.thinking.cycle'
  | 'app.model.cycleForward'
  | 'app.model.cycleBackward'
  | 'app.model.select'
  | 'app.tools.expand'
  | 'app.thinking.toggle'
  | 'app.session.resume'
  | 'app.editor.external'
  | 'app.clipboard.pasteImage'
  | 'app.message.followUp'
  | 'app.message.dequeue';

declare module '@earendil-works/pi-tui' {
  interface Keybindings {
    'app.interrupt': true;
    'app.clear': true;
    'app.exit': true;
    'app.suspend': true;
    'app.thinking.cycle': true;
    'app.model.cycleForward': true;
    'app.model.cycleBackward': true;
    'app.model.select': true;
    'app.tools.expand': true;
    'app.thinking.toggle': true;
    'app.session.resume': true;
    'app.editor.external': true;
    'app.clipboard.pasteImage': true;
    'app.message.followUp': true;
    'app.message.dequeue': true;
  }
}

export const XOPC_TUI_KEYBINDINGS = {
  ...TUI_KEYBINDINGS,
  'app.interrupt': { defaultKeys: 'escape', description: 'Abort run (or cancel overlay)' },
  'app.clear': { defaultKeys: 'ctrl+c', description: 'Clear input; repeat within 0.5s to exit' },
  'app.exit': { defaultKeys: 'ctrl+d', description: 'Exit when input empty' },
  'app.suspend': {
    defaultKeys: process.platform === 'win32' ? [] : 'ctrl+z',
    description: 'Suspend to shell (SIGTSTP)',
  },
  'app.thinking.cycle': {
    defaultKeys: 'shift+tab',
    description: 'Cycle /think level',
  },
  'app.model.cycleForward': {
    defaultKeys: 'ctrl+p',
    description: 'Next model (/switch)',
  },
  'app.model.cycleBackward': {
    defaultKeys: 'shift+ctrl+p',
    description: 'Previous model (/switch)',
  },
  'app.model.select': { defaultKeys: 'ctrl+l', description: 'Model picker' },
  'app.tools.expand': { defaultKeys: 'ctrl+o', description: 'Toggle tool output' },
  'app.thinking.toggle': {
    defaultKeys: 'ctrl+t',
    description: 'Toggle thinking block display',
  },
  'app.session.resume': {
    defaultKeys: 'ctrl+shift+p',
    description: 'Session picker',
  },
  'app.editor.external': {
    defaultKeys: 'ctrl+g',
    description: 'Edit input in $EDITOR',
  },
  'app.clipboard.pasteImage': {
    defaultKeys: process.platform === 'win32' ? 'alt+v' : 'ctrl+v',
    description: 'Paste image from clipboard (placeholder)',
  },
  'app.message.followUp': {
    defaultKeys: 'alt+enter',
    description: 'Queue message while busy (or submit when idle)',
  },
  'app.message.dequeue': {
    defaultKeys: 'alt+up',
    description: 'Restore queued messages to editor',
  },
} as const satisfies KeybindingDefinitions;

/** Order for `/hotkeys` and docs (pi-style UX). */
export const XOPC_TUI_HOTKEY_ORDER: XopcTuiAppKeybinding[] = [
  'app.interrupt',
  'app.clear',
  'app.exit',
  'app.suspend',
  'app.thinking.cycle',
  'app.model.cycleForward',
  'app.model.cycleBackward',
  'app.model.select',
  'app.session.resume',
  'app.tools.expand',
  'app.thinking.toggle',
  'app.editor.external',
  'app.clipboard.pasteImage',
  'app.message.followUp',
  'app.message.dequeue',
];

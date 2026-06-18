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
  | 'app.session.tree'
  | 'app.session.fork'
  | 'app.session.togglePath'
  | 'app.session.toggleSort'
  | 'app.session.toggleNamedFilter'
  | 'app.session.rename'
  | 'app.session.delete'
  | 'app.session.deleteNoninvasive'
  | 'app.tree.foldOrUp'
  | 'app.tree.unfoldOrDown'
  | 'app.tree.filter.default'
  | 'app.tree.filter.noTools'
  | 'app.tree.filter.userOnly'
  | 'app.tree.filter.labeledOnly'
  | 'app.tree.filter.all'
  | 'app.tree.filter.cycleForward'
  | 'app.tree.filter.cycleBackward'
  | 'app.tree.editLabel'
  | 'app.tree.toggleLabelTimestamp'
  | 'app.editor.external'
  | 'app.clipboard.pasteImage'
  | 'app.message.followUp'
  | 'app.message.dequeue'
  | 'app.models.save'
  | 'app.models.enableAll'
  | 'app.models.clearAll'
  | 'app.models.toggleProvider'
  | 'app.models.reorderUp'
  | 'app.models.reorderDown';

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
    'app.session.tree': true;
    'app.session.fork': true;
    'app.session.togglePath': true;
    'app.session.toggleSort': true;
    'app.session.toggleNamedFilter': true;
    'app.session.rename': true;
    'app.session.delete': true;
    'app.session.deleteNoninvasive': true;
    'app.tree.foldOrUp': true;
    'app.tree.unfoldOrDown': true;
    'app.tree.filter.default': true;
    'app.tree.filter.noTools': true;
    'app.tree.filter.userOnly': true;
    'app.tree.filter.labeledOnly': true;
    'app.tree.filter.all': true;
    'app.tree.filter.cycleForward': true;
    'app.tree.filter.cycleBackward': true;
    'app.tree.editLabel': true;
    'app.tree.toggleLabelTimestamp': true;
    'app.editor.external': true;
    'app.clipboard.pasteImage': true;
    'app.message.followUp': true;
    'app.message.dequeue': true;
    'app.models.save': true;
    'app.models.enableAll': true;
    'app.models.clearAll': true;
    'app.models.toggleProvider': true;
    'app.models.reorderUp': true;
    'app.models.reorderDown': true;
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
  'app.session.tree': {
    defaultKeys: [],
    description: 'Show session tree',
  },
  'app.session.fork': {
    defaultKeys: [],
    description: 'Fork current session',
  },
  'app.session.togglePath': {
    defaultKeys: 'ctrl+p',
    description: 'Toggle session key display',
  },
  'app.session.toggleSort': {
    defaultKeys: 'ctrl+s',
    description: 'Toggle session sort mode',
  },
  'app.session.toggleNamedFilter': {
    defaultKeys: 'ctrl+n',
    description: 'Toggle named session filter',
  },
  'app.session.rename': {
    defaultKeys: 'ctrl+r',
    description: 'Rename selected session',
  },
  'app.session.delete': {
    defaultKeys: 'ctrl+d',
    description: 'Delete selected session',
  },
  'app.session.deleteNoninvasive': {
    defaultKeys: 'ctrl+backspace',
    description: 'Delete session when query is empty',
  },
  'app.tree.foldOrUp': {
    defaultKeys: ['ctrl+left', 'alt+left'],
    description: 'Fold tree branch or move up',
  },
  'app.tree.unfoldOrDown': {
    defaultKeys: ['ctrl+right', 'alt+right'],
    description: 'Unfold tree branch or move down',
  },
  'app.tree.filter.default': {
    defaultKeys: 'ctrl+d',
    description: 'Tree filter: default view',
  },
  'app.tree.filter.noTools': {
    defaultKeys: 'ctrl+t',
    description: 'Tree filter: hide tool results',
  },
  'app.tree.filter.userOnly': {
    defaultKeys: 'ctrl+u',
    description: 'Tree filter: user messages only',
  },
  'app.tree.filter.labeledOnly': {
    defaultKeys: 'ctrl+l',
    description: 'Tree filter: labeled entries only',
  },
  'app.tree.filter.all': {
    defaultKeys: 'ctrl+a',
    description: 'Tree filter: show all entries',
  },
  'app.tree.filter.cycleForward': {
    defaultKeys: 'ctrl+o',
    description: 'Tree filter: cycle forward',
  },
  'app.tree.filter.cycleBackward': {
    defaultKeys: 'shift+ctrl+o',
    description: 'Tree filter: cycle backward',
  },
  'app.tree.editLabel': {
    defaultKeys: 'shift+l',
    description: 'Edit tree label',
  },
  'app.tree.toggleLabelTimestamp': {
    defaultKeys: 'shift+t',
    description: 'Toggle tree label timestamps',
  },
  'app.editor.external': {
    defaultKeys: 'ctrl+g',
    description: 'Edit input in $EDITOR',
  },
  'app.clipboard.pasteImage': {
    defaultKeys: process.platform === 'win32' ? 'alt+v' : 'ctrl+v',
    description: 'Paste image from clipboard',
  },
  'app.message.followUp': {
    defaultKeys: 'alt+enter',
    description: 'Queue message while busy (or submit when idle)',
  },
  'app.message.dequeue': {
    defaultKeys: 'alt+up',
    description: 'Restore queued messages to editor',
  },
  'app.models.save': {
    defaultKeys: 'ctrl+s',
    description: 'Save scoped model selection',
  },
  'app.models.enableAll': {
    defaultKeys: 'ctrl+a',
    description: 'Enable all scoped models',
  },
  'app.models.clearAll': {
    defaultKeys: 'ctrl+x',
    description: 'Clear scoped models',
  },
  'app.models.toggleProvider': {
    defaultKeys: 'ctrl+p',
    description: 'Toggle selected provider models',
  },
  'app.models.reorderUp': {
    defaultKeys: 'alt+up',
    description: 'Move scoped model up',
  },
  'app.models.reorderDown': {
    defaultKeys: 'alt+down',
    description: 'Move scoped model down',
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
  'app.session.tree',
  'app.session.fork',
  'app.session.togglePath',
  'app.session.toggleSort',
  'app.session.toggleNamedFilter',
  'app.session.rename',
  'app.session.delete',
  'app.session.deleteNoninvasive',
  'app.tree.foldOrUp',
  'app.tree.unfoldOrDown',
  'app.tree.filter.default',
  'app.tree.filter.noTools',
  'app.tree.filter.userOnly',
  'app.tree.filter.labeledOnly',
  'app.tree.filter.all',
  'app.tree.filter.cycleForward',
  'app.tree.filter.cycleBackward',
  'app.tree.editLabel',
  'app.tree.toggleLabelTimestamp',
  'app.tools.expand',
  'app.thinking.toggle',
  'app.editor.external',
  'app.clipboard.pasteImage',
  'app.message.followUp',
  'app.message.dequeue',
  'app.models.save',
  'app.models.enableAll',
  'app.models.clearAll',
  'app.models.toggleProvider',
  'app.models.reorderUp',
  'app.models.reorderDown',
];

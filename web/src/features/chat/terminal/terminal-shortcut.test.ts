import { describe, expect, it } from 'vitest';

import { matchesTerminalShortcut, terminalShortcutLabel } from './terminal-shortcut';

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    key: 'j',
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  };
}

describe('terminal shortcut', () => {
  it('uses Cmd+J on macOS', () => {
    expect(terminalShortcutLabel('darwin')).toBe('⌘J');
    expect(matchesTerminalShortcut(keyboardEvent({ metaKey: true }), 'darwin')).toBe(true);
    expect(matchesTerminalShortcut(keyboardEvent({ ctrlKey: true }), 'darwin')).toBe(false);
  });

  it.each(['win32', 'linux'])('uses Ctrl+J on %s', (platform) => {
    expect(terminalShortcutLabel(platform)).toBe('Ctrl+J');
    expect(matchesTerminalShortcut(keyboardEvent({ ctrlKey: true, key: 'J' }), platform)).toBe(true);
    expect(matchesTerminalShortcut(keyboardEvent({ metaKey: true }), platform)).toBe(false);
  });

  it('rejects the removed Ctrl+backtick shortcut and modified or repeated keys', () => {
    expect(matchesTerminalShortcut(keyboardEvent({ ctrlKey: true, key: '`' }), 'linux')).toBe(false);
    expect(matchesTerminalShortcut(keyboardEvent({ ctrlKey: true, shiftKey: true }), 'linux')).toBe(false);
    expect(matchesTerminalShortcut(keyboardEvent({ ctrlKey: true, repeat: true }), 'linux')).toBe(false);
  });
});

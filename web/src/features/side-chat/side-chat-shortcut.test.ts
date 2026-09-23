import { describe, expect, it } from 'vitest';

import {
  matchesSideChatShortcut,
  sideChatAriaKeyShortcut,
  sideChatShortcutKeys,
  sideChatShortcutLabel,
} from './side-chat-shortcut';

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    key: 'b',
    metaKey: false,
    repeat: false,
    shiftKey: true,
    ...overrides,
  } as KeyboardEvent;
}

describe('side chat shortcut', () => {
  it('uses Command+Shift+B on macOS', () => {
    expect(sideChatShortcutLabel('darwin')).toBe('⌘⇧B');
    expect(sideChatShortcutKeys('darwin')).toEqual(['⌘', 'Shift', 'B']);
    expect(sideChatAriaKeyShortcut('darwin')).toBe('Meta+Shift+B');
    expect(matchesSideChatShortcut(keyboardEvent({ metaKey: true }), 'darwin')).toBe(true);
    expect(matchesSideChatShortcut(keyboardEvent({ ctrlKey: true }), 'darwin')).toBe(false);
  });

  it.each(['win32', 'linux'])('uses Ctrl+Shift+B on %s', (platform) => {
    expect(sideChatShortcutLabel(platform)).toBe('Ctrl+Shift+B');
    expect(sideChatShortcutKeys(platform)).toEqual(['Ctrl', 'Shift', 'B']);
    expect(sideChatAriaKeyShortcut(platform)).toBe('Control+Shift+B');
    expect(matchesSideChatShortcut(keyboardEvent({ ctrlKey: true }), platform)).toBe(true);
    expect(matchesSideChatShortcut(keyboardEvent({ metaKey: true }), platform)).toBe(false);
  });

  it('rejects partial, alternate, and repeated shortcuts', () => {
    expect(matchesSideChatShortcut(keyboardEvent({ ctrlKey: true, shiftKey: false }), 'linux')).toBe(false);
    expect(matchesSideChatShortcut(keyboardEvent({ altKey: true, ctrlKey: true }), 'linux')).toBe(false);
    expect(matchesSideChatShortcut(keyboardEvent({ ctrlKey: true, repeat: true }), 'linux')).toBe(false);
  });
});

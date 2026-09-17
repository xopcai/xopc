import { describe, expect, it } from 'vitest';

import {
  matchesSideChatShortcut,
  sideChatAriaKeyShortcut,
  sideChatShortcutKeys,
  sideChatShortcutLabel,
} from './side-chat-shortcut';

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    altKey: true,
    ctrlKey: false,
    key: 'b',
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('side chat shortcut', () => {
  it('uses Option+Command+B on macOS', () => {
    expect(sideChatShortcutLabel('darwin')).toBe('⌥⌘B');
    expect(sideChatShortcutKeys('darwin')).toEqual(['⌥', '⌘', 'B']);
    expect(sideChatAriaKeyShortcut('darwin')).toBe('Alt+Meta+B');
    expect(matchesSideChatShortcut(keyboardEvent({ metaKey: true }), 'darwin')).toBe(true);
    expect(matchesSideChatShortcut(keyboardEvent({ ctrlKey: true }), 'darwin')).toBe(false);
  });

  it.each(['win32', 'linux'])('uses Ctrl+Alt+B on %s', (platform) => {
    expect(sideChatShortcutLabel(platform)).toBe('Ctrl+Alt+B');
    expect(sideChatShortcutKeys(platform)).toEqual(['Ctrl', 'Alt', 'B']);
    expect(sideChatAriaKeyShortcut(platform)).toBe('Control+Alt+B');
    expect(matchesSideChatShortcut(keyboardEvent({ ctrlKey: true }), platform)).toBe(true);
    expect(matchesSideChatShortcut(keyboardEvent({ metaKey: true }), platform)).toBe(false);
  });

  it('rejects partial, shifted, and repeated shortcuts', () => {
    expect(matchesSideChatShortcut(keyboardEvent({ altKey: false, ctrlKey: true }), 'linux')).toBe(false);
    expect(matchesSideChatShortcut(keyboardEvent({ ctrlKey: true, shiftKey: true }), 'linux')).toBe(false);
    expect(matchesSideChatShortcut(keyboardEvent({ ctrlKey: true, repeat: true }), 'linux')).toBe(false);
  });
});

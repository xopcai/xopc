import { describe, expect, it } from 'vitest';

import {
  defaultQuickCaptureShortcut,
  matchesShortcut,
  shortcutFromKeyboardEvent,
} from './quick-capture-shortcut-store';

function keyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    code: '',
    ctrlKey: false,
    key: '',
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('quick capture shortcut helpers', () => {
  it('uses Ctrl+. on Windows/Linux and Cmd+. on macOS', () => {
    expect(defaultQuickCaptureShortcut(false)).toBe('control+.');
    expect(defaultQuickCaptureShortcut(true)).toBe('meta+.');
  });

  it('captures a modifier chord and ignores modifier-only keys', () => {
    expect(shortcutFromKeyboardEvent(keyboardEvent({ ctrlKey: true, key: '.' }))).toBe('control+.');
    expect(shortcutFromKeyboardEvent(keyboardEvent({ metaKey: true, key: 'k' }))).toBe('meta+k');
    expect(shortcutFromKeyboardEvent(keyboardEvent({ ctrlKey: true, key: 'Control' }))).toBeNull();
  });

  it('matches the configured chord exactly', () => {
    expect(matchesShortcut(keyboardEvent({ ctrlKey: true, key: '.' }), 'control+.')).toBe(true);
    expect(matchesShortcut(keyboardEvent({ ctrlKey: true, shiftKey: true, key: '.' }), 'control+.')).toBe(false);
    expect(matchesShortcut(keyboardEvent({ metaKey: true, key: '.' }), 'control+.')).toBe(false);
  });
});

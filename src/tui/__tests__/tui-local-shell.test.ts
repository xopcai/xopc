import { describe, expect, it } from 'vitest';

import { XopcKeybindingsManager } from '../tui-keybindings-file.js';
import { formatLocalShellConsentHint } from '../tui-local-shell.js';

describe('local shell prompt hints', () => {
  it('uses resolved select keybindings in the consent prompt', () => {
    const keybindings = new XopcKeybindingsManager({
      'tui.select.confirm': 'x',
      'tui.select.cancel': 'z',
    });

    expect(formatLocalShellConsentHint(keybindings)).toBe('↑/↓ + X to choose, Z to cancel.');
  });

  it('keeps the default hint when no keybindings manager is provided', () => {
    expect(formatLocalShellConsentHint()).toBe('↑/↓ + Enter to choose, Esc to cancel.');
  });
});

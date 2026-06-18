import { describe, expect, it } from 'vitest';

import { XopcKeybindingsManager } from '../tui-keybindings-file.js';
import {
  formatBusyResponseHint,
  formatSteerUnavailableHint,
  formatSuspendUnsupportedHint,
} from '../tui-runtime-hints.js';

describe('tui runtime key hints', () => {
  it('uses resolved keybindings in busy and steering guidance', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.interrupt': 'x',
      'app.message.followUp': 'f',
      'app.suspend': 'z',
    });

    expect(formatBusyResponseHint(keybindings)).toContain('F to queue');
    expect(formatBusyResponseHint(keybindings)).toContain('X to abort');
    expect(formatSteerUnavailableHint(keybindings)).toContain('Press X to abort');
    expect(formatSteerUnavailableHint(keybindings)).toContain('F to queue a follow-up');
    expect(formatSuspendUnsupportedHint(keybindings)).toBe('Suspend (Z) is not supported on Windows.');
  });
});

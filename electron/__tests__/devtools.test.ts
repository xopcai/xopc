import { describe, expect, it } from 'vitest';

import {
  devToolsGlobalShortcutAccelerator,
  shouldAutoOpenDevTools,
} from '../devtools-flags.js';

describe('shouldAutoOpenDevTools', () => {
  it('returns true for --devtools argv', () => {
    expect(shouldAutoOpenDevTools(['xopc.exe', '--devtools'], {})).toBe(true);
  });

  it('returns true when XOPC_ELECTRON_DEVTOOLS=1', () => {
    expect(shouldAutoOpenDevTools(['xopc.exe'], { XOPC_ELECTRON_DEVTOOLS: '1' })).toBe(true);
  });

  it('returns false by default', () => {
    expect(shouldAutoOpenDevTools(['xopc.exe'], {})).toBe(false);
  });
});

describe('devToolsGlobalShortcutAccelerator', () => {
  it('uses Control+Shift+Alt+I on Windows', () => {
    expect(devToolsGlobalShortcutAccelerator('win32')).toBe('Control+Shift+Alt+I');
  });
});

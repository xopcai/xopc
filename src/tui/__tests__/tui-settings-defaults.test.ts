import { describe, expect, it } from 'vitest';

import { DEFAULT_TUI_SETTINGS } from '../tui-settings.js';

describe('tui settings defaults', () => {
  it('includes startup hints default', () => {
    expect(DEFAULT_TUI_SETTINGS.showStartupHints).toBe(true);
  });

  it('includes inline image defaults', () => {
    expect(DEFAULT_TUI_SETTINGS.showImages).toBe(true);
    expect(DEFAULT_TUI_SETTINGS.imageWidthCells).toBe(60);
  });

  it('includes autocomplete menu sizing default', () => {
    expect(DEFAULT_TUI_SETTINGS.autocompleteMaxVisible).toBe(5);
  });

  it('includes pi-style terminal and editor rendering defaults', () => {
    expect(DEFAULT_TUI_SETTINGS.showHardwareCursor).toBe(false);
    expect(DEFAULT_TUI_SETTINGS.editorPaddingX).toBe(0);
    expect(DEFAULT_TUI_SETTINGS.clearOnShrink).toBe(false);
  });
});

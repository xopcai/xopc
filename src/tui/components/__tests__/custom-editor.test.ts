import { TuiMainScreen, type Terminal } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vitest';

import { XopcKeybindingsManager } from '../../tui-keybindings-file.js';
import { editorTheme } from '../../theme.js';
import { CustomEditor } from '../custom-editor.js';

function createTerminal(): Terminal {
  return {
    columns: 80,
    rows: 24,
    kittyProtocolActive: false,
    start: vi.fn(),
    stop: vi.fn(),
    drainInput: vi.fn(async () => undefined),
    write: vi.fn(),
    moveBy: vi.fn(),
    hideCursor: vi.fn(),
    showCursor: vi.fn(),
    clearLine: vi.fn(),
    clearFromCursor: vi.fn(),
    clearScreen: vi.fn(),
    setTitle: vi.fn(),
    setProgress: vi.fn(),
  };
}

describe('CustomEditor queued input shortcuts', () => {
  it('dispatches terminal up and ctrl+x to their configured actions', () => {
    const tui = new TuiMainScreen(createTerminal());
    const editor = new CustomEditor(
      tui,
      editorTheme,
      new XopcKeybindingsManager({}, '/tmp/keybindings.json'),
    );
    const edit = vi.fn(() => true);
    const remove = vi.fn(() => true);
    editor.onAction('app.message.editQueued', edit);
    editor.onAction('app.message.deleteQueued', remove);

    editor.handleInput('\x1b[A');
    editor.handleInput('\x18');

    expect(edit).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
});

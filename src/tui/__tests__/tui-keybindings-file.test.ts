import { describe, expect, it } from 'vitest';

import { loadTuiKeybindingsConfig } from '../tui-keybindings-file.js';
import { XOPC_TUI_KEYBINDINGS } from '../xopc-tui-keybindings.js';

describe('keybindings file', () => {
  it('returns empty config for missing file', () => {
    expect(loadTuiKeybindingsConfig('/nonexistent/path.json')).toEqual({});
  });

  it('uses the Codex-style input and transcript bindings without legacy aliases', () => {
    expect(XOPC_TUI_KEYBINDINGS['app.message.followUp'].defaultKeys).toBe('tab');
    expect(XOPC_TUI_KEYBINDINGS['app.message.editQueued'].defaultKeys).toBe('up');
    expect(XOPC_TUI_KEYBINDINGS['app.message.deleteQueued'].defaultKeys).toBe('ctrl+x');
    expect(XOPC_TUI_KEYBINDINGS['app.transcript.open'].defaultKeys).toBe('ctrl+t');
    expect(XOPC_TUI_KEYBINDINGS['app.transcript.raw'].defaultKeys).toBe('alt+r');
    expect(XOPC_TUI_KEYBINDINGS['app.thinking.toggle'].defaultKeys).toEqual([]);
  });
});

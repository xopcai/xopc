import { describe, expect, it } from 'vitest';

import { loadTuiKeybindingsConfig } from '../tui-keybindings-file.js';

describe('keybindings file', () => {
  it('returns empty config for missing file', () => {
    expect(loadTuiKeybindingsConfig('/nonexistent/path.json')).toEqual({});
  });
});

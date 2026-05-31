import { describe, expect, it } from 'vitest';

import { formatXopcTuiHotkeys } from '../format-tui-hotkeys.js';
import { createXopcTuiKeybindingsManager } from '../tui-keybindings-file.js';

describe('formatXopcTuiHotkeys', () => {
  it('includes model cycle and session picker descriptions', () => {
    const km = createXopcTuiKeybindingsManager();
    const text = formatXopcTuiHotkeys(km);
    expect(text).toContain('Next model');
    expect(text).toContain('Session picker');
    expect(text).toContain('Queue message');
    expect(text).toContain('Restore queued');
  });
});

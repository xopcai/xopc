import { describe, expect, it, vi } from 'vitest';

import { XopcKeybindingsManager } from '../../tui-keybindings-file.js';
import { TranscriptOverlay } from '../transcript-overlay.js';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('TranscriptOverlay', () => {
  it('loads the latest SQLite window and pages toward older rows', async () => {
    const loadWindow = vi.fn(async (rowNumber: number) => rowNumber === Number.MAX_SAFE_INTEGER
      ? { messages: [{ id: 'new', role: 'user' as const, content: 'newest' }], startRowNumber: 50, endRowNumber: 50, totalRows: 50 }
      : { messages: [{ id: 'old', role: 'user' as const, content: 'older' }], startRowNumber: 1, endRowNumber: 49, totalRows: 50 });
    const overlay = new TranscriptOverlay({
      keybindings: new XopcKeybindingsManager(),
      loadWindow,
      onClose: vi.fn(),
      onRender: vi.fn(),
      viewportRows: () => 20,
    });

    await overlay.initialize();
    expect(stripAnsi(overlay.render(100).join('\n'))).toContain('newest');
    overlay.handleInput('\x1b[5~');
    await vi.waitFor(() => expect(loadWindow).toHaveBeenCalledTimes(2));
    const rendered = stripAnsi(overlay.render(100).join('\n'));
    expect(rendered).toContain('older');
    expect(rendered).toContain('rows 1-50');
  });
});

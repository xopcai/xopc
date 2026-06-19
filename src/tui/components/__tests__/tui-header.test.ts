import { describe, expect, it } from 'vitest';

import { XopcKeybindingsManager } from '../../tui-keybindings-file.js';
import { TuiHeader } from '../tui-header.js';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('TuiHeader', () => {
  it('renders startup hints with resolved app keybindings', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.interrupt': 'x',
      'app.clear': 'm',
      'app.exit': 'f',
      'app.tools.expand': 'o',
    });
    const header = new TuiHeader(
      () => ({
        version: 'test',
        connectionLabel: 'local',
        sessionKey: 'agent:main:main',
        showHints: true,
      }),
      keybindings,
    );

    const rendered = stripAnsi(header.render(160).join('\n'));
    expect(rendered).toContain('x interrupt');
    expect(rendered).toContain('m/f clear/exit');
    expect(rendered).toContain('o tools');
    expect(rendered).toContain('Press /start to show full startup help and loaded resources.');
  });
});

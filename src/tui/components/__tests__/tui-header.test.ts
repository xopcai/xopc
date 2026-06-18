import { describe, expect, it } from 'vitest';

import { XopcKeybindingsManager } from '../../tui-keybindings-file.js';
import { TuiHeader } from '../tui-header.js';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('TuiHeader', () => {
  it('renders startup hints with resolved app keybindings', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.session.resume': 'x',
      'app.model.cycleForward': 'm',
      'app.message.followUp': 'f',
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
    expect(rendered).toContain('X sessions');
    expect(rendered).toContain('M models');
    expect(rendered).toContain('F follow-up');
  });
});

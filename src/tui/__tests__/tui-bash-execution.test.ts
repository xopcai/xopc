import { describe, expect, it } from 'vitest';

import { BashExecutionComponent } from '../components/bash-execution.js';
import { XopcKeybindingsManager } from '../tui-keybindings-file.js';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('BashExecutionComponent', () => {
  it('uses configured tool expand key in collapsed output hints', () => {
    const keybindings = new XopcKeybindingsManager({ 'app.tools.expand': 'x' });
    const component = new BashExecutionComponent(
      'printf lines',
      { requestRender: () => {} } as never,
      false,
      keybindings,
    );
    component.appendOutput(Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n'));

    expect(component.render(80).join('\n')).toContain('X to expand tools/output');
  });

  it('renders completed commands with a no-output line', () => {
    const component = new BashExecutionComponent(
      'codex .',
      { requestRender: () => {} } as never,
      false,
    );

    component.setComplete(0, null);

    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('• You ran codex .');
    expect(rendered).toContain('  └ (no output)');
    expect(rendered).toContain('exit 0');
  });

  it('renders command output under the command summary', () => {
    const component = new BashExecutionComponent(
      'printf hello',
      { requestRender: () => {} } as never,
      false,
    );

    component.appendOutput('hello\nworld');
    component.setComplete(0, null);

    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('• You ran printf hello');
    expect(rendered).toContain('  └ hello');
    expect(rendered).toContain('    world');
  });
});

import { describe, expect, it } from 'vitest';

import { BashExecutionComponent } from '../components/bash-execution.js';
import { XopcKeybindingsManager } from '../tui-keybindings-file.js';

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
});

import { describe, expect, it } from 'vitest';

import { PendingInputPreview } from '../pending-input-preview.js';
import { XopcKeybindingsManager } from '../../tui-keybindings-file.js';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('PendingInputPreview', () => {
  it('renders full pending input state above the composer', () => {
    const preview = new PendingInputPreview(() => ({
      conversationId: 'c1',
      revision: 2,
      inputs: [
        { id: 's1', content: 'change direction', requestedDelivery: 'steer', effectiveDelivery: 'steer', status: 'injecting', version: 1 },
        { id: 'f1', content: 'then add tests', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', version: 3 },
      ],
    }), new XopcKeybindingsManager({}, '/tmp/keybindings.json'));

    const rendered = stripAnsi(preview.render(120).join('\n'));
    expect(rendered).toContain('Pending inputs (2)');
    expect(rendered).toContain('↑ edit last · Ctrl+X remove last');
    expect(rendered).toContain('Steering: change direction');
    expect(rendered).toContain('Follow-up: then add tests');
  });

  it('does not advertise edit actions for already-injecting inputs', () => {
    const preview = new PendingInputPreview(() => ({
      conversationId: 'c1',
      revision: 1,
      inputs: [
        { id: 's1', content: 'delivering', requestedDelivery: 'steer', effectiveDelivery: 'steer', status: 'injecting', version: 1 },
      ],
    }), new XopcKeybindingsManager({}, '/tmp/keybindings.json'));

    const rendered = stripAnsi(preview.render(120).join('\n'));
    expect(rendered).toContain('Pending inputs (1)');
    expect(rendered).not.toContain('edit last');
    expect(rendered).not.toContain('remove last');
  });
});

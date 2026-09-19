import type { Component, KeybindingsManager } from '@earendil-works/pi-tui';
import { truncateToWidth } from '@earendil-works/pi-tui';

import { formatKeyIds } from '../format-tui-hotkeys.js';
import { theme } from '../theme.js';
import {
  findLastEditableChatInput,
  isPendingChatInput,
  type TuiChatInput,
  type TuiChatInputState,
} from '../tui-chat-input-state.js';
import { sanitizeStatusText } from './tui-bottom-bar.js';

function labelForInput(input: TuiChatInput): string {
  if (input.status === 'injecting') return 'Steering';
  if (input.requestedDelivery === 'steer' && input.effectiveDelivery === 'next') return 'Deferred steer';
  if (input.status === 'interrupted') return 'Interrupted';
  return 'Follow-up';
}

export class PendingInputPreview implements Component {
  constructor(
    private readonly getState: () => TuiChatInputState,
    private readonly keybindings: KeybindingsManager,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.getState();
    const inputs = state.inputs.filter(isPendingChatInput);
    if (inputs.length === 0) return [];

    const editable = findLastEditableChatInput(state);
    const actions = editable
      ? ` · ${formatKeyIds(this.keybindings, 'app.message.editQueued', { capitalize: true })} edit last`
        + ` · ${formatKeyIds(this.keybindings, 'app.message.deleteQueued', { capitalize: true })} remove last`
      : '';
    const lines = [truncateToWidth(
      theme.dim(`Pending inputs (${inputs.length})${actions}`),
      width,
      theme.dim('…'),
    )];
    for (const input of inputs) {
      const content = sanitizeStatusText(input.content) || '(empty)';
      lines.push(truncateToWidth(theme.dim(`  ${labelForInput(input)}: ${content}`), width, theme.dim('…')));
    }
    return lines;
  }
}

import type { KeybindingsManager } from '@earendil-works/pi-tui';

import { formatKeyIds } from './format-tui-hotkeys.js';

function keyLabel(
  keybindings: KeybindingsManager,
  id: Parameters<KeybindingsManager['getKeys']>[0],
): string {
  return formatKeyIds(keybindings, id, { capitalize: true });
}

export function formatBusyResponseHint(keybindings: KeybindingsManager): string {
  const followUp = keyLabel(keybindings, 'app.message.followUp');
  const abort = keyLabel(keybindings, 'app.interrupt');
  return `A response is still in progress. Press Enter to steer, ${followUp} to queue, or ${abort} to abort.`;
}

export function formatSteerUnavailableHint(keybindings: KeybindingsManager): string {
  const abort = keyLabel(keybindings, 'app.interrupt');
  const followUp = keyLabel(keybindings, 'app.message.followUp');
  return `Could not steer — no active run or steer failed. Press ${abort} to abort, or ${followUp} to queue a follow-up.`;
}

export function formatSuspendUnsupportedHint(keybindings: KeybindingsManager): string {
  const suspend = keyLabel(keybindings, 'app.suspend');
  return `Suspend (${suspend}) is not supported on Windows.`;
}

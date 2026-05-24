import type { Component } from '@earendil-works/pi-tui';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

import { theme } from '../theme.js';

export type TuiHeaderModel = {
  version: string;
  connectionLabel: string;
  sessionKey: string;
  showHints: boolean;
};

const COMPACT_HINTS =
  'Esc abort · Ctrl+C×2 exit · /settings · /help · /hotkeys · Ctrl+Shift+P sessions';

const EXPANDED_HINTS = [
  'Enter steer while busy · Alt+Enter follow-up · Ctrl+P models · Ctrl+L picker',
  '! / !! local shell · Ctrl+V paste image · /compact compact history',
];

/** Collapsible startup header (pi-style hints subset). */
export class TuiHeader implements Component {
  private extensionLines: string[] = [];

  constructor(private readonly getModel: () => TuiHeaderModel) {}

  setExtensionLines(lines: string[]): void {
    this.extensionLines = lines;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const { version, connectionLabel, sessionKey, showHints } = this.getModel();
    const title = theme.header(`xopc tui v${version} — ${connectionLabel} — ${sessionKey}`);
    const lines = [truncateToWidth(title, width, theme.dim('…'))];

    if (showHints) {
      lines.push(truncateToWidth(theme.dim(COMPACT_HINTS), width, theme.dim('…')));
      for (const hint of EXPANDED_HINTS) {
        if (visibleWidth(hint) <= width) {
          lines.push(theme.dim(hint));
        } else {
          lines.push(truncateToWidth(theme.dim(hint), width, theme.dim('…')));
        }
      }
    }

    for (const extLine of this.extensionLines) {
      lines.push(truncateToWidth(theme.dim(extLine), width, theme.dim('…')));
    }

    return lines;
  }
}

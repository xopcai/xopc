import type { Component, KeybindingsManager } from '@earendil-works/pi-tui';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

import { theme } from '../theme.js';
import { formatKeyIds } from '../format-tui-hotkeys.js';

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
  private extensionComponents: Component[] = [];

  constructor(
    private readonly getModel: () => TuiHeaderModel,
    private readonly keybindings?: KeybindingsManager,
  ) {}

  setExtensionLines(lines: string[]): void {
    this.extensionLines = lines;
  }

  setExtensionComponents(components: Component[]): void {
    this.extensionComponents = components;
  }

  setCustomComponent(component: Component | undefined): void {
    this.customComponent = component;
  }

  invalidate(): void {}

  private getCompactHints(): string {
    if (!this.keybindings) return COMPACT_HINTS;
    const abort = formatKeyIds(this.keybindings, 'app.interrupt', { capitalize: true });
    const exit = formatKeyIds(this.keybindings, 'app.clear', { capitalize: true });
    const sessions = formatKeyIds(this.keybindings, 'app.session.resume', { capitalize: true });
    return `${abort} abort · ${exit}×2 exit · /settings · /help · /hotkeys · ${sessions} sessions`;
  }

  private getExpandedHints(): string[] {
    if (!this.keybindings) return EXPANDED_HINTS;
    const followUp = formatKeyIds(this.keybindings, 'app.message.followUp', { capitalize: true });
    const models = formatKeyIds(this.keybindings, 'app.model.cycleForward', { capitalize: true });
    const picker = formatKeyIds(this.keybindings, 'app.model.select', { capitalize: true });
    const pasteImage = formatKeyIds(this.keybindings, 'app.clipboard.pasteImage', {
      capitalize: true,
    });
    return [
      `Enter steer while busy · ${followUp} follow-up · ${models} models · ${picker} picker`,
      `! / !! local shell · ${pasteImage} paste image · /compact compact history`,
    ];
  }

  render(width: number): string[] {
    if (this.customComponent) {
      const rendered = this.customComponent.render(width);
      return rendered.map((line) => truncateToWidth(line, width, theme.dim('…')));
    }

    const { version, connectionLabel, sessionKey, showHints } = this.getModel();
    const title = theme.header(`xopc tui v${version} — ${connectionLabel} — ${sessionKey}`);
    const lines = [truncateToWidth(title, width, theme.dim('…'))];

    if (showHints) {
      lines.push(truncateToWidth(theme.dim(this.getCompactHints()), width, theme.dim('…')));
      for (const hint of this.getExpandedHints()) {
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
    for (const component of this.extensionComponents) {
      for (const line of component.render(width)) {
        lines.push(truncateToWidth(line, width, theme.dim('…')));
      }
    }

    return lines;
  }

  private customComponent: Component | undefined;
}

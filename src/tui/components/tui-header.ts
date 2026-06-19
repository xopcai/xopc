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
  'escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o tools';

const EXPANDED_HINTS = [
  'Press /start to show full startup help and loaded resources.',
  'xopc can use skills, workflows, connectors, and project context.',
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
    const interrupt = formatKeyIds(this.keybindings, 'app.interrupt', { capitalize: false });
    const clear = formatKeyIds(this.keybindings, 'app.clear', { capitalize: false });
    const exit = formatKeyIds(this.keybindings, 'app.exit', { capitalize: false });
    const tools = formatKeyIds(this.keybindings, 'app.tools.expand', { capitalize: false });
    return `${interrupt} interrupt · ${clear}/${exit} clear/exit · / commands · ! bash · ${tools} tools`;
  }

  private getExpandedHints(): string[] {
    if (!this.keybindings) return EXPANDED_HINTS;
    return EXPANDED_HINTS;
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

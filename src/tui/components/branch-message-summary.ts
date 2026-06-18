import type { KeybindingsManager } from '@earendil-works/pi-tui';
import { Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui';

import { formatKeyIds } from '../format-tui-hotkeys.js';
import { markdownTheme, theme } from '../theme.js';

export interface BranchMessageSummary {
  summary: string;
  fromId?: string;
}

function expandKeyLabel(keybindings: KeybindingsManager | undefined): string {
  return keybindings
    ? formatKeyIds(keybindings, 'app.tools.expand', { capitalize: true })
    : 'Ctrl+O';
}

/** Replay-only branch summary message from persisted pi-style transcript rows. */
export class BranchMessageSummaryComponent extends Container {
  private readonly body = new Container();
  private expanded = false;

  constructor(
    private readonly summary: BranchMessageSummary,
    private readonly keybindings?: KeybindingsManager,
  ) {
    super();
    this.addChild(new Spacer(1));
    this.addChild(this.body);
    this.refresh();
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.refresh();
  }

  override invalidate(): void {
    super.invalidate();
    this.refresh();
  }

  private refresh(): void {
    this.body.clear();
    this.body.addChild(new Text(theme.bold('[branch]'), 1, 1, (text) => theme.toolPendingBg(theme.accent(text))));

    if (!this.expanded) {
      const from = this.summary.fromId ? ` from ${this.summary.fromId}` : '';
      this.body.addChild(
        new Text(theme.dim(`Branch summary${from} (${expandKeyLabel(this.keybindings)} to expand)`), 1, 0),
      );
      return;
    }

    const header = this.summary.fromId
      ? `**Branch Summary**\n\n**From:** ${this.summary.fromId}\n\n`
      : '**Branch Summary**\n\n';
    this.body.addChild(
      new Markdown(
        header + this.summary.summary,
        1,
        0,
        markdownTheme,
        { color: (line) => theme.assistantText(line) },
        { preserveOrderedListMarkers: true },
      ),
    );
  }
}

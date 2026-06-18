import type { KeybindingsManager } from '@earendil-works/pi-tui';
import { Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui';

import type { TuiBranchSummary } from '../tui-backend.js';
import { formatKeyIds } from '../format-tui-hotkeys.js';
import { markdownTheme, theme } from '../theme.js';

function expandKeyLabel(keybindings: KeybindingsManager | undefined): string {
  return keybindings
    ? formatKeyIds(keybindings, 'app.tools.expand', { capitalize: true })
    : 'Ctrl+O';
}

function branchSummaryMarkdown(summary: TuiBranchSummary): string {
  const lines = [
    `**Rows forked:** ${summary.rowCount.toLocaleString()}`,
    `**Source:** ${summary.sourceSessionKey}`,
    `**Target:** ${summary.targetSessionKey}`,
  ];
  if (summary.entryId) {
    lines.push(`**Entry:** ${summary.entryId}`);
  }
  if (summary.restoredText?.trim()) {
    lines.push('', '**Restored input:**', summary.restoredText.trim());
  }
  return lines.join('\n');
}

export class BranchSummaryComponent extends Container {
  private readonly body = new Container();
  private expanded = false;

  constructor(
    private readonly summary: TuiBranchSummary,
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
    const title = `${theme.bold('[branch]')} ${theme.dim(`${this.summary.rowCount.toLocaleString()} rows`)}`;
    this.body.addChild(new Text(title, 1, 1, (text) => theme.toolSuccessBg(text)));

    if (!this.expanded) {
      this.body.addChild(
        new Text(
          theme.dim(`Forked to ${this.summary.targetSessionKey} (${expandKeyLabel(this.keybindings)} to expand)`),
          1,
          0,
        ),
      );
      return;
    }

    this.body.addChild(
      new Markdown(
        branchSummaryMarkdown(this.summary),
        1,
        0,
        markdownTheme,
        { color: (line) => theme.assistantText(line) },
        { preserveOrderedListMarkers: true },
      ),
    );
  }
}

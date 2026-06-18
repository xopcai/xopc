import type { KeybindingsManager } from '@earendil-works/pi-tui';
import { Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui';

import type { TuiCompactionResult } from '../tui-backend.js';
import { formatKeyIds } from '../format-tui-hotkeys.js';
import { markdownTheme, theme } from '../theme.js';

function formatTokens(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString()
    : '?';
}

function expandKeyLabel(keybindings: KeybindingsManager | undefined): string {
  return keybindings
    ? formatKeyIds(keybindings, 'app.tools.expand', { capitalize: true })
    : 'Ctrl+O';
}

export class CompactionSummaryComponent extends Container {
  private readonly body = new Container();
  private expanded = false;

  constructor(
    private readonly result: TuiCompactionResult,
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

    const tokens = `${formatTokens(this.result.tokensBefore)} -> ${formatTokens(this.result.tokensAfter)}`;
    const label = `${theme.bold('[compaction]')} ${theme.dim(tokens)}`;
    this.body.addChild(new Text(label, 1, 1, (text) => theme.toolSuccessBg(text)));

    const summary = this.result.transcriptSummary?.trim() || this.result.summary?.trim() || '';
    if (!this.expanded) {
      this.body.addChild(
        new Text(
          theme.dim(`Session compacted (${expandKeyLabel(this.keybindings)} to expand summary)`),
          1,
          0,
        ),
      );
      return;
    }

    if (summary) {
      this.body.addChild(
        new Markdown(
          summary,
          1,
          0,
          markdownTheme,
          { color: (line) => theme.assistantText(line) },
          { preserveOrderedListMarkers: true },
        ),
      );
    }
  }
}

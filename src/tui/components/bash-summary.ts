import type { KeybindingsManager } from '@earendil-works/pi-tui';
import { Container, Spacer, Text } from '@earendil-works/pi-tui';

import { formatKeyIds } from '../format-tui-hotkeys.js';
import { theme } from '../theme.js';
import { DynamicBorder } from './dynamic-border.js';
import { truncateToVisualLines } from './visual-truncate.js';

const PREVIEW_LINES = 20;
const MAX_OUTPUT_CHARS = 40_000;

export interface BashSummary {
  command: string;
  output?: string;
  exitCode?: number | null;
  signal?: string | null;
  excludeFromContext?: boolean;
  truncated?: boolean;
  fullOutputPath?: string;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function cleanOutput(text: string): string {
  const clean = stripAnsi(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return clean.length > MAX_OUTPUT_CHARS ? clean.slice(-MAX_OUTPUT_CHARS) : clean;
}

/** Replay-only shell output block for persisted `bashExecution` transcript rows. */
export class BashSummaryComponent extends Container {
  private readonly contentContainer = new Container();
  private readonly outputLines: string[];
  private expanded = false;

  constructor(
    private readonly summary: BashSummary,
    private readonly keybindings?: KeybindingsManager,
  ) {
    super();
    const colorKey = summary.excludeFromContext ? 'bashExclude' : 'bashMode';
    const borderColor = (str: string) => theme.fg(colorKey, str);
    const output = cleanOutput(summary.output ?? '');

    this.outputLines = output.split('\n').filter((line) => line.length > 0);

    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder(borderColor));
    this.addChild(this.contentContainer);
    this.addChild(new DynamicBorder(borderColor));
    this.refreshOutput();
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.refreshOutput();
  }

  override invalidate(): void {
    super.invalidate();
    this.refreshOutput();
  }

  private refreshOutput(): void {
    this.contentContainer.clear();

    const colorKey = this.summary.excludeFromContext ? 'bashExclude' : 'bashMode';
    this.contentContainer.addChild(
      new Text(theme.fg(colorKey, theme.bold(`$ ${this.summary.command}`)), 1, 0),
    );

    const visible = this.expanded ? this.outputLines : this.outputLines.slice(-PREVIEW_LINES);
    const hidden = this.outputLines.length - visible.length;
    if (hidden > 0 && !this.expanded) {
      const expandKey = this.keybindings
        ? formatKeyIds(this.keybindings, 'app.tools.expand', { capitalize: true })
        : 'Ctrl+O';
      this.contentContainer.addChild(
        new Text(
          theme.dim(`... ${hidden} more line${hidden > 1 ? 's' : ''} (${expandKey} to expand tools/output)`),
          1,
          0,
        ),
      );
    }

    if (visible.length > 0) {
      const outputText = visible.map((line) => theme.toolOutput(line)).join('\n');
      this.contentContainer.addChild(
        this.expanded
          ? new Text(outputText, 1, 0)
          : createVisualTailComponent(outputText, PREVIEW_LINES, 1),
      );
    }

    const exitText =
      this.summary.signal != null
        ? `signal ${this.summary.signal}`
        : `exit ${this.summary.exitCode ?? 0}`;
    const suffix = [
      exitText,
      this.summary.excludeFromContext ? 'excluded from agent context' : undefined,
      this.summary.truncated ? 'truncated' : undefined,
      this.summary.fullOutputPath ? `full output: ${this.summary.fullOutputPath}` : undefined,
    ].filter(Boolean).join(' · ');
    this.contentContainer.addChild(new Text(theme.dim(suffix), 1, 0));
  }
}

function createVisualTailComponent(text: string, maxVisualLines: number, paddingX: number) {
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;
  return {
    render(width: number): string[] {
      if (cachedWidth !== width || cachedLines === undefined) {
        const result = truncateToVisualLines(text, maxVisualLines, width, paddingX);
        cachedWidth = width;
        cachedLines = result.visualLines;
      }
      return cachedLines;
    },
    invalidate(): void {
      cachedWidth = undefined;
      cachedLines = undefined;
    },
  };
}

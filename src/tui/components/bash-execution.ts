import { Container, Loader, Spacer, Text, type TUI } from '@earendil-works/pi-tui';

import { theme } from '../theme.js';
import { DynamicBorder } from './dynamic-border.js';

const PREVIEW_LINES = 20;
const MAX_OUTPUT_CHARS = 40_000;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Local `!` / `!!` shell output block (pi coding-agent–aligned). */
export class BashExecutionComponent extends Container {
  private readonly contentContainer = new Container();
  private readonly loader: Loader;
  private outputLines: string[] = [];
  private status: 'running' | 'complete' | 'error' = 'running';
  private exitCode: number | undefined;
  private expanded = false;

  constructor(
    command: string,
    ui: TUI,
    private readonly excludeFromContext: boolean,
  ) {
    super();
    const colorKey = excludeFromContext ? 'bashExclude' : 'bashMode';
    const borderColor = (str: string) => theme.fg(colorKey, str);

    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder(borderColor));
    this.addChild(this.contentContainer);

    const header = new Text(theme.fg(colorKey, theme.bold(`$ ${command}`)), 1, 0);
    this.contentContainer.addChild(header);

    this.loader = new Loader(
      ui,
      (spinner) => theme.fg(colorKey, spinner),
      (text) => theme.dim(text),
      'Running…',
    );
    this.contentContainer.addChild(this.loader);

    this.addChild(new DynamicBorder(borderColor));
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.refreshOutput();
  }

  appendOutput(chunk: string): void {
    const clean = stripAnsi(chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const newLines = clean.split('\n');
    if (this.outputLines.length > 0 && newLines.length > 0) {
      this.outputLines[this.outputLines.length - 1] += newLines[0]!;
      this.outputLines.push(...newLines.slice(1));
    } else {
      this.outputLines.push(...newLines);
    }
    const joined = this.outputLines.join('\n');
    if (joined.length > MAX_OUTPUT_CHARS) {
      this.outputLines = joined.slice(-MAX_OUTPUT_CHARS).split('\n');
    }
    this.refreshOutput();
  }

  setComplete(exitCode: number | null | undefined, signal: NodeJS.Signals | null): void {
    this.loader.stop();
    if (signal) {
      this.status = 'error';
    } else if (exitCode != null && exitCode !== 0) {
      this.status = 'error';
    } else {
      this.status = 'complete';
    }
    this.exitCode = exitCode ?? undefined;
    this.refreshOutput();
  }

  setError(message: string): void {
    this.loader.stop();
    this.status = 'error';
    this.outputLines = [message];
    this.refreshOutput();
  }

  private refreshOutput(): void {
    while (this.contentContainer.children.length > 2) {
      this.contentContainer.removeChild(this.contentContainer.children[2]!);
    }

    const lines = this.outputLines.filter((l) => l.length > 0);
    const visible = this.expanded ? lines : lines.slice(-PREVIEW_LINES);
    const hidden = lines.length - visible.length;

    if (hidden > 0 && !this.expanded) {
      this.contentContainer.addChild(
        new Text(theme.dim(`… ${hidden} more line${hidden > 1 ? 's' : ''} (Ctrl+O to expand tools/output)`), 1, 0),
      );
    }

    for (const line of visible) {
      this.contentContainer.addChild(new Text(theme.toolOutput(line), 1, 0));
    }

    if (this.status !== 'running') {
      const suffix =
        this.status === 'error'
          ? `exit ${this.exitCode ?? '?'}${this.excludeFromContext ? ' · excluded from agent context' : ''}`
          : `exit ${this.exitCode ?? 0}${this.excludeFromContext ? ' · excluded from agent context' : ''}`;
      this.contentContainer.addChild(new Text(theme.dim(suffix), 1, 0));
    }
  }
}

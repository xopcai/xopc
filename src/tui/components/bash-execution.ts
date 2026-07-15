import {
  Container,
  type KeybindingsManager,
  Loader,
  Spacer,
  Text,
  type TUI,
} from '@earendil-works/pi-tui';

import { theme } from '../theme.js';
import { formatKeyIds } from '../format-tui-hotkeys.js';
import { DynamicBorder } from './dynamic-border.js';
import { truncateToVisualLines } from './visual-truncate.js';

const PREVIEW_LINES = 20;
const MAX_OUTPUT_CHARS = 40_000;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Local `!` / `!!` shell output block (pi coding-agent–aligned). */
export class BashExecutionComponent extends Container {
  private readonly contentContainer = new Container();
  private readonly header: Text;
  private readonly loader: Loader;
  private outputLines: string[] = [];
  private status: 'running' | 'complete' | 'error' = 'running';
  private exitCode: number | undefined;
  private expanded = false;
  private readonly colorKey: 'bashExclude' | 'bashMode';

  constructor(
    private readonly command: string,
    ui: TUI,
    private readonly excludeFromContext: boolean,
    private readonly keybindings?: KeybindingsManager,
  ) {
    super();
    this.colorKey = excludeFromContext ? 'bashExclude' : 'bashMode';
    const borderColor = (str: string) => theme.fg(this.colorKey, str);

    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder(borderColor));
    this.addChild(this.contentContainer);

    this.header = new Text(this.formatHeader(), 1, 0);
    this.loader = new Loader(
      ui,
      (spinner) => theme.fg(this.colorKey, spinner),
      (text) => theme.dim(text),
      'Running…',
    );
    this.contentContainer.addChild(this.header);
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

    this.header.setText(this.formatHeader());

    const lines = this.outputLines.filter((l) => l.length > 0);
    const visible = this.expanded ? lines : lines.slice(-PREVIEW_LINES);
    const hidden = lines.length - visible.length;

    if (hidden > 0 && !this.expanded) {
      const expandKey = this.keybindings
        ? formatKeyIds(this.keybindings, 'app.tools.expand', { capitalize: true })
        : 'Ctrl+O';
      this.contentContainer.addChild(
        new Text(
          theme.dim(`… ${hidden} more line${hidden > 1 ? 's' : ''} (${expandKey} to expand tools/output)`),
          1,
          0,
        ),
      );
    }

    if (visible.length > 0) {
      const outputText = visible
        .map((line, index) => theme.toolOutput(`${index === 0 ? '  └ ' : '    '}${line}`))
        .join('\n');
      if (this.expanded) {
        this.contentContainer.addChild(new Text(outputText, 1, 0));
      } else {
        this.contentContainer.addChild(createVisualTailComponent(outputText, PREVIEW_LINES, 1));
      }
    } else if (this.status !== 'running') {
      this.contentContainer.addChild(new Text(theme.dim('  └ (no output)'), 1, 0));
    }

    if (this.status !== 'running') {
      const suffix =
        this.status === 'error'
          ? `exit ${this.exitCode ?? '?'}${this.excludeFromContext ? ' · excluded from agent context' : ''}`
          : `exit ${this.exitCode ?? 0}${this.excludeFromContext ? ' · excluded from agent context' : ''}`;
      this.contentContainer.addChild(new Text(theme.dim(suffix), 1, 0));
    }
  }

  private formatHeader(): string {
    const verb = this.status === 'running' ? 'Running' : 'You ran';
    return theme.fg(this.colorKey, theme.bold(`• ${verb} ${this.command}`));
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

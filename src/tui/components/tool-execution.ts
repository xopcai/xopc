import { Container, Spacer, Text } from '@mariozechner/pi-tui';

import { theme } from '../theme.js';

const MAX_ARG_VALUE_LENGTH = 120;

function sanitize(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function formatArgsSummary(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      const truncated =
        stringValue.length > MAX_ARG_VALUE_LENGTH
          ? `${stringValue.slice(0, MAX_ARG_VALUE_LENGTH - 3)}...`
          : stringValue;
      return `${key}=${truncated}`;
    })
    .join(', ');
}

export class ToolExecutionComponent extends Container {
  private contentText: Text;
  private toolName: string;
  private args: unknown;
  private resultText = '';
  private expanded = false;
  private isError = false;
  private isPartial = true;

  constructor(toolName: string, args: unknown) {
    super();
    this.toolName = toolName;
    this.args = args;

    this.addChild(new Spacer(1));

    const bgFn = (text: string) => theme.toolPendingBg(text);
    this.contentText = new Text('', 1, 1, bgFn);
    this.addChild(this.contentText);

    this.refresh();
  }

  setArgs(args: unknown): void {
    this.args = args;
    this.refresh();
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.refresh();
  }

  setResult(result: string, isError: boolean): void {
    this.resultText = sanitize(result);
    this.isError = isError;
    this.isPartial = false;
    this.refresh();
  }

  private refresh(): void {
    const bgFn = this.isPartial
      ? (text: string) => theme.toolPendingBg(text)
      : this.isError
        ? (text: string) => theme.toolErrorBg(text)
        : (text: string) => theme.toolSuccessBg(text);
    this.contentText.setCustomBgFn(bgFn);
    this.contentText.setText(this.formatToolExecution());
  }

  private formatToolExecution(): string {
    // Title line: 🔧 tool_name (args_summary)
    const argsStr = formatArgsSummary(this.args);
    const titleParts = [theme.toolTitle(theme.bold(this.toolName))];
    if (argsStr) {
      titleParts.push(theme.dim(`(${argsStr})`));
    }
    let text = titleParts.join(' ');

    // Output / result — collapsed: single-line summary; expanded: full output
    const output = this.resultText;
    if (output) {
      if (this.expanded) {
        text += `\n${theme.toolOutput(output)}`;
      } else {
        // Compact single-line preview: flatten to one line and truncate
        const oneLine = output.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        const lineCount = output.split('\n').length;
        const maxPreviewLength = 200;
        const preview = oneLine.length > maxPreviewLength
          ? `${oneLine.slice(0, maxPreviewLength)}…`
          : oneLine;
        const suffix = lineCount > 1 ? theme.dim(` (${lineCount} lines)`) : '';
        text += `\n${theme.toolOutput(preview)}${suffix}`;
      }
    } else if (this.isPartial) {
      text += `\n${theme.dim('…')}`;
    }

    return text;
  }
}

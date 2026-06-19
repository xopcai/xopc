import {
  Container,
  type Component,
  getCapabilities,
  Image,
  type KeybindingsManager,
  Spacer,
  Text,
} from '@earendil-works/pi-tui';
import { basename, dirname } from 'node:path';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';

import { theme } from '../theme.js';
import { formatKeyIds } from '../format-tui-hotkeys.js';
import { isDiffFriendlyTool, looksLikeUnifiedDiff, renderUnifiedDiff } from '../tui-tool-diff.js';
import {
  hasStructuredTuiToolRenderer,
  renderToolCallWithExtensions,
  renderToolResultWithExtensions,
  renderToolWithExtensions,
} from '../extension-host/tool-renderers.js';
import {
  parseTuiToolResult,
  type TuiToolContentBlock,
} from '../tui-tool-result.js';
import { truncateToVisualLines } from './visual-truncate.js';

const MAX_ARG_VALUE_LENGTH = 120;
const COLLAPSED_RESULT_VISUAL_LINES = 4;

export interface ToolExecutionOptions {
  showImages?: boolean;
  imageWidthCells?: number;
  keybindings?: KeybindingsManager;
  toolCallId?: string;
  cwd?: string;
}

function sanitize(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function trimTrailingBlankDisplayLines(text: string): string {
  return text.replace(/(?:\r?\n[ \t]*)+$/g, '');
}

export function getToolResultDisplayText(
  content: TuiToolContentBlock[],
  options: { showImages: boolean; supportsInlineImages: boolean },
): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      if (block.text) parts.push(sanitize(block.text));
      continue;
    }
    if (block.type === 'image' && (!options.supportsInlineImages || !options.showImages)) {
      parts.push(block.mimeType ? `[image:${block.mimeType}]` : '[image]');
      continue;
    }
    if (block.type !== 'image') {
      parts.push(block.text ? sanitize(block.text) : `[${block.type}]`);
    }
  }
  return trimTrailingBlankDisplayLines(parts.filter(Boolean).join('\n'));
}

function formatArgsSummary(args: unknown, toolName: string): string {
  if (!args || typeof args !== 'object') return '';
  const compactRead = isReadStyleTool(toolName) ? formatCompactReadArgs(args) : null;
  if (compactRead) return compactRead;
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      const stringValue = formatArgValue(value);
      const truncated =
        stringValue.length > MAX_ARG_VALUE_LENGTH
          ? `${stringValue.slice(0, MAX_ARG_VALUE_LENGTH - 3)}...`
          : stringValue;
      return `${key}=${truncated}`;
    })
    .join(', ');
}

function isReadStyleTool(toolName: string): boolean {
  return ['read', 'read_file', 'memory_get'].includes(toolName);
}

function formatCompactReadArgs(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const record = args as Record<string, unknown>;
  const rawPath = typeof record.path === 'string'
    ? record.path
    : typeof record.file_path === 'string'
      ? record.file_path
      : undefined;
  if (!rawPath) return null;

  const normalized = rawPath.replace(/\\/g, '/');
  const base = basename(normalized);
  let label: string | null = null;
  if (base === 'SKILL.md') {
    const parent = basename(dirname(normalized));
    label = parent ? `[skill] ${parent}` : '[skill]';
  } else if (base === 'AGENTS.md') {
    label = `read resource ${normalized}`;
  }
  if (!label) return null;

  const start = firstFiniteNumber(record.offset, record.from, record.start, record.line);
  const count = firstFiniteNumber(record.limit, record.lines, record.count);
  if (start != null && count != null && count > 0) {
    label += `:${start}-${start + count - 1}`;
  }
  return label;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.floor(parsed);
    }
  }
  return null;
}

function formatArgValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'symbol') return String(value);
  if (value instanceof Error) return value.message || value.name;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function isTuiComponent(value: unknown): value is Component {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { render?: unknown }).render === 'function',
  );
}

export class ToolExecutionComponent extends Container {
  private contentContainer: Container;
  private contentText: Text;
  private collapsedOutputComponent: ReturnType<typeof createVisualTailComponent> | null = null;
  private collapsedReadSummaryComponent: ReturnType<typeof createCollapsedReadSummaryComponent> | null = null;
  private toolName: string;
  private toolCallId: string;
  private args: unknown;
  private argsComplete = true;
  private resultText = '';
  private resultContent: TuiToolContentBlock[] | undefined;
  private resultDetails: unknown;
  private rendererState: Record<string, unknown> = {};
  private lastRendererOutput: string[] | Component | undefined;
  private lastCallRendererOutput: string[] | Component | undefined;
  private lastResultRendererOutput: string[] | Component | undefined;
  private customRendererComponent: Component | undefined;
  private structuredRendererComponents: Component[] = [];
  private contentTextAttached = true;
  private rendererInvalidationQueued = false;
  private imageComponents: Image[] = [];
  private imageSpacers: Spacer[] = [];
  private showImages: boolean;
  private imageWidthCells: number;
  private keybindings: KeybindingsManager | undefined;
  private cwd: string;
  private expanded = false;
  private isError = false;
  private isPartial = true;
  private executionStarted = false;

  constructor(toolName: string, toolCallId: string, args: unknown, options: ToolExecutionOptions = {}) {
    super();
    this.toolName = toolName;
    this.toolCallId = toolCallId;
    this.args = args;
    this.showImages = options.showImages ?? true;
    this.imageWidthCells = Math.max(1, Math.floor(options.imageWidthCells ?? 60));
    this.keybindings = options.keybindings;
    this.cwd = options.cwd ?? process.cwd();

    this.addChild(new Spacer(1));

    const bgFn = (text: string) => theme.toolPendingBg(text);
    this.contentContainer = new Container();
    this.contentText = new Text('', 1, 1, bgFn);
    this.contentContainer.addChild(this.contentText);
    this.addChild(this.contentContainer);

    this.refresh();
  }

  setArgs(args: unknown): void {
    this.args = args;
    this.refresh();
  }

  markExecutionStarted(): void {
    this.executionStarted = true;
    this.refresh();
  }

  setArgsComplete(): void {
    this.argsComplete = true;
    this.refresh();
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.refresh();
  }

  updateResult(result: AgentToolResult<any> | unknown, isPartial = false, isError = false): void {
    const parsed = parseTuiToolResult(result);
    this.resultText = sanitize(parsed.text);
    this.resultContent = parsed.envelope?.content;
    this.resultDetails = parsed.envelope?.details;
    this.isError = isError;
    this.isPartial = isPartial;
    this.refresh();
  }

  setImageOptions(options: ToolExecutionOptions): void {
    if (options.showImages !== undefined) {
      this.showImages = options.showImages;
    }
    if (options.imageWidthCells !== undefined) {
      this.imageWidthCells = Math.max(1, Math.floor(options.imageWidthCells));
    }
    if (options.keybindings !== undefined) {
      this.keybindings = options.keybindings;
    }
    if (options.cwd !== undefined) {
      this.cwd = options.cwd;
    }
    this.refresh();
  }

  setPartialDetails(details: unknown): void {
    this.resultDetails = details;
    this.isPartial = true;
    this.refresh();
  }

  private refresh(): void {
    const bgFn = this.isPartial
      ? (text: string) => theme.toolPendingBg(text)
      : this.isError
        ? (text: string) => theme.toolErrorBg(text)
        : (text: string) => theme.toolSuccessBg(text);
    this.refreshCollapsedOutput(null);
    this.refreshCollapsedReadSummary(null);
    if (this.customRendererComponent) {
      this.contentContainer.removeChild(this.customRendererComponent);
      this.customRendererComponent = undefined;
    }
    for (const component of this.structuredRendererComponents) {
      this.contentContainer.removeChild(component);
    }
    this.structuredRendererComponents = [];
    this.contentText.setCustomBgFn(bgFn);

    if (hasStructuredTuiToolRenderer(this.toolName)) {
      this.detachContentText();
      this.renderStructuredExtensionTool();
    } else {
      const custom = this.renderExtensionTool();
      if (Array.isArray(custom) && custom.length > 0) {
        this.ensureContentTextAttached();
        this.lastRendererOutput = custom;
        this.contentText.setText(custom.join('\n'));
      } else if (isTuiComponent(custom)) {
        this.detachContentText();
        this.customRendererComponent = custom;
        this.lastRendererOutput = custom;
        this.contentContainer.addChild(custom);
      } else {
        this.ensureContentTextAttached();
        this.lastRendererOutput = undefined;
        this.contentText.setText(this.formatToolExecution());
      }
    }
    this.refreshImages();
  }

  private appendRendererResult(result: ReturnType<typeof renderToolWithExtensions>): boolean {
    if (Array.isArray(result) && result.length > 0) {
      const component = new Text(result.join('\n'), 1, 1);
      this.structuredRendererComponents.push(component);
      this.contentContainer.addChild(component);
      return true;
    }
    if (isTuiComponent(result)) {
      this.structuredRendererComponents.push(result);
      this.contentContainer.addChild(result);
      return true;
    }
    return false;
  }

  private renderStructuredExtensionTool(): void {
    const call = this.renderExtensionToolCall();
    if (this.appendRendererResult(call)) {
      this.lastCallRendererOutput = call as string[] | Component;
    } else {
      this.lastCallRendererOutput = undefined;
      this.ensureContentTextAttached();
      this.contentText.setText(this.formatToolCallFallback());
    }

    if (!this.isPartial || this.resultDetails !== undefined || this.resultText || this.resultContent) {
      const result = this.renderExtensionToolResult();
      if (this.appendRendererResult(result)) {
        this.lastResultRendererOutput = result as string[] | Component;
      } else {
        this.appendRendererResult([this.formatToolResultFallback()].filter(Boolean));
        this.lastResultRendererOutput = undefined;
      }
    }
  }

  private ensureContentTextAttached(): void {
    if (this.contentTextAttached) return;
    this.contentContainer.addChild(this.contentText);
    this.contentTextAttached = true;
  }

  private detachContentText(): void {
    if (!this.contentTextAttached) return;
    this.contentContainer.removeChild(this.contentText);
    this.contentTextAttached = false;
  }

  private requestRendererInvalidate(): void {
    if (this.rendererInvalidationQueued) return;
    this.rendererInvalidationQueued = true;
    queueMicrotask(() => {
      this.rendererInvalidationQueued = false;
      this.refresh();
      this.invalidate();
    });
  }

  private renderExtensionTool(): ReturnType<typeof renderToolWithExtensions> {
    return renderToolWithExtensions(this.createRenderContext(this.lastRendererOutput));
  }

  private renderExtensionToolCall(): ReturnType<typeof renderToolWithExtensions> {
    return renderToolCallWithExtensions(
      this.createRenderContext(this.lastCallRendererOutput),
      theme,
    );
  }

  private renderExtensionToolResult(): ReturnType<typeof renderToolWithExtensions> {
    return renderToolResultWithExtensions(
      this.createRenderContext(this.lastResultRendererOutput),
      theme,
    );
  }

  private createRenderContext(lastComponent: string[] | Component | undefined) {
    return {
      toolName: this.toolName,
      toolCallId: this.toolCallId,
      args: this.args,
      resultText: this.getDisplayResultText(),
      content: this.resultContent,
      details: this.resultDetails,
      invalidate: () => this.requestRendererInvalidate(),
      lastComponent,
      state: this.rendererState,
      cwd: this.cwd,
      executionStarted: this.executionStarted,
      argsComplete: this.argsComplete,
      isError: this.isError,
      isPartial: this.isPartial,
      expanded: this.expanded,
      showImages: this.showImages,
    };
  }

  private formatToolCallFallback(): string {
    const argsStr = formatArgsSummary(this.args, this.toolName);
    const titleParts = [theme.toolTitle(theme.bold(this.toolName))];
    if (argsStr) {
      titleParts.push(theme.dim(`(${argsStr})`));
    }
    if (this.isPartial && !this.resultText && !this.resultContent && this.resultDetails === undefined) {
      titleParts.push(theme.dim('…'));
    }
    return titleParts.join(' ');
  }

  private formatToolResultFallback(): string {
    const output = this.getDisplayResultText();
    let text = '';
    if (output) {
      const expandKey = this.keybindings
        ? formatKeyIds(this.keybindings, 'app.tools.expand', { capitalize: true })
        : 'Ctrl+O';
      const lineCount = output.split('\n').length;
      const useDiff =
        this.expanded &&
        isDiffFriendlyTool(this.toolName) &&
        looksLikeUnifiedDiff(output);
      if (useDiff) {
        text += renderUnifiedDiff(output);
      } else if (this.expanded) {
        text += theme.toolOutput(output);
      } else if (isReadStyleTool(this.toolName)) {
        const rows = new Text(output, 1, 0).render(80).length;
        const plural = rows === 1 ? 'row' : 'rows';
        text += theme.dim(`  ${rows} ${plural}; ${expandKey} to expand`);
      } else {
        const suffix = lineCount > COLLAPSED_RESULT_VISUAL_LINES
          ? theme.dim(` (${lineCount} lines; ${expandKey} to expand)`)
          : '';
        text += theme.dim(`preview${suffix}`);
      }
    }
    if (this.expanded && this.resultDetails !== undefined) {
      const detailsText = formatDetailsPreview(this.resultDetails);
      if (detailsText) {
        text = [text, theme.dim(detailsText)].filter(Boolean).join('\n');
      }
    }
    return text;
  }

  private formatToolExecution(): string {
    // Title line: 🔧 tool_name (args_summary)
    const argsStr = formatArgsSummary(this.args, this.toolName);
    const titleParts = [theme.toolTitle(theme.bold(this.toolName))];
    if (argsStr) {
      titleParts.push(theme.dim(`(${argsStr})`));
    }
    let text = titleParts.join(' ');

    // Output / result — collapsed: single-line summary; expanded: full output
    const output = this.getDisplayResultText();
    if (output) {
      const expandKey = this.keybindings
        ? formatKeyIds(this.keybindings, 'app.tools.expand', { capitalize: true })
        : 'Ctrl+O';
      const lineCount = output.split('\n').length;
      const useDiff =
        this.expanded &&
        isDiffFriendlyTool(this.toolName) &&
        looksLikeUnifiedDiff(output);
      if (useDiff) {
        text += `\n${renderUnifiedDiff(output)}`;
      } else if (this.expanded) {
        text += `\n${theme.toolOutput(output)}`;
      } else if (isReadStyleTool(this.toolName)) {
        this.refreshCollapsedReadSummary(output, expandKey);
      } else {
        const suffix = lineCount > COLLAPSED_RESULT_VISUAL_LINES
          ? theme.dim(` (${lineCount} lines; ${expandKey} to expand)`)
          : '';
        text += `\n${theme.dim(`preview${suffix}`)}`;
        this.refreshCollapsedOutput(
          theme.toolOutput(output),
          lineCount > COLLAPSED_RESULT_VISUAL_LINES ? undefined : `${expandKey} to expand`,
        );
      }
    } else if (this.isPartial) {
      text += `\n${theme.dim('…')}`;
    }

    if (this.expanded && this.resultDetails !== undefined) {
      const detailsText = formatDetailsPreview(this.resultDetails);
      if (detailsText) {
        text += `\n${theme.dim(detailsText)}`;
      }
    }

    return text;
  }

  private getDisplayResultText(): string {
    if (!this.resultContent) {
      return trimTrailingBlankDisplayLines(this.resultText);
    }
    return getToolResultDisplayText(this.resultContent, {
      showImages: this.showImages,
      supportsInlineImages: Boolean(getCapabilities().images),
    });
  }

  private refreshImages(): void {
    for (const image of this.imageComponents) {
      this.removeChild(image);
    }
    this.imageComponents = [];
    for (const spacer of this.imageSpacers) {
      this.removeChild(spacer);
    }
    this.imageSpacers = [];

    const imageBlocks = this.resultContent?.filter(
      (block) => block.type === 'image' && block.data && block.mimeType,
    ) ?? [];
    if (imageBlocks.length === 0) return;

    const capabilities = getCapabilities();
    if (!capabilities.images || !this.showImages) return;

    for (const block of imageBlocks) {
      const spacer = new Spacer(1);
      const image = new Image(
        block.data!,
        block.mimeType!,
        { fallbackColor: (text: string) => theme.toolOutput(text) },
        { maxWidthCells: this.imageWidthCells },
      );
      this.imageSpacers.push(spacer);
      this.imageComponents.push(image);
      this.addChild(spacer);
      this.addChild(image);
    }
  }

  private refreshCollapsedOutput(text: string | null, truncationHint?: string): void {
    if (this.collapsedOutputComponent) {
      this.contentContainer.removeChild(this.collapsedOutputComponent);
      this.collapsedOutputComponent = null;
    }
    if (!text) return;
    this.collapsedOutputComponent = createVisualTailComponent(
      text,
      COLLAPSED_RESULT_VISUAL_LINES,
      1,
      truncationHint,
    );
    this.contentContainer.addChild(this.collapsedOutputComponent);
  }

  private refreshCollapsedReadSummary(text: string | null, expandKey?: string): void {
    if (this.collapsedReadSummaryComponent) {
      this.contentContainer.removeChild(this.collapsedReadSummaryComponent);
      this.collapsedReadSummaryComponent = null;
    }
    if (!text || !expandKey) return;
    this.collapsedReadSummaryComponent = createCollapsedReadSummaryComponent(text, expandKey, 1);
    this.contentContainer.addChild(this.collapsedReadSummaryComponent);
  }
}

function formatDetailsPreview(details: unknown): string {
  if (details === null) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function createVisualTailComponent(
  text: string,
  maxVisualLines: number,
  paddingX: number,
  truncationHint?: string,
) {
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;
  return {
    render(width: number): string[] {
      if (cachedWidth !== width || cachedLines === undefined) {
        const result = truncateToVisualLines(text, maxVisualLines, width, paddingX);
        cachedWidth = width;
        cachedLines =
          result.skippedCount > 0 && truncationHint
            ? [theme.dim(`  (${result.skippedCount} rows hidden; ${truncationHint})`), ...result.visualLines]
            : result.visualLines;
      }
      return cachedLines;
    },
    invalidate(): void {
      cachedWidth = undefined;
      cachedLines = undefined;
    },
  };
}

function createCollapsedReadSummaryComponent(text: string, expandKey: string, paddingX: number) {
  let cachedWidth: number | undefined;
  let cachedLine: string | undefined;
  return {
    render(width: number): string[] {
      if (cachedWidth !== width || cachedLine === undefined) {
        const rows = new Text(text, paddingX, 0).render(width).length;
        const plural = rows === 1 ? 'row' : 'rows';
        cachedWidth = width;
        cachedLine = theme.dim(`  ${rows} ${plural}; ${expandKey} to expand`);
      }
      return [cachedLine];
    },
    invalidate(): void {
      cachedWidth = undefined;
      cachedLine = undefined;
    },
  };
}

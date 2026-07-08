import {
  Container,
  type Component,
  getCapabilities,
  Image,
  type KeybindingsManager,
  Spacer,
  Text,
} from '@earendil-works/pi-tui';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';

import { theme } from '../theme.js';
import { formatKeyIds } from '../format-tui-hotkeys.js';
import {
  isDiffFriendlyTool,
  looksLikeUnifiedDiff,
  renderPatchSummary,
  renderUnifiedDiff,
} from '../tui-tool-diff.js';
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
import {
  displayToolName,
  formatArgsSummary,
  formatCollapsedToolSummary,
  formatExecExpandedOutput,
  getToolSummaryKind,
  isExecStyleTool,
  isReadStyleTool,
} from '../tool-summary.js';
import { truncateToVisualLines, truncateToVisualLinesMiddle } from './visual-truncate.js';

const COLLAPSED_RESULT_VISUAL_LINES = 4;
const EXPANDED_RESULT_VISUAL_LINES = 80;

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
  private expandedOutputComponent: ReturnType<typeof createVisualMiddleComponent> | null = null;
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
  private startedAt = Date.now();
  private completedAt: number | undefined;

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
    this.startedAt = Date.now();
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
    if (!isPartial) {
      this.completedAt = Date.now();
    }
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
    this.refreshExpandedOutput(null);
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
    const titleParts = [
      theme.dim(this.toolStatusLabel()),
      theme.toolTitle(theme.bold(displayToolName(this.toolName))),
    ];
    if (argsStr) {
      titleParts.push(theme.dim(`(${argsStr})`));
    }
    const duration = this.toolDurationLabel();
    if (duration) {
      titleParts.push(theme.dim(duration));
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
        isDiffFriendlyTool(this.toolName) &&
        looksLikeUnifiedDiff(output);
      if (this.expanded && useDiff) {
        text += renderPatchSummary(output) ?? renderUnifiedDiff(output);
      } else if (this.expanded && isExecStyleTool(this.toolName)) {
        this.refreshExpandedOutput(theme.toolOutput(formatExecExpandedOutput(output, this.resultDetails)));
      } else if (this.expanded) {
        this.refreshExpandedOutput(theme.toolOutput(output));
      } else if (useDiff) {
        text += theme.dim('preview');
      } else if (getToolSummaryKind(this.toolName) !== 'generic') {
        text += this.collapsedSpecializedSummary(output, expandKey);
      } else {
        const suffix = lineCount > COLLAPSED_RESULT_VISUAL_LINES
          ? theme.dim(` (${lineCount} lines; ${expandKey} to expand)`)
          : '';
        text += theme.dim(`preview${suffix}`);
      }
    }
    if (this.shouldRenderDetailsPreview()) {
      const detailsText = formatDetailsPreview(this.resultDetails);
      if (detailsText) {
        text = [text, theme.dim(detailsText)].filter(Boolean).join('\n');
      }
    }
    return text;
  }

  private formatToolExecution(): string {
    const argsStr = formatArgsSummary(this.args, this.toolName);
    const titleParts = [
      theme.dim(this.toolStatusLabel()),
      theme.toolTitle(theme.bold(displayToolName(this.toolName))),
    ];
    if (argsStr) {
      titleParts.push(theme.dim(`(${argsStr})`));
    }
    const duration = this.toolDurationLabel();
    if (duration) {
      titleParts.push(theme.dim(duration));
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
        isDiffFriendlyTool(this.toolName) &&
        looksLikeUnifiedDiff(output);
      if (this.expanded && useDiff) {
        text += `\n${renderPatchSummary(output) ?? renderUnifiedDiff(output)}`;
      } else if (this.expanded && isExecStyleTool(this.toolName)) {
        this.refreshExpandedOutput(theme.toolOutput(formatExecExpandedOutput(output, this.resultDetails)));
      } else if (this.expanded) {
        this.refreshExpandedOutput(theme.toolOutput(output));
      } else if (useDiff) {
        const suffix = output.split('\n').length > COLLAPSED_RESULT_VISUAL_LINES
          ? theme.dim(` (${output.split('\n').length} lines; ${expandKey} to expand)`)
          : '';
        text += `\n${theme.dim(`preview${suffix}`)}`;
      } else if (isReadStyleTool(this.toolName)) {
        this.refreshCollapsedReadSummary(output, expandKey);
      } else if (getToolSummaryKind(this.toolName) !== 'generic') {
        text += `\n${this.collapsedSpecializedSummary(output, expandKey)}`;
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

    if (this.shouldRenderDetailsPreview()) {
      const detailsText = formatDetailsPreview(this.resultDetails);
      if (detailsText) {
        text += `\n${theme.dim(detailsText)}`;
      }
    }

    return text;
  }

  private toolStatusLabel(): string {
    if (this.isError) return 'Failed';
    if (this.isPartial && !this.resultText && !this.resultContent && this.resultDetails === undefined) {
      return this.executionStarted ? 'Calling' : 'Queued';
    }
    if (this.isPartial) return 'Calling';
    return 'Called';
  }

  private toolDurationLabel(): string {
    if (this.completedAt === undefined) return '';
    const durationMs = Math.max(0, this.completedAt - this.startedAt);
    if (durationMs < 100) return '';
    return `${durationMs}ms`;
  }

  private collapsedSpecializedSummary(output: string, expandKey: string): string {
    return theme.dim(formatCollapsedToolSummary({
      toolName: this.toolName,
      args: this.args,
      output,
      content: this.resultContent,
      details: this.resultDetails,
      isError: this.isError,
      expandKey,
    }));
  }

  private shouldRenderDetailsPreview(): boolean {
    return this.expanded && this.resultDetails !== undefined && !isExecStyleTool(this.toolName);
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

  private refreshExpandedOutput(text: string | null): void {
    if (this.expandedOutputComponent) {
      this.contentContainer.removeChild(this.expandedOutputComponent);
      this.expandedOutputComponent = null;
    }
    if (!text) return;
    this.expandedOutputComponent = createVisualMiddleComponent(
      text,
      EXPANDED_RESULT_VISUAL_LINES,
      1,
    );
    this.contentContainer.addChild(this.expandedOutputComponent);
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

function createVisualMiddleComponent(
  text: string,
  maxVisualLines: number,
  paddingX: number,
) {
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;
  return {
    render(width: number): string[] {
      if (cachedWidth !== width || cachedLines === undefined) {
        const result = truncateToVisualLinesMiddle(text, maxVisualLines, width, paddingX);
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

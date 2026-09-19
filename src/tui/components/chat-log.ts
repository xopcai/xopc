import type { Component, KeybindingsManager } from '@earendil-works/pi-tui';
import { Container, Spacer, Text } from '@earendil-works/pi-tui';
import type { AgentMessage, AgentToolResult } from '@earendil-works/pi-agent-core';

import { BashExecutionComponent } from './bash-execution.js';
import { BashSummaryComponent, type BashSummary } from './bash-summary.js';
import { BranchMessageSummaryComponent, type BranchMessageSummary } from './branch-message-summary.js';
import { BranchSummaryComponent } from './branch-summary.js';
import { CompactionSummaryComponent } from './compaction-summary.js';
import { CustomMessageComponent, type CustomMessageSummary } from './custom-message.js';
import type { TuiMessageRenderer } from '../../extensions/types/tui.js';
import { theme } from '../theme.js';
import { AssistantMessageComponent } from './assistant-message.js';
import { ToolExecutionComponent, type ToolExecutionOptions } from './tool-execution.js';
import { UserMessageComponent } from './user-message.js';
import type { TuiBranchSummary, TuiCompactionResult } from '../tui-backend.js';
import type { CellRenderMode, ModeAwareCell } from './cell-render-mode.js';
import { SemanticCellComponent, type SemanticCellData } from './semantic-cell.js';

type ExpandableBlock = { setExpanded(expanded: boolean): void };
export type ChatLogEntryMeta = {
  displayIndex?: number;
  historyIndex?: number;
  rowNumber?: number;
  role?: 'user' | 'assistant' | 'system';
};

type ChatLogEntryRecord = ChatLogEntryMeta & { component: Component };

function assistantPlainText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const rec = block as { type?: unknown; text?: unknown };
      return rec.type === 'text' && typeof rec.text === 'string' ? rec.text : '';
    })
    .join('');
}

export class ChatLog extends Container {
  private toolById = new Map<string, ToolExecutionComponent>();
  private bashBlocks: Array<Component & ExpandableBlock> = [];
  private compactionBlocks: CompactionSummaryComponent[] = [];
  private branchBlocks: BranchSummaryComponent[] = [];
  private branchMessageBlocks: BranchMessageSummaryComponent[] = [];
  private customBlocks: CustomMessageComponent[] = [];
  private semanticCells = new Map<string, SemanticCellComponent>();
  private customMessageRenderers = new Map<string, TuiMessageRenderer>();
  private assistantMessages: AssistantMessageComponent[] = [];
  private activeAssistantByRun = new Map<string, AssistantMessageComponent>();
  /** After finalizeAssistant, late tool execution events can still arrive; keep the bubble to link tools. */
  private committedAssistantByRun = new Map<string, AssistantMessageComponent>();
  private runsWithTools = new Set<string>();
  private toolsExpanded = false;
  private showThinking = true;
  private hiddenThinkingLabel = 'Thinking...';
  private toolImageOptions: ToolExecutionOptions = {};
  private lastAssistantText = '';
  private lastStatusEntry: Container | null = null;
  private lastStatusText: Text | null = null;
  private workflowStatusByRunId = new Map<string, { entry: Container; text: Text }>();
  private entryRecords: ChatLogEntryRecord[] = [];
  private viewportRowsProvider: (() => number) | undefined;
  private historyViewDisplayIndex: number | null = null;
  private renderMode: CellRenderMode = 'compact';
  private readonly activeCells = new Set<Component>();
  private readonly committedCells = new Set<Component>();

  constructor(private readonly keybindings?: KeybindingsManager) {
    super();
    if (keybindings) {
      this.toolImageOptions.keybindings = keybindings;
    }
  }

  private append(component: Component, meta?: ChatLogEntryMeta, lifecycle: 'active' | 'committed' = 'committed'): void {
    this.addChild(component);
    (lifecycle === 'active' ? this.activeCells : this.committedCells).add(component);
    if (meta) {
      this.entryRecords.push({ component, ...meta });
    }
    this.applyRenderMode(component);
  }

  clearAll(): void {
    this.clear();
    this.toolById.clear();
    this.bashBlocks = [];
    this.compactionBlocks = [];
    this.branchBlocks = [];
    this.branchMessageBlocks = [];
    this.customBlocks = [];
    this.semanticCells.clear();
    this.assistantMessages = [];
    this.activeAssistantByRun.clear();
    this.committedAssistantByRun.clear();
    this.runsWithTools.clear();
    this.lastAssistantText = '';
    this.lastStatusEntry = null;
    this.lastStatusText = null;
    this.workflowStatusByRunId.clear();
    this.entryRecords = [];
    this.historyViewDisplayIndex = null;
    this.activeCells.clear();
    this.committedCells.clear();
  }

  private createAssistantMessage(message?: AgentMessage): AssistantMessageComponent {
    const component = new AssistantMessageComponent(message, {
      hideThinkingBlock: !this.showThinking,
      hiddenThinkingLabel: this.hiddenThinkingLabel,
    });
    this.assistantMessages.push(component);
    return component;
  }

  addSystem(text: string, meta?: ChatLogEntryMeta): void {
    const entry = new Container();
    entry.addChild(new Spacer(1));
    entry.addChild(new Text(theme.system(text), 1, 0));
    this.append(entry, meta);
  }

  addStatus(text: string): void {
    if (
      this.lastStatusEntry &&
      this.lastStatusText &&
      this.children[this.children.length - 1] === this.lastStatusEntry
    ) {
      this.lastStatusText.setText(theme.system(text));
      return;
    }

    const entry = new Container();
    const statusText = new Text(theme.system(text), 1, 0);
    entry.addChild(new Spacer(1));
    entry.addChild(statusText);
    this.lastStatusEntry = entry;
    this.lastStatusText = statusText;
    this.append(entry);
  }

  updateWorkflowRun(runId: string, text: string): void {
    const existing = this.workflowStatusByRunId.get(runId);
    if (existing) {
      existing.text.setText(theme.system(text));
      return;
    }

    const entry = new Container();
    const statusText = new Text(theme.system(text), 1, 0);
    entry.addChild(new Spacer(1));
    entry.addChild(statusText);
    this.workflowStatusByRunId.set(runId, { entry, text: statusText });
    this.append(entry);
  }

  addCompactionSummary(result: TuiCompactionResult): void {
    const component = new CompactionSummaryComponent(result, this.keybindings);
    component.setExpanded(this.toolsExpanded);
    this.compactionBlocks.push(component);
    this.append(component);
  }

  addBranchSummary(summary: TuiBranchSummary): void {
    const component = new BranchSummaryComponent(summary, this.keybindings);
    component.setExpanded(this.toolsExpanded);
    this.branchBlocks.push(component);
    this.append(component);
  }

  addBranchMessageSummary(summary: BranchMessageSummary): void {
    this.committedAssistantByRun.clear();
    const component = new BranchMessageSummaryComponent(summary, this.keybindings);
    component.setExpanded(this.toolsExpanded);
    this.branchMessageBlocks.push(component);
    this.append(component);
  }

  addCustomMessage(summary: CustomMessageSummary): void {
    this.committedAssistantByRun.clear();
    const component = new CustomMessageComponent(
      summary,
      this.customMessageRenderers.get(summary.customType),
    );
    component.setExpanded(this.toolsExpanded);
    this.customBlocks.push(component);
    this.append(component);
  }

  upsertSemanticCell(id: string, data: SemanticCellData): void {
    const existing = this.semanticCells.get(id);
    if (existing) {
      existing.update(data);
      existing.invalidate();
      return;
    }
    const component = new SemanticCellComponent(data);
    this.semanticCells.set(id, component);
    this.append(component);
  }

  setCustomMessageRenderer(customType: string, renderer: TuiMessageRenderer | undefined): void {
    if (renderer) {
      this.customMessageRenderers.set(customType, renderer);
    } else {
      this.customMessageRenderers.delete(customType);
    }
    for (const block of this.customBlocks) {
      if (block.matchesCustomType(customType)) {
        block.setRenderer(renderer);
      }
    }
  }

  addUser(text: string | unknown[], meta?: ChatLogEntryMeta): void {
    this.committedAssistantByRun.clear();
    this.append(new UserMessageComponent(text), meta);
  }

  /** Stream local `!command` output in a bordered block. */
  addBashExecution(
    command: string,
    ui: import('@earendil-works/pi-tui').TUI,
    excludeFromContext: boolean,
  ): BashExecutionComponent {
    this.committedAssistantByRun.clear();
    const component = new BashExecutionComponent(command, ui, excludeFromContext, this.keybindings);
    component.setExpanded(this.toolsExpanded);
    this.bashBlocks.push(component);
    this.append(component);
    return component;
  }

  /** Replay a completed shell execution from persisted transcript history. */
  addBashSummary(summary: BashSummary): void {
    this.committedAssistantByRun.clear();
    const component = new BashSummaryComponent(summary, this.keybindings);
    component.setExpanded(this.toolsExpanded);
    this.bashBlocks.push(component);
    this.append(component);
  }

  startAssistant(message: AgentMessage, runId: string): void {
    const text = assistantPlainText(message);
    if (text.trim()) this.lastAssistantText = text;
    const existing = this.activeAssistantByRun.get(runId);
    if (existing) {
      existing.updateContent(message);
      existing.setHasToolCalls(this.runsWithTools.has(runId));
      return;
    }
    const component = this.createAssistantMessage(message);
    component.setHasToolCalls(this.runsWithTools.has(runId));
    this.activeAssistantByRun.set(runId, component);
    this.append(component, undefined, 'active');
  }

  updateAssistant(message: AgentMessage, runId: string): void {
    const text = assistantPlainText(message);
    if (text.trim()) this.lastAssistantText = text;
    const existing = this.activeAssistantByRun.get(runId);
    if (!existing) {
      this.startAssistant(message, runId);
      return;
    }
    existing.updateContent(message);
    existing.setHasToolCalls(this.runsWithTools.has(runId));
  }

  finalizeAssistant(message: AgentMessage, runId: string, meta?: ChatLogEntryMeta): void {
    const text = assistantPlainText(message);
    if (text.trim()) this.lastAssistantText = text;
    const existing = this.activeAssistantByRun.get(runId);
    if (existing) {
      existing.updateContent(message);
      existing.setHasToolCalls(this.runsWithTools.has(runId));
      this.activeAssistantByRun.delete(runId);
      this.committedAssistantByRun.set(runId, existing);
      this.commitCell(existing);
      return;
    }
    const finalMessage = this.createAssistantMessage(message);
    finalMessage.setHasToolCalls(this.runsWithTools.has(runId));
    this.append(finalMessage, meta);
    if (text.trim()) {
      this.committedAssistantByRun.set(runId, finalMessage);
    }
  }

  dropAssistant(runId: string): void {
    const existing = this.activeAssistantByRun.get(runId);
    if (!existing) return;
    this.removeChild(existing);
    this.activeAssistantByRun.delete(runId);
    this.activeCells.delete(existing);
  }

  startTool(toolCallId: string, toolName: string, args: unknown, runId: string): void {
    const existing = this.toolById.get(toolCallId);
    if (existing) {
      existing.setArgs(args);
      return;
    }
    this.runsWithTools.add(runId);
    const component = new ToolExecutionComponent(toolName, toolCallId, args, {
      ...this.toolImageOptions,
    });
    component.setExpanded(this.toolsExpanded);
    this.toolById.set(toolCallId, component);

    const assistant = this.activeAssistantByRun.get(runId) ?? this.committedAssistantByRun.get(runId);
    assistant?.setHasToolCalls(true);
    this.append(component, undefined, 'active');
  }

  markToolExecutionStarted(toolCallId: string): void {
    const existing = this.toolById.get(toolCallId);
    if (!existing) return;
    existing.markExecutionStarted();
  }

  markToolArgsComplete(toolCallId: string): void {
    const existing = this.toolById.get(toolCallId);
    if (!existing) return;
    existing.setArgsComplete();
  }

  updateToolResult(toolCallId: string, result: AgentToolResult<any> | unknown, isError: boolean, isPartial = false): void {
    const existing = this.toolById.get(toolCallId);
    if (!existing) return;
    existing.updateResult(result, isPartial, isError);
    if (!isPartial) this.commitCell(existing);
  }

  updateToolDetails(toolCallId: string, details: unknown): void {
    const existing = this.toolById.get(toolCallId);
    if (!existing) return;
    existing.setPartialDetails(details);
  }

  updateToolArgs(toolCallId: string, args: unknown): void {
    const existing = this.toolById.get(toolCallId);
    if (!existing) return;
    existing.setArgs(args);
  }

  setToolsExpanded(expanded: boolean): void {
    this.toolsExpanded = expanded;
    for (const tool of this.toolById.values()) {
      tool.setExpanded(expanded);
    }
    for (const bash of this.bashBlocks) {
      bash.setExpanded(expanded);
    }
    for (const compaction of this.compactionBlocks) {
      compaction.setExpanded(expanded);
    }
    for (const branch of this.branchBlocks) {
      branch.setExpanded(expanded);
    }
    for (const branch of this.branchMessageBlocks) {
      branch.setExpanded(expanded);
    }
    for (const custom of this.customBlocks) {
      custom.setExpanded(expanded);
    }
  }

  setShowThinking(showThinking: boolean): void {
    this.showThinking = showThinking;
    for (const assistant of this.assistantMessages) {
      assistant.setHideThinkingBlock(!showThinking);
    }
  }

  setHiddenThinkingLabel(label?: string): void {
    this.hiddenThinkingLabel = label ?? 'Thinking...';
    for (const assistant of this.assistantMessages) {
      assistant.setHiddenThinkingLabel(this.hiddenThinkingLabel);
    }
  }

  setToolImageOptions(options: ToolExecutionOptions): void {
    this.toolImageOptions = { ...options, keybindings: this.keybindings };
    for (const tool of this.toolById.values()) {
      tool.setImageOptions(this.toolImageOptions);
    }
  }

  setRenderMode(mode: CellRenderMode): void {
    if (this.renderMode === mode) return;
    this.renderMode = mode;
    for (const child of this.children) this.applyRenderMode(child);
    this.invalidate();
  }

  getRenderMode(): CellRenderMode {
    return this.renderMode;
  }

  private applyRenderMode(component: Component): void {
    (component as Component & Partial<ModeAwareCell>).setRenderMode?.(this.renderMode);
  }

  getCellLifecycleCounts(): { active: number; committed: number } {
    return { active: this.activeCells.size, committed: this.committedCells.size };
  }

  private commitCell(component: Component): void {
    if (!this.activeCells.delete(component)) return;
    this.committedCells.add(component);
  }

  getLastAssistantText(): string {
    return this.lastAssistantText;
  }

  setViewportRowsProvider(provider: (() => number) | undefined): void {
    this.viewportRowsProvider = provider;
  }

  jumpToDisplayIndex(displayIndex: number): boolean {
    const target = this.findEntryRecord(displayIndex);
    if (!target) return false;
    this.historyViewDisplayIndex = target.displayIndex ?? null;
    return true;
  }

  jumpToLatest(): void {
    this.historyViewDisplayIndex = null;
  }

  getTimelineViewportState(): { mode: 'latest' } | { mode: 'history'; displayIndex: number } {
    if (this.historyViewDisplayIndex === null) return { mode: 'latest' };
    return { mode: 'history', displayIndex: this.historyViewDisplayIndex };
  }

  override render(width: number): string[] {
    const allLines: string[] = [];
    const ranges: Array<{ record: ChatLogEntryRecord; start: number; end: number }> = [];
    for (const child of this.children) {
      const start = allLines.length;
      const childLines = child.render(width);
      allLines.push(...childLines);
      const record = this.entryRecords.find((entry) => entry.component === child);
      if (record) {
        ranges.push({ record, start, end: allLines.length });
      }
    }

    if (this.historyViewDisplayIndex === null) return allLines;

    const target = this.findEntryRecord(this.historyViewDisplayIndex);
    const range = target
      ? ranges.find((candidate) => candidate.record.component === target.component)
      : undefined;
    if (!range) {
      this.historyViewDisplayIndex = null;
      return allLines;
    }

    const viewportRows = Math.max(8, Math.floor(this.viewportRowsProvider?.() ?? 24));
    const start = Math.max(0, range.start - 1);
    const end = Math.min(allLines.length, start + Math.max(1, viewportRows - 1));
    return [
      theme.dim('Viewing previous transcript - /timeline latest returns to live view.'),
      ...allLines.slice(start, end),
    ];
  }

  private findEntryRecord(displayIndex: number | null): ChatLogEntryRecord | undefined {
    if (displayIndex === null || !Number.isFinite(displayIndex)) return undefined;
    return this.entryRecords.find((entry) => entry.displayIndex === displayIndex);
  }
}

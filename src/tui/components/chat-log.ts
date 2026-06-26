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

const MAX_COMPONENTS = 180;

type ExpandableBlock = { setExpanded(expanded: boolean): void };

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
  private customMessageRenderers = new Map<string, TuiMessageRenderer>();
  private assistantMessages: AssistantMessageComponent[] = [];
  private streamingRuns = new Map<string, AssistantMessageComponent>();
  /** After finalizeAssistant, late tool execution events can still arrive; keep the bubble to link tools. */
  private assistantAnchorByRunId = new Map<string, AssistantMessageComponent>();
  private runsWithTools = new Set<string>();
  private toolsExpanded = false;
  private showThinking = true;
  private hiddenThinkingLabel = 'Thinking...';
  private toolImageOptions: ToolExecutionOptions = {};
  private lastAssistantText = '';
  private lastStatusEntry: Container | null = null;
  private lastStatusText: Text | null = null;
  private workflowStatusByRunId = new Map<string, { entry: Container; text: Text }>();

  constructor(private readonly keybindings?: KeybindingsManager) {
    super();
    if (keybindings) {
      this.toolImageOptions.keybindings = keybindings;
    }
  }

  private pruneOverflow(): void {
    while (this.children.length > MAX_COMPONENTS) {
      const oldest = this.children[0];
      if (!oldest) return;
      this.removeChild(oldest);
      this.dropReferences(oldest);
    }
  }

  private dropReferences(component: Component): void {
    for (const [id, tool] of this.toolById.entries()) {
      if (tool === component) this.toolById.delete(id);
    }
    for (const [runId, msg] of this.streamingRuns.entries()) {
      if (msg === component) this.streamingRuns.delete(runId);
    }
    for (const [runId, msg] of this.assistantAnchorByRunId.entries()) {
      if (msg === component) this.assistantAnchorByRunId.delete(runId);
    }
    this.bashBlocks = this.bashBlocks.filter((entry) => entry !== component);
    this.compactionBlocks = this.compactionBlocks.filter((entry) => entry !== component);
    this.branchBlocks = this.branchBlocks.filter((entry) => entry !== component);
    this.branchMessageBlocks = this.branchMessageBlocks.filter((entry) => entry !== component);
    this.customBlocks = this.customBlocks.filter((entry) => entry !== component);
    this.assistantMessages = this.assistantMessages.filter((entry) => entry !== component);
    if (this.lastStatusEntry === component) {
      this.lastStatusEntry = null;
      this.lastStatusText = null;
    }
    for (const [runId, status] of this.workflowStatusByRunId.entries()) {
      if (status.entry === component) this.workflowStatusByRunId.delete(runId);
    }
  }

  private append(component: Component): void {
    this.addChild(component);
    this.pruneOverflow();
  }

  clearAll(): void {
    this.clear();
    this.toolById.clear();
    this.bashBlocks = [];
    this.compactionBlocks = [];
    this.branchBlocks = [];
    this.branchMessageBlocks = [];
    this.customBlocks = [];
    this.assistantMessages = [];
    this.streamingRuns.clear();
    this.assistantAnchorByRunId.clear();
    this.runsWithTools.clear();
    this.lastAssistantText = '';
    this.lastStatusEntry = null;
    this.lastStatusText = null;
    this.workflowStatusByRunId.clear();
  }

  private createAssistantMessage(message?: AgentMessage): AssistantMessageComponent {
    const component = new AssistantMessageComponent(message, {
      hideThinkingBlock: !this.showThinking,
      hiddenThinkingLabel: this.hiddenThinkingLabel,
    });
    this.assistantMessages.push(component);
    return component;
  }

  addSystem(text: string): void {
    const entry = new Container();
    entry.addChild(new Spacer(1));
    entry.addChild(new Text(theme.system(text), 1, 0));
    this.append(entry);
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
    this.assistantAnchorByRunId.clear();
    const component = new BranchMessageSummaryComponent(summary, this.keybindings);
    component.setExpanded(this.toolsExpanded);
    this.branchMessageBlocks.push(component);
    this.append(component);
  }

  addCustomMessage(summary: CustomMessageSummary): void {
    this.assistantAnchorByRunId.clear();
    const component = new CustomMessageComponent(
      summary,
      this.customMessageRenderers.get(summary.customType),
    );
    component.setExpanded(this.toolsExpanded);
    this.customBlocks.push(component);
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

  addUser(text: string | unknown[]): void {
    this.assistantAnchorByRunId.clear();
    this.append(new UserMessageComponent(text));
  }

  /** Stream local `!command` output in a bordered block. */
  addBashExecution(
    command: string,
    ui: import('@earendil-works/pi-tui').TUI,
    excludeFromContext: boolean,
  ): BashExecutionComponent {
    this.assistantAnchorByRunId.clear();
    const component = new BashExecutionComponent(command, ui, excludeFromContext, this.keybindings);
    component.setExpanded(this.toolsExpanded);
    this.bashBlocks.push(component);
    this.append(component);
    return component;
  }

  /** Replay a completed shell execution from persisted transcript history. */
  addBashSummary(summary: BashSummary): void {
    this.assistantAnchorByRunId.clear();
    const component = new BashSummaryComponent(summary, this.keybindings);
    component.setExpanded(this.toolsExpanded);
    this.bashBlocks.push(component);
    this.append(component);
  }

  startAssistant(message: AgentMessage, runId: string): void {
    const text = assistantPlainText(message);
    if (text.trim()) this.lastAssistantText = text;
    const existing = this.streamingRuns.get(runId);
    if (existing) {
      existing.updateContent(message);
      existing.setHasToolCalls(this.runsWithTools.has(runId));
      return;
    }
    const component = this.createAssistantMessage(message);
    component.setHasToolCalls(this.runsWithTools.has(runId));
    this.streamingRuns.set(runId, component);
    this.append(component);
  }

  updateAssistant(message: AgentMessage, runId: string): void {
    const text = assistantPlainText(message);
    if (text.trim()) this.lastAssistantText = text;
    const existing = this.streamingRuns.get(runId);
    if (!existing) {
      this.startAssistant(message, runId);
      return;
    }
    existing.updateContent(message);
    existing.setHasToolCalls(this.runsWithTools.has(runId));
  }

  finalizeAssistant(message: AgentMessage, runId: string): void {
    const text = assistantPlainText(message);
    if (text.trim()) this.lastAssistantText = text;
    const existing = this.streamingRuns.get(runId);
    if (existing) {
      existing.updateContent(message);
      existing.setHasToolCalls(this.runsWithTools.has(runId));
      this.streamingRuns.delete(runId);
      this.assistantAnchorByRunId.set(runId, existing);
      return;
    }
    const finalMessage = this.createAssistantMessage(message);
    finalMessage.setHasToolCalls(this.runsWithTools.has(runId));
    this.append(finalMessage);
    if (text.trim()) {
      this.assistantAnchorByRunId.set(runId, finalMessage);
    }
  }

  dropAssistant(runId: string): void {
    const existing = this.streamingRuns.get(runId);
    if (!existing) return;
    this.removeChild(existing);
    this.streamingRuns.delete(runId);
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

    const assistant = this.streamingRuns.get(runId) ?? this.assistantAnchorByRunId.get(runId);
    assistant?.setHasToolCalls(true);
    this.addChild(component);
    this.pruneOverflow();
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

  getLastAssistantText(): string {
    return this.lastAssistantText;
  }
}

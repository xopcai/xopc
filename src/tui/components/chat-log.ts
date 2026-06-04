import type { Component } from '@earendil-works/pi-tui';
import { Container, Spacer, Text } from '@earendil-works/pi-tui';

import { BashExecutionComponent } from './bash-execution.js';
import { theme } from '../theme.js';
import { AssistantMessageComponent } from './assistant-message.js';
import { ToolExecutionComponent } from './tool-execution.js';
import { UserMessageComponent } from './user-message.js';

const MAX_COMPONENTS = 180;

export class ChatLog extends Container {
  private toolById = new Map<string, ToolExecutionComponent>();
  private bashBlocks: BashExecutionComponent[] = [];
  private streamingRuns = new Map<string, AssistantMessageComponent>();
  /** After finalizeAssistant, late tool_start can still arrive; keep the bubble to insert tools above. */
  private assistantAnchorByRunId = new Map<string, AssistantMessageComponent>();
  private toolsExpanded = false;

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
  }

  private append(component: Component): void {
    this.addChild(component);
    this.pruneOverflow();
  }

  clearAll(): void {
    this.clear();
    this.toolById.clear();
    this.bashBlocks = [];
    this.streamingRuns.clear();
    this.assistantAnchorByRunId.clear();
  }

  addSystem(text: string): void {
    const entry = new Container();
    entry.addChild(new Spacer(1));
    entry.addChild(new Text(theme.system(text), 1, 0));
    this.append(entry);
  }

  addUser(text: string): void {
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
    const component = new BashExecutionComponent(command, ui, excludeFromContext);
    component.setExpanded(this.toolsExpanded);
    this.bashBlocks.push(component);
    this.append(component);
    return component;
  }

  startAssistant(text: string, runId: string): void {
    const existing = this.streamingRuns.get(runId);
    if (existing) {
      existing.setText(text);
      return;
    }
    const component = new AssistantMessageComponent(text);
    this.streamingRuns.set(runId, component);
    this.append(component);
  }

  updateAssistant(text: string, runId: string): void {
    const existing = this.streamingRuns.get(runId);
    if (!existing) {
      this.startAssistant(text, runId);
      return;
    }
    existing.setText(text);
  }

  finalizeAssistant(text: string, runId: string): void {
    const existing = this.streamingRuns.get(runId);
    if (existing) {
      existing.setText(text);
      this.streamingRuns.delete(runId);
      this.assistantAnchorByRunId.set(runId, existing);
      return;
    }
    const finalMessage = new AssistantMessageComponent(text);
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
    const component = new ToolExecutionComponent(toolName, args);
    component.setExpanded(this.toolsExpanded);
    this.toolById.set(toolCallId, component);

    const assistant =
      this.streamingRuns.get(runId) ?? this.assistantAnchorByRunId.get(runId);
    if (assistant) {
      // Streamed assistant text is updated in place from the start of the turn; tools
      // arrive later from SSE but should appear above the conversational reply (like the web UI).
      this.removeChild(assistant);
      this.addChild(component);
      this.addChild(assistant);
    } else {
      this.addChild(component);
    }
    this.pruneOverflow();
  }

  updateToolResult(toolCallId: string, result: string, isError: boolean): void {
    const existing = this.toolById.get(toolCallId);
    if (!existing) return;
    existing.setResult(result, isError);
  }

  setToolsExpanded(expanded: boolean): void {
    this.toolsExpanded = expanded;
    for (const tool of this.toolById.values()) {
      tool.setExpanded(expanded);
    }
    for (const bash of this.bashBlocks) {
      bash.setExpanded(expanded);
    }
  }
}

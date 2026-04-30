import type { Component } from '@mariozechner/pi-tui';
import { Container, Spacer, Text } from '@mariozechner/pi-tui';

import { theme } from '../theme.js';
import { AssistantMessageComponent } from './assistant-message.js';
import { ToolExecutionComponent } from './tool-execution.js';
import { UserMessageComponent } from './user-message.js';

const MAX_COMPONENTS = 180;

export class ChatLog extends Container {
  private toolById = new Map<string, ToolExecutionComponent>();
  private streamingRuns = new Map<string, AssistantMessageComponent>();
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
  }

  private append(component: Component): void {
    this.addChild(component);
    this.pruneOverflow();
  }

  clearAll(): void {
    this.clear();
    this.toolById.clear();
    this.streamingRuns.clear();
  }

  addSystem(text: string): void {
    const entry = new Container();
    entry.addChild(new Spacer(1));
    entry.addChild(new Text(theme.system(text), 1, 0));
    this.append(entry);
  }

  addUser(text: string): void {
    this.append(new UserMessageComponent(text));
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
      return;
    }
    this.append(new AssistantMessageComponent(text));
  }

  dropAssistant(runId: string): void {
    const existing = this.streamingRuns.get(runId);
    if (!existing) return;
    this.removeChild(existing);
    this.streamingRuns.delete(runId);
  }

  startTool(toolCallId: string, toolName: string, args: unknown): void {
    const existing = this.toolById.get(toolCallId);
    if (existing) {
      existing.setArgs(args);
      return;
    }
    const component = new ToolExecutionComponent(toolName, args);
    component.setExpanded(this.toolsExpanded);
    this.toolById.set(toolCallId, component);
    this.append(component);
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
  }
}

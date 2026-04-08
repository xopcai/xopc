/**
 * Pluggable memory provider (Phase 2). Builtin curated files use `BuiltinMemoryStore` + `curated_memory`;
 * external providers add instructions, prefetch/sync, and optional tools.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';

export interface MemoryProviderInitOptions {
  workspace?: string;
  agentWorkspace?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export interface MemoryProvider {
  readonly name: string;

  isAvailable(): boolean;

  initialize(sessionId: string, options?: MemoryProviderInitOptions): Promise<void> | void;

  /** Static text merged into system prompt (external providers only; builtin uses curated snapshot separately). */
  systemPromptBlock(): string;

  prefetch(query: string, options?: { sessionId?: string }): Promise<string>;

  queuePrefetch(query: string, options?: { sessionId?: string }): void;

  syncTurn(userContent: string, assistantContent: string, options?: { sessionId?: string }): void;

  getToolSchemas(): AgentTool[];

  /** JSON string result for tool calls routed by name (when not using inline AgentTool.execute only). */
  handleToolCall(toolName: string, args: Record<string, unknown>): Promise<string>;

  shutdown(): Promise<void> | void;

  onTurnStart?(turnNumber: number, message: string, metadata?: Record<string, unknown>): void;
  onSessionEnd?(messages: unknown[]): void;
  onPreCompress?(messages: unknown[]): string;
  onMemoryWrite?(action: 'add' | 'replace' | 'remove', target: 'memory' | 'user', content: string): void;
}

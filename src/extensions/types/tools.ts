/**
 * Extension System - Tool Types
 *
 * Tool definitions re-exported from @mariozechner/pi-agent-core.
 */

import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@mariozechner/pi-agent-core';

// Re-export core tool types
export type { AgentTool, AgentToolResult, AgentToolUpdateCallback };

// ============================================================================
// Tool Execution Lifecycle Events
// ============================================================================

export interface ToolExecutionStartEvent {
  toolName: string;
  toolCallId: string;
  params: Record<string, unknown>;
  agentId?: string;
  sessionKey?: string;
}

export interface ToolExecutionUpdateEvent<TDetails = unknown> {
  toolName: string;
  toolCallId: string;
  update: AgentToolResult<TDetails>;
  agentId?: string;
  sessionKey?: string;
}

export interface ToolExecutionEndEvent<TDetails = unknown> {
  toolName: string;
  toolCallId: string;
  result?: AgentToolResult<TDetails>;
  error?: Error;
  durationMs?: number;
  agentId?: string;
  sessionKey?: string;
}

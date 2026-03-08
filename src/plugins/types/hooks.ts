/**
 * Plugin System - Hook Types
 * 
 * Hook events, handlers, and context types.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';

// Re-export AgentMessage for use in hook system
export type { AgentMessage };

// ============================================================================
// Hook Event Types
// ============================================================================

export type PluginHookEvent = 
  // Existing hooks
  | 'before_agent_start'
  | 'agent_end'
  | 'before_compaction'
  | 'after_compaction'
  | 'message_received'
  | 'message_sending'
  | 'message_sent'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'session_start'
  | 'session_end'
  | 'gateway_start'
  | 'gateway_stop'
  // Phase 1: Enhanced hooks
  | 'context'
  | 'input'
  | 'turn_start'
  | 'turn_end'
  // Phase 2: Tool execution lifecycle
  | 'tool_execution_start'
  | 'tool_execution_update'
  | 'tool_execution_end';

export type PluginHookHandler = (event: unknown, context?: unknown) => unknown | Promise<unknown>;

export interface HookOptions {
  priority?: number;
  once?: boolean;
}

// ============================================================================
// Phase 1: Enhanced Hook Event Types
// ============================================================================

export interface ContextEvent {
  messages: Array<{ role: string; content: string }>;
  agentId?: string;
  sessionKey?: string;
}

export interface ContextResult {
  messages: Array<{ role: string; content: string }>;
}

export interface InputEvent {
  text: string;
  images?: string[];
  channelId?: string;
  from?: string;
}

export interface InputResult {
  action: 'continue' | 'handled' | 'blocked';
  text?: string;
  images?: string[];
  response?: string;
  skipAgent?: boolean;
}

export interface TurnEvent {
  turnId: string;
  prompt?: string;
  agentId?: string;
  sessionKey?: string;
}

export interface TurnResult {
  context?: string;
  skipTurn?: boolean;
}

// ============================================================================
// Existing Hook Context Types
// ============================================================================

export interface HookContext {
  timestamp?: Date;
  pluginId?: string;
  sessionKey?: string;
  agentId?: string;
}

export interface BeforeAgentStartContext extends HookContext {
  prompt: string;
  messages?: unknown[];
}

export interface BeforeAgentStartResult {
  systemPrompt?: string;
  prependContext?: string;
}

export interface AgentEndContext extends HookContext {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
}

export interface BeforeCompactionContext extends HookContext {
  messageCount: number;
  tokenCount?: number;
}

export interface AfterCompactionContext extends HookContext {
  messageCount: number;
  tokenCount?: number;
  compactedCount: number;
}

export interface MessageReceivedContext extends HookContext {
  channelId: string;
  from: string;
  content: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

export interface MessageSendingContext extends HookContext {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MessageSendingResult {
  content?: string;
  cancel?: boolean;
  cancelReason?: string;
}

export interface MessageSentContext extends HookContext {
  to: string;
  content: string;
  success: boolean;
  error?: string;
}

export interface BeforeToolCallContext extends HookContext {
  toolName: string;
  params: Record<string, unknown>;
}

export interface BeforeToolCallResult {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
}

export interface AfterToolCallContext extends HookContext {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface SessionStartContext extends HookContext {
  sessionId: string;
  resumedFrom?: string;
}

export interface SessionEndContext extends HookContext {
  sessionId: string;
  reason?: 'completed' | 'error' | 'timeout' | 'user_request';
}

export interface GatewayStartContext extends HookContext {
  port: number;
  host: string;
}

export interface GatewayStopContext extends HookContext {
  port: number;
  reason?: string;
}

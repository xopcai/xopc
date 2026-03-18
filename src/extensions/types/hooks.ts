/**
 * Extension System - Hook Types
 * 
 * Hook events, handlers, and context types.
 *  Strongly typed hook system with execution modes.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';

// Re-export AgentMessage for use in hook system
export type { AgentMessage };

// ============================================================================
// Hook Event Types ( Strongly Typed)
// ============================================================================

export type ExtensionHookEvent = 
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
  //  Enhanced hooks
  | 'context'
  | 'input'
  | 'turn_start'
  | 'turn_end'
  //  Tool execution lifecycle
  | 'tool_execution_start'
  | 'tool_execution_update'
  | 'tool_execution_end'
  //  LLM Observation hooks
  | 'before_model_resolve'
  | 'before_prompt_build'
  | 'llm_input'
  | 'llm_output'
  //  Inbound claim hook
  | 'inbound_claim'
  //  Reset hook
  | 'before_reset'
  //  Message write hook
  | 'before_message_write'
  //  Subagent hooks
  | 'subagent_start'
  | 'subagent_end'
  | 'subagent_error'
  | 'subagent_result';

// ============================================================================
// Hook Execution Modes 
// ============================================================================

/**
 * Hook execution mode determines how handlers are processed:
 * - void: Fire-and-forget, parallel execution (for notifications)
 * - modifying: Sequential execution, results merge (for modifications)
 * - claiming: First handler to return handled:true wins (for exclusive handling)
 */
export type HookExecutionMode = 'void' | 'modifying' | 'claiming';

/**
 * Maps each hook event to its execution mode
 */
export const HOOK_EXECUTION_MODES: Record<ExtensionHookEvent, HookExecutionMode> = {
  // Void: Fire-and-forget, parallel execution
  'message_received': 'void',
  'message_sent': 'void',
  'agent_end': 'void',
  'llm_input': 'void',
  'llm_output': 'void',
  'after_tool_call': 'void',
  'session_start': 'void',
  'session_end': 'void',
  'gateway_start': 'void',
  'gateway_stop': 'void',
  'before_compaction': 'void',
  'after_compaction': 'void',
  'turn_start': 'void',
  'turn_end': 'void',
  'tool_execution_start': 'void',
  'tool_execution_update': 'void',
  'tool_execution_end': 'void',
  'subagent_start': 'void',
  'subagent_end': 'void',
  'subagent_error': 'void',
  'before_reset': 'void',
  
  // Modifying: Sequential execution, results merge
  'before_agent_start': 'modifying',
  'before_model_resolve': 'modifying',
  'before_prompt_build': 'modifying',
  'message_sending': 'modifying',
  'before_tool_call': 'modifying',
  'context': 'modifying',
  'input': 'modifying',
  'before_message_write': 'modifying',
  'subagent_result': 'modifying',
  
  // Claiming: First handler with handled:true wins
  'inbound_claim': 'claiming',
};

// ============================================================================
// ExtensionHookHandler Type (Weak - for backward compatibility)
// ============================================================================

export type ExtensionHookHandler = (event: unknown, context?: unknown) => unknown | Promise<unknown>;

export interface HookOptions {
  priority?: number;
  once?: boolean;
}

// ============================================================================
//  Strongly Typed Hook Handler Map
// ============================================================================

// Forward declarations for circular references
export interface HookAgentContext {
  timestamp?: Date;
  extensionId?: string;
  sessionKey?: string;
  agentId?: string;
}

// LLM Observation Hook Types
export interface HookBeforeModelResolveEvent {
  prompt: string;
  model?: string;
  provider?: string;
}

export interface HookBeforeModelResolveResult {
  modelOverride?: string;
  providerOverride?: string;
}

export interface HookBeforePromptBuildEvent {
  prompt: string;
  messages?: Array<{ role: string; content: string }>;
}

export interface HookBeforePromptBuildResult {
  prompt?: string;
  prependContext?: string;
}

export interface HookLlmInputEvent {
  runId: string;
  provider: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  messages?: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

export interface HookLlmOutputEvent {
  runId: string;
  provider: string;
  model: string;
  content: string;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  finishReason?: string;
}

// Inbound Claim Hook Types
export interface HookInboundClaimEvent {
  channelId: string;
  from: string;
  content: string;
  timestamp?: Date;
}

export interface HookInboundClaimResult {
  handled: boolean;
  response?: string;
}

// Before Reset Hook Types
export interface HookBeforeResetEvent {
  sessionKey: string;
  reason?: 'user_request' | 'timeout' | 'error' | 'manual';
}

export interface HookBeforeResetResult {
  allowReset: boolean;
  reason?: string;
}

// Before Message Write Hook Types
export interface HookBeforeMessageWriteEvent {
  channelId: string;
  to: string;
  content: string;
}

export interface HookBeforeMessageWriteResult {
  content?: string;
  cancel?: boolean;
  reason?: string;
}

// Subagent Hook Types
export interface HookSubagentStartEvent {
  subagentId: string;
  task: string;
  context?: Record<string, unknown>;
}

export interface HookSubagentEndEvent {
  subagentId: string;
  task: string;
  result?: string;
  error?: string;
  durationMs?: number;
}

export interface HookSubagentErrorEvent {
  subagentId: string;
  task: string;
  error: string;
}

export interface HookSubagentResultEvent {
  subagentId: string;
  task: string;
  result: string;
  metadata?: Record<string, unknown>;
}

// Turn Hook Types
export interface HookTurnStartEvent {
  turnId: string;
  prompt?: string;
  agentId?: string;
  sessionKey?: string;
}

export interface HookTurnEndEvent {
  turnId: string;
  response?: string;
  error?: string;
  durationMs?: number;
}

// Tool Execution Hook Types
export interface HookToolExecutionStartEvent {
  toolName: string;
  params: Record<string, unknown>;
  executionId: string;
}

export interface HookToolExecutionUpdateEvent {
  toolName: string;
  executionId: string;
  progress?: number;
  message?: string;
}

export interface HookToolExecutionEndEvent {
  toolName: string;
  executionId: string;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

// ============================================================================
// Strongly Typed Handler Map 
// ============================================================================

/**
 * Strongly typed handler map - each hook has precise event/result types
 */
export type HookHandlerMap = {
  // Agent lifecycle
  before_agent_start: (
    event: BeforeAgentStartContext,
    ctx: HookAgentContext,
  ) => Promise<BeforeAgentStartResult | void> | BeforeAgentStartResult | void;
  
  before_model_resolve: (
    event: HookBeforeModelResolveEvent,
    ctx: HookAgentContext,
  ) => Promise<HookBeforeModelResolveResult | void> | HookBeforeModelResolveResult | void;
  
  before_prompt_build: (
    event: HookBeforePromptBuildEvent,
    ctx: HookAgentContext,
  ) => Promise<HookBeforePromptBuildResult | void> | HookBeforePromptBuildResult | void;
  
  llm_input: (
    event: HookLlmInputEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  llm_output: (
    event: HookLlmOutputEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  agent_end: (
    event: AgentEndContext,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  // Compaction
  before_compaction: (
    event: BeforeCompactionContext,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  after_compaction: (
    event: AfterCompactionContext,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  // Messages
  message_received: (
    event: MessageReceivedContext,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  message_sending: (
    event: MessageSendingContext,
    ctx: HookAgentContext,
  ) => Promise<MessageSendingResult | void> | MessageSendingResult | void;
  
  message_sent: (
    event: MessageSentContext,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  inbound_claim: (
    event: HookInboundClaimEvent,
    ctx: HookAgentContext,
  ) => Promise<HookInboundClaimResult | void> | HookInboundClaimResult | void;
  
  before_message_write: (
    event: HookBeforeMessageWriteEvent,
    ctx: HookAgentContext,
  ) => Promise<HookBeforeMessageWriteResult | void> | HookBeforeMessageWriteResult | void;
  
  // Tools
  before_tool_call: (
    event: BeforeToolCallContext,
    ctx: HookAgentContext,
  ) => Promise<BeforeToolCallResult | void> | BeforeToolCallResult | void;
  
  after_tool_call: (
    event: AfterToolCallContext,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  tool_execution_start: (
    event: HookToolExecutionStartEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  tool_execution_update: (
    event: HookToolExecutionUpdateEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  tool_execution_end: (
    event: HookToolExecutionEndEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  // Session
  session_start: (
    event: SessionStartContext,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  session_end: (
    event: SessionEndContext,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  // Gateway
  gateway_start: (
    event: GatewayStartContext,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  gateway_stop: (
    event: GatewayStopContext,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  // Enhanced (xopcbot-specific)
  context: (
    event: ContextEvent,
    ctx: HookAgentContext,
  ) => Promise<ContextResult | void> | ContextResult | void;
  
  input: (
    event: InputEvent,
    ctx: HookAgentContext,
  ) => Promise<InputResult | void> | InputResult | void;
  
  // Turn lifecycle
  turn_start: (
    event: HookTurnStartEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  turn_end: (
    event: HookTurnEndEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  // Reset
  before_reset: (
    event: HookBeforeResetEvent,
    ctx: HookAgentContext,
  ) => Promise<HookBeforeResetResult | void> | HookBeforeResetResult | void;
  
  // Subagent
  subagent_start: (
    event: HookSubagentStartEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  subagent_end: (
    event: HookSubagentEndEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  subagent_error: (
    event: HookSubagentErrorEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
  
  subagent_result: (
    event: HookSubagentResultEvent,
    ctx: HookAgentContext,
  ) => Promise<void> | void;
};

// ============================================================================
// Existing Hook Context Types (for backward compatibility)
// ============================================================================

export interface HookContext {
  timestamp?: Date;
  extensionId?: string;
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

// ============================================================================
// Enhanced Hook Event Types
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

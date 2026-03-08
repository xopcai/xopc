/**
 * Extension System - Tool Types
 * 
 * Tool definitions and execution types.
 */

// ============================================================================
// Legacy Tool (backward compatible)
// ============================================================================

export interface ExtensionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<string>;
}

export interface ExtensionToolContext {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  sandboxed?: boolean;
}

// ============================================================================
// Enhanced Tool (Phase 2)
// ============================================================================

export interface EnhancedTool<TParams = unknown, TDetails = unknown> {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (
    toolCallId: string,
    params: TParams,
    signal: AbortSignal | undefined,
    onUpdate: ((update: ToolUpdate<TDetails>) => void) | undefined,
    ctx: ExtensionContext
  ) => Promise<ToolResult<TDetails>>;
}

export interface TSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface ToolResult<TDetails = unknown> {
  content: Array<{ type: 'text' | 'image'; text?: string; data?: string }>;
  details?: TDetails;
  isError?: boolean;
}

export interface ToolUpdate<TDetails = unknown> {
  content: Array<{ type: 'text' | 'image'; text?: string; data?: string }>;
  details?: TDetails;
}

export interface ExtensionContext {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
}

// ============================================================================
// Tool Execution Lifecycle (Phase 2)
// ============================================================================

export interface ToolExecutionStartEvent {
  toolName: string;
  toolCallId: string;
  params: Record<string, unknown>;
  agentId?: string;
  sessionKey?: string;
}

export interface ToolExecutionUpdateEvent {
  toolName: string;
  toolCallId: string;
  update: ToolUpdate;
  agentId?: string;
  sessionKey?: string;
}

export interface ToolExecutionEndEvent {
  toolName: string;
  toolCallId: string;
  result?: ToolResult;
  error?: Error;
  durationMs?: number;
  agentId?: string;
  sessionKey?: string;
}

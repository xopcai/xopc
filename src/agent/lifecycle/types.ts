import type { AgentContext } from '../service.js';

export type LifecycleEventType =
  | 'conversation_start'
  | 'llm_request'
  | 'llm_response'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'conversation_end'
  | 'session_start'
  | 'session_end';

export interface LifecycleEventData<T = unknown> {
  type: LifecycleEventType;
  sessionKey: string;
  payload: T;
  timestamp: number;
}

export interface LifecycleHandler<T = unknown> {
  name: string;
  handle(event: LifecycleEventData<T>, context: AgentContext): Promise<void>;
}

export interface ConversationStartPayload {
  userMessage: string;
  model: string;
}

export interface LLMRequestPayload {
  requestNumber: number;
  maxRequests: number;
  messageCount: number;
}

export interface LLMResponsePayload {
  response: string;
  usage?: {
    input: number;
    output: number;
    total: number;
    cost?: number;
  };
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

export interface ToolCallStartPayload {
  toolName: string;
  arguments: Record<string, unknown>;
  attemptNumber: number;
  maxAttempts: number;
}

export interface ToolCallEndPayload {
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface ConversationEndPayload {
  totalTurns: number;
  totalToolCalls: number;
  endReason: 'completed' | 'error' | 'interrupted' | 'timeout';
}

export type InterruptionReason =
  | { type: 'max_requests_per_turn'; limit: number; count: number }
  | { type: 'max_tool_failures'; limit: number; errors: Record<string, number> }
  | { type: 'user_abort' }
  | { type: 'timeout'; durationMs: number };

export interface InterruptPayload {
  reason: InterruptionReason;
  message: string;
}

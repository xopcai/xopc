/**
 * Plugin Hook System
 */

import type {
  PluginHookEvent,
  PluginRegistry,
} from './types.js';

// ============================================================================
// Hook Event Types
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
  messageCount: number;
  durationMs?: number;
}

export interface GatewayStartContext extends HookContext {
  port: number;
  host: string;
}

export interface GatewayStopContext extends HookContext {
  reason?: string;
}

// ============================================================================
// Hook Handler Map
// ============================================================================

export type HookHandlerMap = {
  before_agent_start: (
    event: BeforeAgentStartContext,
    ctx: HookContext,
  ) => Promise<BeforeAgentStartResult | void> | BeforeAgentStartResult | void;
  
  agent_end: (
    event: AgentEndContext,
    ctx: HookContext,
  ) => Promise<void> | void;
  
  before_compaction: (
    event: BeforeCompactionContext,
    ctx: HookContext,
  ) => Promise<void> | void;
  
  after_compaction: (
    event: AfterCompactionContext,
    ctx: HookContext,
  ) => Promise<void> | void;
  
  message_received: (
    event: MessageReceivedContext,
    ctx: HookContext,
  ) => Promise<void> | void;
  
  message_sending: (
    event: MessageSendingContext,
    ctx: HookContext,
  ) => Promise<MessageSendingResult | void> | MessageSendingResult | void;
  
  message_sent: (
    event: MessageSentContext,
    ctx: HookContext,
  ) => Promise<void> | void;
  
  before_tool_call: (
    event: BeforeToolCallContext,
    ctx: HookContext,
  ) => Promise<BeforeToolCallResult | void> | BeforeToolCallResult | void;
  
  after_tool_call: (
    event: AfterToolCallContext,
    ctx: HookContext,
  ) => Promise<void> | void;
  
  session_start: (
    event: SessionStartContext,
    ctx: HookContext,
  ) => Promise<void> | void;
  
  session_end: (
    event: SessionEndContext,
    ctx: HookContext,
  ) => Promise<void> | void;
  
  gateway_start: (
    event: GatewayStartContext,
    ctx: HookContext,
  ) => Promise<void> | void;
  
  gateway_stop: (
    event: GatewayStopContext,
    ctx: HookContext,
  ) => Promise<void> | void;
};

// ============================================================================
// Hook Runner
// ============================================================================

export interface HookRunnerOptions {
  /** If true, errors in hooks will be caught and logged instead of thrown */
  catchErrors?: boolean;
  /** Default logger */
  logger?: HookLogger;
}

export interface HookLogger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export class HookRunner {
  private registry: PluginRegistry;
  private options: HookRunnerOptions;

  constructor(registry: PluginRegistry, options?: HookRunnerOptions) {
    this.registry = registry;
    this.options = options || {};
  }

  /**
   * Execute hooks for a specific event
   */
  async runHooks<K extends PluginHookEvent>(
    event: K,
    eventData: unknown,
    context: HookContext,
  ): Promise<{ success: boolean; results: unknown[] }> {
    const handlers = this.registry.getHooks(event);
    const results: unknown[] = [];

    for (const handler of handlers) {
      try {
        const result = await handler(eventData, context);
        results.push({ success: true, result });
      } catch (error) {
        results.push({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        if (!this.options.catchErrors) {
          throw error;
        }
        
        this.options.logger?.error?.(
          `Hook error in ${event}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return { success: true, results };
  }

  /**
   * Execute hooks and return modified event data
   */
  async runHooksWithResult<K extends PluginHookEvent>(
    event: K,
    eventData: BeforeAgentStartContext,
    context: HookContext,
  ): Promise<BeforeAgentStartContext> {
    const handlers = this.registry.getHooks(event);
    let modifiedData = { ...eventData };

    for (const handler of handlers) {
      try {
        const result = await handler(modifiedData, context);
        if (result && typeof result === 'object') {
          // Merge modifications
          modifiedData = { ...modifiedData, ...result };
        }
      } catch (error) {
        if (!this.options.catchErrors) {
          throw error;
        }
        this.options.logger?.warn?.(`Hook modification error: ${error}`);
      }
    }

    return modifiedData;
  }

  /**
   * Execute before_tool_call hooks and potentially block the call
   */
  async runBeforeToolCall(
    toolName: string,
    params: Record<string, unknown>,
    context: HookContext,
  ): Promise<{ allowed: boolean; params?: Record<string, unknown>; reason?: string }> {
    const event: BeforeToolCallContext = {
      ...context,
      toolName,
      params,
      timestamp: new Date(),
    };

    const handlers = this.registry.getHooks('before_tool_call');
    let modifiedParams = { ...params };
    let blocked = false;
    let blockReason: string | undefined;

    for (const handler of handlers) {
      try {
        const result = await handler(event, context);
        if (result && typeof result === 'object') {
          const typedResult = result as BeforeToolCallResult;
          if (typedResult.block) {
            blocked = true;
            blockReason = typedResult.blockReason;
          }
          if (typedResult.params) {
            modifiedParams = typedResult.params;
          }
        }
      } catch (error) {
        if (!this.options.catchErrors) {
          throw error;
        }
        this.options.logger?.warn?.(`before_tool_call hook error: ${error}`);
      }
    }

    if (blocked) {
      return { allowed: false, reason: blockReason };
    }

    return { allowed: true, params: modifiedParams };
  }

  /**
   * Execute message_sending hooks and potentially cancel or modify
   */
  async runMessageSending(
    to: string,
    content: string,
    context: HookContext,
  ): Promise<{ send: boolean; content?: string; reason?: string }> {
    const event: MessageSendingContext = {
      ...context,
      to,
      content,
      timestamp: new Date(),
    };

    const handlers = this.registry.getHooks('message_sending');
    let modifiedContent = content;
    let cancelled = false;
    let cancelReason: string | undefined;

    for (const handler of handlers) {
      try {
        const result = await handler(event, context);
        if (result && typeof result === 'object') {
          const typedResult = result as MessageSendingResult;
          if (typedResult.cancel) {
            cancelled = true;
            cancelReason = typedResult.cancelReason;
          }
          if (typedResult.content) {
            modifiedContent = typedResult.content;
          }
        }
      } catch (error) {
        if (!this.options.catchErrors) {
          throw error;
        }
        this.options.logger?.warn?.(`message_sending hook error: ${error}`);
      }
    }

    if (cancelled) {
      return { send: false, reason: cancelReason };
    }

    return { send: true, content: modifiedContent };
  }
}

// ============================================================================
// Hook Utilities
// ============================================================================

export function createHookContext(overrides?: Partial<HookContext>): HookContext {
  return {
    timestamp: new Date(),
    ...overrides,
  };
}

export function isHookEvent(value: string): value is PluginHookEvent {
  const hookEvents: PluginHookEvent[] = [
    'before_agent_start',
    'agent_end',
    'before_compaction',
    'after_compaction',
    'message_received',
    'message_sending',
    'message_sent',
    'before_tool_call',
    'after_tool_call',
    'session_start',
    'session_end',
    'gateway_start',
    'gateway_stop',
  ];
  return hookEvents.includes(value as PluginHookEvent);
}

/**
 * Extension Hook System
 */

import type {
  ExtensionHookEvent,
  HookAgentContext as HookContext,
  AgentMessage,
  BeforeAgentStartContext,
  BeforeToolCallContext,
  BeforeToolCallResult,
  MessageSendingContext,
  MessageSendingResult,
  MessageSentContext,
} from './types/hooks.js';

import { ExtensionRegistryImpl as ExtensionRegistry } from './loader.js';
import { HOOK_EXECUTION_MODES } from './types/hooks.js';

// ============================================================================
// Hook Runner Options
// ============================================================================

export interface HookRunnerOptions {
  catchErrors?: boolean;
  logger?: HookLogger;
}

export interface HookLogger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

// ============================================================================
// Extension Hook Runner
// ============================================================================

export class ExtensionHookRunner {
  private registry: ExtensionRegistry;
  private options: HookRunnerOptions;

  constructor(registry: ExtensionRegistry, options?: HookRunnerOptions) {
    this.registry = registry;
    this.options = options || {};
  }

  getRegistry(): ExtensionRegistry {
    return this.registry;
  }

  async runHooks<K extends ExtensionHookEvent>(
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

  async runHooksWithResult<K extends ExtensionHookEvent>(
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

  async runMessageSending(
    to: string,
    content: string,
    context: HookContext,
    opts?: { channel?: string },
  ): Promise<{ send: boolean; content?: string; reason?: string }> {
    const event: MessageSendingContext = {
      ...context,
      to,
      content,
      channel: opts?.channel,
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

  async runMessageSent(
    to: string,
    content: string,
    success: boolean,
    error: string | undefined,
    context: HookContext,
    opts?: { channel?: string },
  ): Promise<void> {
    const event: MessageSentContext = {
      ...context,
      to,
      content,
      success,
      error,
      channel: opts?.channel,
      timestamp: new Date(),
    };

    const handlers = this.registry.getHooks('message_sent');
    for (const handler of handlers) {
      try {
        await handler(event, context);
      } catch (err) {
        if (!this.options.catchErrors) {
          throw err;
        }
        this.options.logger?.warn?.(
          `message_sent hook error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  //  Enhanced Hook Methods
  async runContextHook(
    messages: AgentMessage[],
    context?: HookContext,
  ): Promise<{ messages: AgentMessage[]; modified: boolean }> {
    const handlers = this.registry.getHooks('context');
    
    if (handlers.length === 0) {
      return { messages, modified: false };
    }

    let currentMessages = [...messages];
    let modified = false;

    const event = {
      messages: currentMessages,
      timestamp: new Date(),
      ...context,
    };

    for (const handler of handlers) {
      try {
        const result = await handler(event, context || {});
        
        if (result && typeof result === 'object' && 'messages' in result) {
          const typedResult = result as { messages: AgentMessage[] };
          currentMessages = typedResult.messages as AgentMessage[];
          event.messages = currentMessages;
          modified = true;
        }
      } catch (error) {
        if (!this.options.catchErrors) {
          throw error;
        }
        this.options.logger?.warn?.(
          `context hook error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return { messages: currentMessages as AgentMessage[], modified };
  }

  async runInputHook(
    text: string,
    images: Array<{ type: string; data: string; mimeType?: string }> | undefined,
    source: string,
    context?: HookContext,
  ): Promise<{
    text: string;
    images: Array<{ type: string; data: string; mimeType?: string }> | undefined;
    action: 'continue' | 'handled';
    skipAgent: boolean;
    response?: string;
  }> {
    const handlers = this.registry.getHooks('input');

    if (handlers.length === 0) {
      return {
        text,
        images,
        action: 'continue',
        skipAgent: false,
      };
    }

    let currentText = text;
    let currentImages = images;

    const event = {
      text: currentText,
      images: currentImages,
      source,
      timestamp: new Date(),
      ...context,
    };

    for (const handler of handlers) {
      try {
        const result = await handler(event, context || {});

        if (result && typeof result === 'object') {
          const typedResult = result as {
            action: 'continue' | 'handled' | 'transform';
            text?: string;
            images?: Array<{ type: string; data: string; mimeType?: string }>;
            response?: string;
          };

          if (typedResult.action === 'transform') {
            if (typedResult.text !== undefined) {
              currentText = typedResult.text;
              event.text = currentText;
            }
            if (typedResult.images !== undefined) {
              currentImages = typedResult.images;
              event.images = currentImages;
            }
            continue;
          }

          if (typedResult.action === 'handled') {
            return {
              text: currentText,
              images: currentImages,
              action: 'handled',
              skipAgent: true,
              response: typedResult.response,
            };
          }
        }
      } catch (error) {
        if (!this.options.catchErrors) {
          throw error;
        }
        this.options.logger?.warn?.(
          `input hook error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      text: currentText,
      images: currentImages,
      action: 'continue',
      skipAgent: false,
    };
  }

  //  Three-Mode Hook Execution
  async runVoidHook<K extends ExtensionHookEvent>(
    hookName: K,
    eventData: unknown,
    context: HookContext,
  ): Promise<void> {
    const handlers = this.registry.getHooks(hookName);
    if (handlers.length === 0) return;

    await Promise.allSettled(
      handlers.map(async (handler) => {
        try {
          await handler(eventData, context);
        } catch (error) {
          if (!this.options.catchErrors) {
            throw error;
          }
          this.options.logger?.warn?.(
            `Void hook error in ${hookName}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })
    );
  }

  async runModifyingHook<K extends ExtensionHookEvent, R = unknown>(
    hookName: K,
    eventData: unknown,
    context: HookContext,
    merge?: (current: R, next: R) => R,
  ): Promise<R | undefined> {
    const handlers = this.registry.getHooks(hookName);
    if (handlers.length === 0) return undefined;

    let result: R | undefined;

    for (const handler of handlers) {
      try {
        const handlerResult = await handler(eventData, context);
        if (handlerResult && typeof handlerResult === 'object') {
          if (merge && result) {
            result = merge(result, handlerResult as R);
          } else if (!result) {
            result = handlerResult as R;
          }
        }
      } catch (error) {
        if (!this.options.catchErrors) {
          throw error;
        }
        this.options.logger?.warn?.(
          `Modifying hook error in ${hookName}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return result;
  }

  async runClaimingHook<K extends ExtensionHookEvent>(
    hookName: K,
    eventData: unknown,
    context: HookContext,
  ): Promise<{ handled: boolean; result?: unknown }> {
    const handlers = this.registry.getHooks(hookName);

    for (const handler of handlers) {
      try {
        const result = await handler(eventData, context);
        
        if (result && typeof result === 'object' && 'handled' in result) {
          const typedResult = result as { handled: boolean };
          if (typedResult.handled) {
            return { handled: true, result };
          }
        }
      } catch (error) {
        if (!this.options.catchErrors) {
          throw error;
        }
        this.options.logger?.warn?.(
          `Claiming hook error in ${hookName}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return { handled: false };
  }

  async runHooksByMode<K extends ExtensionHookEvent>(
    hookName: K,
    eventData: unknown,
    context: HookContext,
  ): Promise<{ success: boolean; result?: unknown }> {
    const mode = HOOK_EXECUTION_MODES[hookName];

    switch (mode) {
      case 'void':
        await this.runVoidHook(hookName, eventData, context);
        return { success: true };

      case 'modifying':
        const modifyingResult = await this.runModifyingHook(hookName, eventData, context);
        return { success: true, result: modifyingResult };

      case 'claiming':
        const claimingResult = await this.runClaimingHook(hookName, eventData, context);
        return { success: true, result: claimingResult };

      default:
        const legacyResult = await this.runHooks(hookName, eventData, context);
        return { success: legacyResult.success };
    }
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

export function isHookEvent(value: string): value is ExtensionHookEvent {
  const hookEvents: ExtensionHookEvent[] = [
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
    'context',
    'input',
    'turn_start',
    'turn_end',
    'tool_execution_start',
    'tool_execution_update',
    'tool_execution_end',
    'before_model_resolve',
    'before_prompt_build',
    'llm_input',
    'llm_output',
    'inbound_claim',
    'before_reset',
    'before_message_write',
    'subagent_start',
    'subagent_end',
    'subagent_error',
    'subagent_result',
  ];
  return hookEvents.includes(value as ExtensionHookEvent);
}

// Re-export HookContext for backward compatibility
export type { HookContext };

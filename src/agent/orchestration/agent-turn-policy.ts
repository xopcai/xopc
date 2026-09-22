import type {
  AfterToolCallContext,
  AgentTurnContext,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '@earendil-works/pi-agent-core';
import type { JsonObject } from '@earendil-works/pi-ai';
import { dataOperationCalls } from '../data-acquisition/schema.js';

export interface AgentTurnPolicy {
  reset(): void;
  beforeToolCall(
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined>;
  afterToolCall(context: AfterToolCallContext): Promise<undefined>;
  shouldStopAfterTurn(context: AgentTurnContext): boolean;
}

export interface AgentTurnPolicyOptions {
  maxTurns?: number;
  maxToolFailures?: number;
  resolveToolLimit?: (
    toolName: string,
    args: unknown,
  ) => { id: string; maxCalls: number } | undefined;
  authorizeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
}

/** One user-visible run policy. A fresh instance is created for every embedded run. */
export function createAgentTurnPolicy(options: AgentTurnPolicyOptions): AgentTurnPolicy {
  const toolCalls = new Map<string, number>();
  let toolFailures = 0;
  let assistantTurns = 0;

  return {
    reset() {
      toolCalls.clear();
      toolFailures = 0;
      assistantTurns = 0;
    },

    async beforeToolCall(context, signal) {
      const contexts = context.toolCall.name === 'data_batch'
        ? [context, ...dataOperationCalls(context.args).map((call, index) => ({
            ...context, args: call.args,
            toolCall: {
              ...context.toolCall,
              id: `${context.toolCall.id}:${index}`,
              name: call.name,
              arguments: call.args as JsonObject,
            },
          }))]
        : [context];
      for (const item of contexts) {
        signal?.throwIfAborted();
        const limit = options.resolveToolLimit?.(item.toolCall.name, item.args);
        if (limit) {
          const count = (toolCalls.get(limit.id) ?? 0) + 1;
          toolCalls.set(limit.id, count);
          if (count > limit.maxCalls) return { block: true, terminate: true, reason: `${limit.id} exceeded its per-turn call limit.` };
        }
        const decision = await options.authorizeToolCall?.(item, signal);
        if (decision?.block) return decision;
      }
      return undefined;
    },

    async afterToolCall(context) {
      if (context.isError) toolFailures += 1;
      return undefined;
    },

    shouldStopAfterTurn(_context) {
      assistantTurns += 1;
      return Boolean(
        (options.maxTurns && assistantTurns >= options.maxTurns)
        || (options.maxToolFailures && toolFailures >= options.maxToolFailures),
      );
    },
  };
}

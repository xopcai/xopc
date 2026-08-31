import type {
  AgentMessage,
  AfterToolCallContext,
  BeforeToolCallContext,
  BeforeToolCallResult,
  ShouldStopAfterTurnContext,
} from '@earendil-works/pi-agent-core';

export interface AgentTurnPolicy {
  reset(): void;
  beforeToolCall(
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined>;
  afterToolCall(context: AfterToolCallContext): Promise<undefined>;
  shouldStopAfterTurn(context: ShouldStopAfterTurnContext): boolean;
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

function assistantMessageCount(messages: readonly AgentMessage[]): number {
  return messages.filter((message) => message.role === 'assistant').length;
}

/** One user-visible run policy. A fresh instance is created for every embedded run. */
export function createAgentTurnPolicy(options: AgentTurnPolicyOptions): AgentTurnPolicy {
  const toolCalls = new Map<string, number>();
  let toolFailures = 0;

  return {
    reset() {
      toolCalls.clear();
      toolFailures = 0;
    },

    async beforeToolCall(context, signal) {
      const limit = options.resolveToolLimit?.(context.toolCall.name, context.args);
      if (limit) {
        const count = (toolCalls.get(limit.id) ?? 0) + 1;
        toolCalls.set(limit.id, count);
        if (count > limit.maxCalls) {
          return {
            block: true,
            terminate: true,
            reason: `${limit.id} exceeded its per-turn call limit.`,
          };
        }
      }
      return options.authorizeToolCall?.(context, signal);
    },

    async afterToolCall(context) {
      if (context.isError) toolFailures += 1;
      return undefined;
    },

    shouldStopAfterTurn(context) {
      return Boolean(
        (options.maxTurns && assistantMessageCount(context.newMessages) >= options.maxTurns)
        || (options.maxToolFailures && toolFailures >= options.maxToolFailures),
      );
    },
  };
}

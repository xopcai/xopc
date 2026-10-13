import type { AgentTurnPolicy, AgentTurnPolicyOptions } from './agent-turn-policy.js';

export const DELEGATION_BUDGETS = {
  light: { maxToolCalls: 15, maxTotalTokens: 50_000, timeoutMs: 120_000 },
  standard: { maxToolCalls: 30, maxTotalTokens: 100_000, timeoutMs: 300_000 },
  deep: { maxToolCalls: 60, maxTotalTokens: 200_000, timeoutMs: 600_000 },
} as const;

export type DelegationBudgetTier = keyof typeof DELEGATION_BUDGETS;
export type DelegationStopReason = 'completed' | 'tool_calls' | 'total_tokens' | 'model_turns'
  | 'tool_failures' | 'timeout' | 'cancelled' | 'parent_policy' | 'credit_budget' | 'runtime_error' | 'verification';

export function resolveDelegationBudget(tier: DelegationBudgetTier = 'standard', maxIterations?: number, timeoutMs?: number) {
  const preset = DELEGATION_BUDGETS[tier];
  return { tier, limits: {
    maxToolCalls: Math.min(60, Math.max(1, Math.floor(maxIterations ?? preset.maxToolCalls))),
    maxTotalTokens: preset.maxTotalTokens,
    maxModelTurns: Math.min(60, Math.max(1, Math.floor(maxIterations ?? preset.maxToolCalls))) + 1,
    maxToolFailures: 5,
    timeoutMs: Math.min(timeoutMs ?? preset.timeoutMs, preset.timeoutMs),
  } };
}

/** Reserve the last 20% for one tool-free handoff, without bypassing hard limits. */
export function createDelegationBudgetPolicy(budget: ReturnType<typeof resolveDelegationBudget>,
  options: { isComplete?: () => boolean; authorizeToolCall?: AgentTurnPolicyOptions['authorizeToolCall'] },
  now = Date.now) {
  const startedAt = now();
  const usage = { toolCalls: 0, totalTokens: 0, modelTurns: 0, toolFailures: 0, elapsedMs: 0 };
  const limits = budget.limits;
  let stopReason: DelegationStopReason | undefined;
  let stopMessage: string | undefined;
  let handoffReason: DelegationStopReason | undefined;
  let handoffRequested = false;
  let continuation: string | undefined;
  let handoffRequestStarted = false;
  const reasonAt = (ratio: number): DelegationStopReason | undefined => {
    if (usage.totalTokens >= limits.maxTotalTokens * ratio) return 'total_tokens';
    if (now() - startedAt >= limits.timeoutMs * ratio) return 'timeout';
    if (usage.toolCalls >= limits.maxToolCalls * ratio) return 'tool_calls';
    if (usage.modelTurns >= limits.maxModelTurns * ratio) return 'model_turns';
    if (usage.toolFailures >= limits.maxToolFailures * ratio) return 'tool_failures';
    return undefined;
  };
  const handoff = () => `Delegation budget is approaching its ${handoffReason} limit. Do not call more tools. Return a concise handoff now: findings with file/line or source evidence, incomplete work, and precise next steps (including unread ranges). Do not claim the task is complete.`;
  const policy: AgentTurnPolicy = {
    reset() {},
    beforeModelRequest(signal) {
      signal?.throwIfAborted();
      const hard = reasonAt(1);
      if (hard || stopReason) {
        stopReason ??= hard;
        return stopMessage ?? `Delegation stopped: ${stopReason}.`;
      }
      if (handoffRequested) {
        if (handoffRequestStarted) {
          stopReason = handoffReason;
          return 'Delegation handoff already attempted; no additional model request is permitted.';
        }
        handoffRequestStarted = true;
      }
      return undefined;
    },
    async beforeToolCall(context, signal) {
      signal?.throwIfAborted();
      if (options.isComplete?.()) return { block: true, reason: 'The delegated result is already complete.' };
      const hard = reasonAt(1);
      if (hard) {
        stopReason = hard;
        return { block: true, terminate: true, reason: `Sub-agent budget exhausted: ${hard}.` };
      }
      if (handoffRequested) return { block: true, reason: handoff() };
      // The generic turn policy expands data_batch into its individual operations.
      if (context.toolCall.name !== 'data_batch') usage.toolCalls++;
      const decision = await options.authorizeToolCall?.(context, signal);
      if (decision?.block && decision.terminate) { stopReason = 'parent_policy'; stopMessage = decision.reason; }
      return decision;
    },
    async afterToolCall(context) { if (context.isError) usage.toolFailures++; return undefined; },
    shouldStopAfterTurn(context) {
      usage.modelTurns++;
      if (options.isComplete?.()) return true;
      const hard = reasonAt(1);
      if (hard || stopReason) { stopReason ??= hard; return true; }
      if (handoffRequested) { stopReason = handoffReason; return true; }
      const near = reasonAt(0.8);
      if (near && context.toolResults.length) {
        handoffReason = near;
        handoffRequested = true;
        continuation = handoff();
      }
      return false;
    },
    takeContinuationMessage() { const message = continuation; continuation = undefined; return message; },
  };
  return { policy, addTokens(tokens: number) { usage.totalTokens += Math.max(0, tokens); },
    stop(reason: DelegationStopReason, message?: string) { stopReason = reason; stopMessage = message; },
    snapshot() { return { ...budget, usage: { ...usage, elapsedMs: now() - startedAt },
      stopReason, stopMessage, handoffRequested, handoffReason }; } };
}

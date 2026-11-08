/**
 * When the LLM stream completes with stopReason "error" (e.g. undici "fetch failed"
 * to the provider API), pi-agent-core does not throw — it appends an error assistant
 * message. This module detects transient network-style failures and retries the turn
 * via Agent.continue() after stripping the failed assistant message.
 */

import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';

import { isTransientProviderErrorMessage } from '../../providers/model-response.js';
import { isContextOverflowError } from './context-overflow.js';
import { canResumeAfterModelFailure } from './turn-recovery.js';

export function isTransientLlmErrorMessage(message: string): boolean {
  return isTransientProviderErrorMessage(message);
}

export type LlmFailureKind = 'transient_network' | 'context_overflow' | 'aborted' | 'permanent';

export function classifyLlmFailure(message: string): LlmFailureKind {
  const normalized = message.trim().toLowerCase();
  if (normalized === 'aborted' || normalized.includes('aborterror') || normalized === 'request was aborted' || normalized === 'the operation was aborted') return 'aborted';
  if (isContextOverflowError(message)) return 'context_overflow';
  if (isTransientLlmErrorMessage(message)) return 'transient_network';
  return 'permanent';
}

export function getLastAssistantMessage(messages: AgentMessage[]): AgentMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return messages[i];
    }
  }
  return undefined;
}

/** Raw provider/LLM error from the last failed assistant message, if any. */
export function getAssistantTurnErrorMessage(agent: Agent): string | undefined {
  const last = getLastAssistantMessage(agent.state.messages);
  if (!last) return undefined;
  const stopReason = (last as { stopReason?: string }).stopReason;
  if (stopReason !== 'error' && stopReason !== 'aborted') return undefined;
  const errMsg = (last as { errorMessage?: string }).errorMessage;
  if (typeof errMsg === 'string' && errMsg.trim()) return errMsg.trim();
  return undefined;
}

/** After waitForIdle + transient retries, true if the last assistant turn ended in error. */
export function isAssistantTurnFailed(agent: Agent): boolean {
  const last = getLastAssistantMessage(agent.state.messages);
  if (!last) {
    return true;
  }
  return (last as { stopReason?: string }).stopReason === 'error';
}

/** Provider reported an aborted stream; the host signal determines whether the run was cancelled. */
export function isAssistantTurnAborted(agent: Agent): boolean {
  const last = getLastAssistantMessage(agent.state.messages);
  if (!last) {
    return false;
  }
  return (last as { stopReason?: string }).stopReason === 'aborted';
}

/**
 * Remove trailing assistant messages that ended in error/aborted (typically one).
 */
export function stripTrailingErrorAssistantMessages(messages: AgentMessage[]): AgentMessage[] {
  const out = [...messages];
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last.role !== 'assistant') {
      break;
    }
    const sr = (last as { stopReason?: string }).stopReason;
    if (sr === 'error' || sr === 'aborted') {
      out.pop();
      continue;
    }
    break;
  }
  return out;
}

export interface RetryTransientTurnOptions {
  /** Extra turns after a failed assistant message (default 2). */
  maxContinues?: number;
  /** Initial deterministic backoff. Each later retry doubles it. */
  baseDelayMs?: number;
  signal?: AbortSignal;
  conversationId: string;
  onRetry?: () => void;
  onRetryScheduled?: (attempt: number, maxAttempts: number, delayMs: number) => void;
  /** A request may throw before an assistant error message is emitted. */
  initialError?: unknown;
  /** Retry an unsubmitted request; callers must continue once input is appended. */
  retryRequest?: () => Promise<void>;
  shouldRetry?: () => boolean;
  budget?: { continues: number };
  log: {
    warn: (obj: Record<string, unknown>, msg: string) => void;
  };
}

/** A completed model response ends a consecutive failure streak, including tool-use responses. */
export function recordLlmRetryOutcome(budget: { continues: number }, stopReason: string): void {
  if (stopReason === 'stop' || stopReason === 'toolUse') budget.continues = 0;
}

async function waitForRetryDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (delayMs <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * After waitForIdle(), call this to optionally re-run the last user turn when the
 * assistant message only contains a transient provider/network error.
 */
export async function maybeRetryTurnAfterTransientLlmFailure(
  agent: Agent,
  options: RetryTransientTurnOptions,
): Promise<void> {
  const maxContinues = options.maxContinues ?? 2;
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_000);
  const budget = options.budget ?? { continues: 0 };
  let thrownError = options.initialError;

  while (budget.continues < maxContinues && options.shouldRetry?.() !== false) {
    const last = getLastAssistantMessage(agent.state.messages);
    if (!last && thrownError === undefined) {
      return;
    }
    const sr = (last as { stopReason?: string } | undefined)?.stopReason;
    if (thrownError === undefined && sr !== 'error' && sr !== 'aborted') {
      return;
    }
    const errMsg = thrownError !== undefined
      ? thrownError instanceof Error ? thrownError.message : String(thrownError)
      : String((last as { errorMessage?: string }).errorMessage || '');
    const failureKind = sr === 'aborted' ? 'aborted' : classifyLlmFailure(errMsg);
    // An upstream abort is recoverable only when the host can prove the run is still live.
    const providerAborted = failureKind === 'aborted' && options.signal !== undefined && !options.signal.aborted;
    if (failureKind !== 'transient_network' && !providerAborted) {
      options.log.warn(
        { conversationId: options.conversationId, errorMessage: errMsg, failureKind },
        'Assistant turn ended with error (not retrying as transient)',
      );
      if (thrownError !== undefined) throw thrownError;
      return;
    }
    const trimmed = stripTrailingErrorAssistantMessages(agent.state.messages);
    const failedMessages = agent.state.messages.slice(trimmed.length);
    const hasUnconfirmedCalls = failedMessages.some(message => message.role === 'assistant'
      && Array.isArray(message.content) && message.content.some(block => block.type === 'toolCall'));
    if (hasUnconfirmedCalls || !canResumeAfterModelFailure(trimmed)) {
      options.log.warn({ conversationId: options.conversationId, errorMessage: errMsg, failureKind,
        phase: 'model_request_recovery', recoveryBlockedReason: 'unconfirmed_tool_outcome',
        continueAttempts: budget.continues }, 'Model recovery stopped because a tool outcome is unconfirmed');
      if (thrownError !== undefined) throw thrownError;
      return;
    }

    const continues = ++budget.continues;
    const rateLimited = /429|rate.limit|too many requests/i.test(errMsg);
    const serverDelay = /retry[- ]after\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|s|seconds)?/i.exec(errMsg);
    const requestedDelay = serverDelay ? Number(serverDelay[1]) * (serverDelay[2] === 'ms' ? 1 : 1000) : 0;
    const retryDelayMs = Math.min(60_000, Math.max(requestedDelay,
      (rateLimited && options.baseDelayMs === undefined ? 5_000 : baseDelayMs) * (2 ** (continues - 1))));
    options.log.warn(
      {
        conversationId: options.conversationId,
        errorMessage: errMsg,
        failureKind,
        phase: 'model_request_recovery',
        hostSignalAborted: options.signal?.aborted ?? false,
        continueAttempt: continues,
        maxContinues,
        retryDelayMs,
      },
      'LLM request failed with a transient network error; retrying the same turn. If this persists, check outbound HTTPS to the provider API and HTTP(S)_PROXY.',
    );

    options.onRetryScheduled?.(continues, maxContinues, retryDelayMs);
    await waitForRetryDelay(retryDelayMs, options.signal);
    options.signal?.throwIfAborted();
    options.onRetry?.();
    agent.state.messages = trimmed;
    thrownError = undefined;
    try {
      if (options.retryRequest) await options.retryRequest();
      else await agent.continue();
      await agent.waitForIdle();
    } catch (error) {
      thrownError = error;
    }
  }
  if (thrownError !== undefined) throw thrownError;
  const errorMessage = getAssistantTurnErrorMessage(agent);
  if (budget.continues >= maxContinues && errorMessage) {
    options.log.warn({ conversationId: options.conversationId, errorMessage,
      phase: 'model_request_recovery', recoveryBlockedReason: 'retry_budget_exhausted',
      continueAttempts: budget.continues, maxContinues }, 'Model recovery stopped after consecutive retry failures');
  }
}

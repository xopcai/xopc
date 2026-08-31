/**
 * When the LLM stream completes with stopReason "error" (e.g. undici "fetch failed"
 * to the provider API), pi-agent-core does not throw — it appends an error assistant
 * message. This module detects transient network-style failures and retries the turn
 * via Agent.continue() after stripping the failed assistant message.
 */

import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';

import { isContextOverflowError } from './context-overflow.js';

const TRANSIENT_LLM_ERROR_SUBSTRINGS = [
  'fetch failed',
  'econnreset',
  'econnrefused',
  'enotfound',
  'socket hang up',
  'getaddrinfo',
  'networkerror',
  'etimedout',
  'certificate',
  'ssl',
  'tls',
];

export function isTransientLlmErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return TRANSIENT_LLM_ERROR_SUBSTRINGS.some((s) => lower.includes(s));
}

export type LlmFailureKind = 'transient_network' | 'context_overflow' | 'aborted' | 'permanent';

export function classifyLlmFailure(message: string): LlmFailureKind {
  const normalized = message.trim().toLowerCase();
  if (normalized === 'aborted' || normalized.includes('aborterror')) return 'aborted';
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
  if (stopReason !== 'error') return undefined;
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

/** User or client aborted the assistant turn — do not try another model. */
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
  sessionKey: string;
  log: {
    warn: (obj: Record<string, unknown>, msg: string) => void;
  };
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
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 300);
  let continues = 0;

  while (continues < maxContinues) {
    const last = getLastAssistantMessage(agent.state.messages);
    if (!last) {
      return;
    }
    const sr = (last as { stopReason?: string }).stopReason;
    if (sr !== 'error') {
      return;
    }
    const errMsg = String((last as { errorMessage?: string }).errorMessage || '');
    const failureKind = classifyLlmFailure(errMsg);
    if (failureKind !== 'transient_network') {
      options.log.warn(
        { sessionKey: options.sessionKey, errorMessage: errMsg, failureKind },
        'Assistant turn ended with error (not retrying as transient)',
      );
      return;
    }

    continues += 1;
    const retryDelayMs = baseDelayMs * (2 ** (continues - 1));
    options.log.warn(
      {
        sessionKey: options.sessionKey,
        errorMessage: errMsg,
        failureKind,
        continueAttempt: continues,
        maxContinues,
        retryDelayMs,
      },
      'LLM request failed with a transient network error; retrying the same turn. If this persists, check outbound HTTPS to the provider API and HTTP(S)_PROXY.',
    );

    await waitForRetryDelay(retryDelayMs, options.signal);
    const trimmed = stripTrailingErrorAssistantMessages(agent.state.messages);
    agent.state.messages = trimmed;
    await agent.continue();
    await agent.waitForIdle();
  }
}

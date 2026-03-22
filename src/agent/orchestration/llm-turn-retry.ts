/**
 * When the LLM stream completes with stopReason "error" (e.g. undici "fetch failed"
 * to the provider API), pi-agent-core does not throw — it appends an error assistant
 * message. This module detects transient network-style failures and retries the turn
 * via Agent.continue() after stripping the failed assistant message.
 */

import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core';

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

function getLastAssistantMessage(messages: AgentMessage[]): AgentMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return messages[i];
    }
  }
  return undefined;
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
  sessionKey: string;
  log: {
    warn: (obj: Record<string, unknown>, msg: string) => void;
  };
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
    if (!isTransientLlmErrorMessage(errMsg)) {
      options.log.warn(
        { sessionKey: options.sessionKey, errorMessage: errMsg },
        'Assistant turn ended with error (not retrying as transient)',
      );
      return;
    }

    continues += 1;
    options.log.warn(
      {
        sessionKey: options.sessionKey,
        errorMessage: errMsg,
        continueAttempt: continues,
        maxContinues,
      },
      'LLM request failed with a transient network error; retrying the same turn. If this persists, check outbound HTTPS to the provider API and HTTP(S)_PROXY.',
    );

    const trimmed = stripTrailingErrorAssistantMessages(agent.state.messages);
    agent.replaceMessages(trimmed);
    await agent.continue();
    await agent.waitForIdle();
  }
}

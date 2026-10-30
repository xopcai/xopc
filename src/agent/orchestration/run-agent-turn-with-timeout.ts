/**
 * Race an agent turn against a wall clock; on timeout, abort the in-flight turn
 * and await {@link Agent.waitForIdle} so a subsequent {@link Agent.prompt} is allowed.
 */

import type { Agent } from '@earendil-works/pi-agent-core';

import { AgentRunDeadlineError } from './run-termination.js';
import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';

/** Minimum per-turn timeout (1 minute). */
export const MIN_AGENT_TURN_TIMEOUT_MS = 60_000;

/** Maximum configurable per-turn timeout (24 hours). */
export const MAX_AGENT_TURN_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** Default per-turn timeout (4 hours). */
export const DEFAULT_AGENT_TURN_TIMEOUT_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_AGENT_ABORT_GRACE_MS = 5_000;

export class AgentTurnUnsettledError extends AgentRunDeadlineError {
  constructor(readonly timeoutMs: number, readonly abortGraceMs: number) {
    super(`Agent turn timed out after ${timeoutMs / 1000}s and did not settle within ${abortGraceMs / 1000}s`);
    this.name = 'AgentTurnUnsettledError';
  }
}

export function isAgentTurnUnsettledError(err: unknown): err is AgentTurnUnsettledError {
  return err instanceof AgentTurnUnsettledError;
}

export function resolveAgentTurnTimeoutMs(config?: Config, conversationId?: string): number {
  if (!config) return DEFAULT_AGENT_TURN_TIMEOUT_MS;
  const configured = resolveEffectiveAgentConfigForSession(conversationId).config.runtime.timeoutMs;
  if (!configured) return DEFAULT_AGENT_TURN_TIMEOUT_MS;
  return Math.min(MAX_AGENT_TURN_TIMEOUT_MS, Math.max(MIN_AGENT_TURN_TIMEOUT_MS, configured));
}

export function isAgentTurnTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('Agent turn timed out after');
}

export async function runAgentTurnWithTimeout(
  agent: Agent,
  runTurn: () => Promise<void>,
  timeoutMs: number,
  options: { abortGraceMs?: number; timeoutExtensionMs?: () => number; onTimeout?: (reason: AgentRunDeadlineError) => void } = {},
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    let extended = false;
    let effectiveTimeoutMs = timeoutMs;
    const expire = () => {
      const extensionMs = !extended ? options.timeoutExtensionMs?.() ?? 0 : 0;
      if (Number.isFinite(extensionMs) && extensionMs > 0) {
        extended = true;
        effectiveTimeoutMs += extensionMs;
        timeoutId = setTimeout(expire, extensionMs);
        return;
      }
      const reason = new AgentRunDeadlineError(`Agent turn timed out after ${effectiveTimeoutMs / 1000}s`);
      options.onTimeout?.(reason);
      reject(reason);
    };
    timeoutId = setTimeout(expire, timeoutMs);
  });
  const runTurnPromise = Promise.resolve().then(runTurn);

  try {
    await Promise.race([
      runTurnPromise.finally(() => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }),
      timeoutPromise,
    ]);
  } catch (err) {
    if (isAgentTurnTimeoutError(err)) {
      agent.abort();
      const abortGraceMs = options.abortGraceMs ?? DEFAULT_AGENT_ABORT_GRACE_MS;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled([
            runTurnPromise,
            agent.waitForIdle(),
          ]),
          new Promise<never>((_, reject) => {
            graceTimer = setTimeout(
              () => reject(new AgentTurnUnsettledError(timeoutMs, abortGraceMs)),
              abortGraceMs,
            );
          }),
        ]);
      } finally {
        if (graceTimer !== undefined) clearTimeout(graceTimer);
      }
    }
    throw err;
  }
}

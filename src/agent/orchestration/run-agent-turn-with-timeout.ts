/**
 * Race an agent turn against a wall clock; on timeout, abort the in-flight turn
 * and await {@link Agent.waitForIdle} so a subsequent {@link Agent.prompt} is allowed.
 */

import type { Agent } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentManifestForSession } from '../../config/agent-profile.js';

/** Minimum per-turn timeout (1 minute). */
export const MIN_AGENT_TURN_TIMEOUT_MS = 60_000;

/** Maximum per-turn timeout (4 hours), aligned with `maxTaskDurationMs` schema cap. */
export const MAX_AGENT_TURN_TIMEOUT_MS = 4 * 60 * 60 * 1000;

/** Default per-turn timeout (30 minutes). */
export const DEFAULT_AGENT_TURN_TIMEOUT_MS = 30 * 60 * 1000;

export function resolveAgentTurnTimeoutMs(config?: Config, sessionKey?: string): number {
  if (!config) return DEFAULT_AGENT_TURN_TIMEOUT_MS;
  const configured = resolveEffectiveAgentManifestForSession(config, sessionKey).runtime?.timeoutMs;
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
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Agent turn timed out after ${timeoutMs / 1000}s`)),
      timeoutMs,
    );
  });

  try {
    await Promise.race([
      runTurn().finally(() => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }),
      timeoutPromise,
    ]);
  } catch (err) {
    if (isAgentTurnTimeoutError(err)) {
      agent.abort();
      await agent.waitForIdle();
    }
    throw err;
  }
}

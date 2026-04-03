/**
 * Race an agent turn against a wall clock; on timeout, abort the in-flight turn
 * and await {@link Agent.waitForIdle} so a subsequent {@link Agent.prompt} is allowed.
 */

import type { Agent } from '@mariozechner/pi-agent-core';

export const AGENT_TURN_TIMEOUT_MS = 120_000;

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

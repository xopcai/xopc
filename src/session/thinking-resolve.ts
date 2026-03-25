/**
 * Resolve effective thinking level: request override > session store > agent default.
 */

import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import type { SessionConfigStore } from './config-store.js';
import { resolveThinkingLevel } from './config-store.js';
import { normalizeThinkLevel, type ThinkLevel } from '../agent/transcript/thinking-types.js';

const FALLBACK: ThinkingLevel = 'medium';

/**
 * @param requestOverride - Raw value from HTTP/API (e.g. Web pill); wins over persisted session when valid.
 */
export async function resolveEffectiveThinkingLevel(
  sessionConfigStore: SessionConfigStore,
  sessionKey: string,
  requestOverride?: string | null,
  agentDefault?: ThinkLevel,
): Promise<ThinkingLevel> {
  const fromRequest = normalizeThinkLevel(requestOverride ?? undefined);
  if (fromRequest !== undefined) {
    return fromRequest as ThinkingLevel;
  }

  const fromSession = await resolveThinkingLevel(sessionConfigStore, sessionKey, agentDefault);
  if (fromSession !== undefined) {
    return fromSession as ThinkingLevel;
  }

  const def = agentDefault ?? FALLBACK;
  return def as ThinkingLevel;
}

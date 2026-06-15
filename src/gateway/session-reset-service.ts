import type { AgentService } from '../agent/service.js';
import { abortEmbeddedRun } from '../agent/embedded/runs.js';
import { retireSessionMcpRuntimeForSessionKey } from '../agent/mcp/bundle-mcp-tools.js';
import type { SessionIndex } from '../session/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SessionReset');

export type SessionResetDeps = {
  sessionIndex: SessionIndex;
  getAgentService: () => AgentService;
};

export type SessionResetResult =
  | { ok: true; sessionId: string; previousSessionId?: string }
  | { ok: false; error: string };

/**
 * Reset a session in place: archive the current transcript, assign a new
 * `sessionId`, keep the session key and persisted overrides (model/thinking in
 * SQLite `session_config`, thinking/verbose on the session row).
 */
export async function performSessionReset(
  sessionKey: string,
  deps: SessionResetDeps,
): Promise<SessionResetResult> {
  const key = sessionKey.trim();
  if (!key) {
    return { ok: false, error: 'Session key required' };
  }

  await abortEmbeddedRun(key);

  const outcome = await deps.sessionIndex.resetSession(key);
  if (!outcome) {
    return { ok: false, error: 'Session not found' };
  }

  try {
    const agent = deps.getAgentService();
    agent.evictSessionAgent(key);
    await retireSessionMcpRuntimeForSessionKey({ sessionKey: key, reason: 'session-reset' });
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.warn({ err, sessionKey: key, errorMessage: em }, `Session reset runtime cleanup failed: ${em}`);
  }

  log.info(
    { sessionKey: key, sessionId: outcome.sessionId, previousSessionId: outcome.previousSessionId },
    'Session reset completed',
  );

  return {
    ok: true,
    sessionId: outcome.sessionId,
    previousSessionId: outcome.previousSessionId,
  };
}

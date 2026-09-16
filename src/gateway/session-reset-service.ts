import type { AgentService } from '../agent/service.js';
import { abortEmbeddedRun } from '../agent/embedded/runs.js';
import { retireSessionMcpRuntimeForConversationId } from '../agent/mcp/bundle-mcp-tools.js';
import type { SessionIndex } from '../session/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SessionReset');

export type SessionResetDeps = {
  sessionIndex: SessionIndex;
  getAgentService: () => AgentService;
};

export type SessionResetResult =
  | { ok: true; transcriptId: string; previousTranscriptId?: string }
  | { ok: false; error: string };

/**
 * Reset a session in place: archive the current transcript, assign a new
 * `transcriptId`, keep the session key and persisted overrides (model/thinking in
 * SQLite `session_config`, thinking/verbose on the session row).
 */
export async function performSessionReset(
  conversationId: string,
  deps: SessionResetDeps,
): Promise<SessionResetResult> {
  const key = conversationId.trim();
  if (!key) {
    return { ok: false, error: 'Session key required' };
  }

  await abortEmbeddedRun(key);

  const task = await deps.sessionIndex.resetSession(key);
  if (!task) {
    return { ok: false, error: 'Session not found' };
  }

  try {
    const agent = deps.getAgentService();
    agent.evictSessionAgent(key);
    await retireSessionMcpRuntimeForConversationId({ conversationId: key, reason: 'session-reset' });
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.warn({ err, conversationId: key, errorMessage: em }, `Session reset runtime cleanup failed: ${em}`);
  }

  log.info(
    { conversationId: key, transcriptId: task.transcriptId, previousTranscriptId: task.previousTranscriptId },
    'Session reset completed',
  );

  return {
    ok: true,
    transcriptId: task.transcriptId,
    previousTranscriptId: task.previousTranscriptId,
  };
}

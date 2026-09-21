import { fetchSessionActiveRun } from '../../query/sessions';
import {
  clearPendingAgentRun,
  readPendingAgentRunId,
  setPendingAgentRun,
} from '../gateway/pending-agent-run';

export async function resolveResumeRunId(conversationId: string, signal?: AbortSignal): Promise<string | null> {
  const key = conversationId.trim();
  if (!key) return null;

  try {
    if (signal?.aborted) throw new Error('Aborted');
    const remote = await fetchSessionActiveRun(key, signal);
    if (signal?.aborted) throw new Error('Aborted');
    if (remote.active && remote.runId) {
      setPendingAgentRun(key, remote.runId);
      return remote.runId;
    }
    clearPendingAgentRun(key);
    return null;
  } catch (error) {
    if (signal?.aborted) throw new Error('Aborted');
    // A local run id is enough to attempt topic replay while the active-run
    // endpoint is temporarily unreachable. With no local id, preserve the
    // transport failure so recovery retries instead of treating it as an
    // authoritative "no active run" response.
    const localRunId = readPendingAgentRunId(key);
    if (localRunId) return localRunId;
    throw error;
  }
}

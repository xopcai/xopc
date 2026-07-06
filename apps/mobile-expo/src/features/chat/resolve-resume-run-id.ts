import { fetchSessionActiveRun } from '../../query/sessions';
import {
  readPendingAgentRunId,
  setPendingAgentRun,
} from '../gateway/pending-agent-run';

export async function resolveResumeRunId(sessionKey: string): Promise<string | null> {
  const key = sessionKey.trim();
  if (!key) return null;

  try {
    const remote = await fetchSessionActiveRun(key);
    if (remote.active && remote.runId) {
      setPendingAgentRun(key, remote.runId);
      return remote.runId;
    }
  } catch {
    /* gateway may be reconnecting; fall back to local pending run */
  }

  return readPendingAgentRunId(key);
}

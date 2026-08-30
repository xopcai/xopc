import { parseAgentSessionKey } from '../routing/agent-session-key.js';

import type { TuiBackend, TuiSessionItem } from './tui-backend.js';

const GENERATED_TUI_SUFFIX_RE = /^tui-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ABANDONED_SESSION_AGE_MS = 60 * 60_000;

export const GENERATED_TUI_SESSION_SHELL_PATCH = {
  hiddenFromSessionList: true,
  customData: { genericNewChatShell: true },
} as const;

export function isGeneratedTuiSessionKey(sessionKey: string): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  return parsed ? GENERATED_TUI_SUFFIX_RE.test(parsed.rest) : false;
}

export async function deleteGeneratedTuiSessionIfEmpty(
  client: Pick<TuiBackend, 'getSessionStats' | 'deleteSession'>,
  sessionKey: string,
): Promise<boolean> {
  if (!isGeneratedTuiSessionKey(sessionKey)) return false;
  const stats = await client.getSessionStats(sessionKey);
  if (stats.totalMessages > 0) return false;
  return (await client.deleteSession(sessionKey)).ok;
}

export async function cleanupAbandonedTuiSessions(
  client: Pick<TuiBackend, 'listSessions' | 'getSessionStats' | 'deleteSession'>,
  currentSessionKey: string,
  nowMs = Date.now(),
): Promise<string[]> {
  const sessions = await client.listSessions();
  const candidates = sessions.filter((session: TuiSessionItem) =>
    session.key !== currentSessionKey
    && session.messageCount === 0
    && typeof session.updatedAt === 'number'
    && session.updatedAt <= nowMs - ABANDONED_SESSION_AGE_MS
    && isGeneratedTuiSessionKey(session.key),
  );
  const deleted: string[] = [];
  for (const session of candidates) {
    if (await deleteGeneratedTuiSessionIfEmpty(client, session.key)) {
      deleted.push(session.key);
    }
  }
  return deleted;
}


import type { TuiBackend, TuiSessionItem } from './tui-backend.js';

const ABANDONED_SESSION_AGE_MS = 60 * 60_000;

export const GENERATED_TUI_SESSION_SHELL_PATCH = {
  hiddenFromSessionList: true,
  customData: { genericNewChatShell: true },
} as const;

export async function deleteGeneratedTuiSessionIfEmpty(
  client: Pick<TuiBackend, 'getSessionInfo' | 'getSessionStats' | 'deleteSession'>,
  conversationId: string,
): Promise<boolean> {
  if (!(await client.getSessionInfo(conversationId)).generatedShell) return false;
  const stats = await client.getSessionStats(conversationId);
  if (stats.totalMessages > 0) return false;
  return (await client.deleteSession(conversationId)).ok;
}

export async function cleanupAbandonedTuiSessions(
  client: Pick<TuiBackend, 'listSessions' | 'getSessionInfo' | 'getSessionStats' | 'deleteSession'>,
  currentConversationId: string,
  nowMs = Date.now(),
): Promise<string[]> {
  const sessions = await client.listSessions();
  const candidates = sessions.filter((session: TuiSessionItem) =>
    session.key !== currentConversationId
    && session.messageCount === 0
    && typeof session.updatedAt === 'number'
    && session.updatedAt <= nowMs - ABANDONED_SESSION_AGE_MS
    && session.generatedShell === true,
  );
  const deleted: string[] = [];
  for (const session of candidates) {
    if (await deleteGeneratedTuiSessionIfEmpty(client, session.key)) {
      deleted.push(session.key);
    }
  }
  return deleted;
}

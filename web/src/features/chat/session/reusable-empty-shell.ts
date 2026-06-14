import type { SessionInfo } from '@/features/chat/chat.types';
import { isSessionAgentRunActive } from '@/features/chat/session/chat-session-store';
import { isWebUiSessionKey } from '@/features/chat/session/session-manager';
import { getAgentIdFromWebSessionKey } from '@/lib/web-session-agent';
import { normalizeAgentId } from '@/lib/webchat-session-key';

/** Empty webchat session eligible for New chat reuse (same agent, no active run). */
export function isReusableEmptyShell(session: SessionInfo, agentId: string): boolean {
  const key = session.key?.trim();
  if (!key || !isWebUiSessionKey(key)) return false;
  if ((session.messageCount ?? 0) !== 0) return false;
  const sessionAgent = getAgentIdFromWebSessionKey(key);
  if (!sessionAgent || sessionAgent !== normalizeAgentId(agentId)) return false;
  if (isSessionAgentRunActive(key)) return false;
  return true;
}

/** Most recently touched reusable empty shell for an agent, or null. */
export function pickReusableEmptyShell(
  sessions: SessionInfo[],
  agentId: string,
): SessionInfo | null {
  const id = normalizeAgentId(agentId);
  const candidates = sessions
    .filter((s) => isReusableEmptyShell(s, id))
    .sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  return candidates[0] ?? null;
}

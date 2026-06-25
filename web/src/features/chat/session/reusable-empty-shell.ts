import type { SessionInfo } from '@/features/chat/chat.types';
import { isSessionAgentRunActive } from '@/features/chat/session/chat-session-store';
import { normalizeAgentId } from '@/lib/agent-id';

function parseAgentWebchatKey(key: string): { agentId: string; sourceChannel: string } | null {
  const parts = key.trim().split(':');
  if (parts[0] !== 'agent' || !parts[1] || !parts[2]) return null;
  return { agentId: parts[1], sourceChannel: parts[2] };
}

/** Empty webchat session eligible for New chat reuse (same agent, no active run). */
export function isReusableEmptyShell(session: SessionInfo, agentId: string): boolean {
  const key = session.key?.trim();
  if (!key) return false;
  const parsed = parseAgentWebchatKey(key);
  const sourceChannel = session.sourceChannel?.trim().toLowerCase() ?? parsed?.sourceChannel.toLowerCase();
  if (sourceChannel !== 'webchat') return false;
  if ((session.messageCount ?? 0) !== 0) return false;
  const sessionAgent = (session.routing?.agentId ?? parsed?.agentId)?.trim().toLowerCase();
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

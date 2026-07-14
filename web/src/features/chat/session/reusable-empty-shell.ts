import type { SessionInfo } from '@/features/chat/chat.types';
import {
  getChatSessionSnapshot,
  isSessionAgentRunActive,
} from '@/features/chat/session/chat-session-store';
import { normalizeAgentId } from '@/lib/agent-id';

function parseAgentWebchatKey(key: string): { agentId: string; sourceChannel: string; peerId: string } | null {
  const parts = key.trim().split(':');
  if (parts.length < 6) return null;
  const [scope, agentId, sourceChannel, accountId, peerKind, ...peerParts] = parts;
  if (scope !== 'agent' || !agentId || !sourceChannel) return null;
  if (accountId !== 'default' || peerKind !== 'direct') return null;
  const peerId = peerParts.join(':').trim();
  if (!peerId) return null;
  return { agentId, sourceChannel, peerId };
}

function hasSourceBinding(customData: Record<string, unknown> | undefined): boolean {
  const sourceBinding = customData?.sourceBinding;
  return Boolean(sourceBinding && typeof sourceBinding === 'object');
}

function isGenericNewChatPeer(peerId: string | undefined): boolean {
  return Boolean(peerId?.trim().startsWith('chat_'));
}

export type ReusableEmptyShellScope = {
  agentId: string;
  projectId?: string | null;
};

function normalizeProjectId(projectId: string | null | undefined): string | undefined {
  return projectId?.trim() || undefined;
}

/** Empty webchat session eligible for New chat reuse (same agent, no active run). */
export function isReusableEmptyShell(session: SessionInfo, scope: ReusableEmptyShellScope): boolean {
  const key = session.key?.trim();
  if (!key) return false;
  const parsed = parseAgentWebchatKey(key);
  if (!parsed) return false;
  const sourceChannel = session.sourceChannel?.trim().toLowerCase() ?? parsed?.sourceChannel.toLowerCase();
  if (sourceChannel !== 'webchat') return false;
  if (session.customData?.genericNewChatShell === false) return false;
  if (hasSourceBinding(session.customData)) return false;
  if (!isGenericNewChatPeer(parsed.peerId)) return false;
  // Session-list metadata can lag behind the optimistic user message in the
  // local slice. A session is empty only when neither source has a message.
  if ((session.messageCount ?? 0) !== 0 || (getChatSessionSnapshot(key)?.messages.length ?? 0) !== 0) {
    return false;
  }
  const sessionAgent = (session.routing?.agentId ?? parsed?.agentId)?.trim().toLowerCase();
  if (!sessionAgent || sessionAgent !== normalizeAgentId(scope.agentId)) return false;
  const requestedProjectId = normalizeProjectId(scope.projectId);
  const sessionProjectId = normalizeProjectId(session.projectId);
  if (requestedProjectId ? sessionProjectId !== requestedProjectId : Boolean(sessionProjectId)) return false;
  if (isSessionAgentRunActive(key)) return false;
  return true;
}

/** Most recently touched reusable empty shell for an agent, or null. */
export function pickReusableEmptyShell(
  sessions: SessionInfo[],
  scope: ReusableEmptyShellScope,
): SessionInfo | null {
  const nextScope = { ...scope, agentId: normalizeAgentId(scope.agentId) };
  const candidates = sessions
    .filter((s) => isReusableEmptyShell(s, nextScope))
    .sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  return candidates[0] ?? null;
}

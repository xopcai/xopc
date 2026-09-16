import type { SessionInfo } from '@/features/chat/chat.types';
import {
  getChatSessionSnapshot,
  isSessionAgentRunActive,
} from '@/features/chat/session/chat-session-store';
import { normalizeAgentId } from '@/lib/agent-id';

function hasSourceBinding(customData: Record<string, unknown> | undefined): boolean {
  const sourceBinding = customData?.sourceBinding;
  return Boolean(sourceBinding && typeof sourceBinding === 'object');
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
  const sourceChannel = session.sourceChannel?.trim().toLowerCase();
  if (sourceChannel !== 'webchat') return false;
  if (session.customData?.genericNewChatShell !== true) return false;
  if (hasSourceBinding(session.customData)) return false;
  // Session-list metadata can lag behind the optimistic user message in the
  // local slice. A session is empty only when neither source has a message.
  if ((session.messageCount ?? 0) !== 0 || (getChatSessionSnapshot(key)?.messages.length ?? 0) !== 0) {
    return false;
  }
  const sessionAgent = session.agentId?.trim().toLowerCase();
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

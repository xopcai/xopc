import type { ReasoningLevel } from '@/features/chat/messages.types';
import type { SessionInfo } from '@/features/chat/chat.types';
import { isWebUiSessionKey } from '@/features/chat/session-manager';
import { getAgentIdFromWebSessionKey } from '@/lib/web-session-agent';

export const DEFAULT_THINKING = 'medium';
export const DEFAULT_REASONING: ReasoningLevel = 'stream';

export const WEBCHAT_AGENT_STORAGE_KEY = 'xopc.webchat.agentId';

export function readStoredWebchatAgentId(): string | null {
  if (typeof globalThis.localStorage === 'undefined') return null;
  try {
    const v = globalThis.localStorage.getItem(WEBCHAT_AGENT_STORAGE_KEY)?.trim().toLowerCase();
    return v || null;
  } catch {
    return null;
  }
}

export function pickEmptyWebSessionForAgent(
  sessions: SessionInfo[],
  agentId: string | undefined,
): SessionInfo | undefined {
  if (!agentId) return undefined;
  return sessions.find(
    (s) =>
      isWebUiSessionKey(s.key) &&
      (s.messageCount ?? 0) === 0 &&
      getAgentIdFromWebSessionKey(s.key) === agentId,
  );
}

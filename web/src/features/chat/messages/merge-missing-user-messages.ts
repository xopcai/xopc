import { mergeConsecutiveAssistantMessages } from '@/features/chat/messages/agent-messages';
import type { Message } from '@/features/chat/messages/messages.types';
import { isUiUserMessage } from '@/features/chat/messages/user-round-index';

function hasSameTurnBoundaries(local: Message[], canonical: Message[]): boolean {
  return local.length === canonical.length && local.every((message, index) => {
    const expected = canonical[index];
    if (!expected || message.role !== expected.role) return false;
    return !message.turnId || !expected.turnId || message.turnId === expected.turnId;
  });
}

/**
 * When another device sends a user turn, the passive client may be mid-realtime resume with a
 * stale committed prefix. Prefer the canonical prefix through the active user turn when available;
 * otherwise append only user rows the server has that we lack (by count).
 */
export function mergeMissingUserMessagesFromServer(
  local: Message[],
  server: Message[],
  activeTurnId?: string,
): Message[] {
  const isUser = (m: Message) => isUiUserMessage(m.role);
  if (activeTurnId) {
    const activeUserIndex = server.findIndex(
      (message) => isUser(message) && message.turnId === activeTurnId,
    );
    if (activeUserIndex >= 0) {
      const canonicalPrefix = server.slice(0, activeUserIndex + 1);
      if (!hasSameTurnBoundaries(local, canonicalPrefix)) {
        return mergeConsecutiveAssistantMessages(canonicalPrefix);
      }
      return local;
    }
  }
  const localUserCount = local.filter(isUser).length;
  const serverUserCount = server.filter(isUser).length;
  if (serverUserCount <= localUserCount) {
    return local;
  }

  const extraUsers = server.filter(isUser).slice(localUserCount);
  if (extraUsers.length === 0) {
    return local;
  }

  return mergeConsecutiveAssistantMessages([...local, ...extraUsers]);
}

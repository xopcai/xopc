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

function mergeConversationOrigins(local: Message[], server: Message[], aligned = false): Message[] {
  const byTurn = new Map(server.filter(message => isUiUserMessage(message.role) && message.turnId)
    .map(message => [message.turnId, message]));
  let changed = false;
  const merged = local.map((message, index) => {
    if (!isUiUserMessage(message.role)) return message;
    const canonical = message.turnId ? byTurn.get(message.turnId) : aligned ? server[index] : undefined;
    const origin = canonical?.conversationOrigin;
    if (!origin || JSON.stringify(message.conversationOrigin) === JSON.stringify(origin)) return message;
    changed = true;
    return { ...message, conversationOrigin: origin };
  });
  return changed ? merged : local;
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
      const localActiveIndex = local.findLastIndex(message => isUser(message) && message.turnId === activeTurnId);
      // A delayed snapshot for an earlier run cannot remove a later local turn.
      if (localActiveIndex >= 0 && local.slice(localActiveIndex + 1).some(isUser)) return local;
      const canonicalPrefix = server.slice(0, activeUserIndex + 1);
      // A paged or delayed snapshot may lack rows already rendered before this
      // user turn. Live synchronization must not shrink the committed prefix.
      if (localActiveIndex >= 0 && canonicalPrefix.length < localActiveIndex + 1) return local;
      if (!hasSameTurnBoundaries(local, canonicalPrefix)) {
        return mergeConsecutiveAssistantMessages(canonicalPrefix);
      }
      return mergeConversationOrigins(local, canonicalPrefix, true);
    }
  }
  const localUserCount = local.filter(isUser).length;
  const serverUserCount = server.filter(isUser).length;
  if (serverUserCount <= localUserCount) {
    return mergeConversationOrigins(local, server);
  }

  const extraUsers = server.filter(isUser).slice(localUserCount);
  if (extraUsers.length === 0) {
    return local;
  }

  return mergeConsecutiveAssistantMessages([...mergeConversationOrigins(local, server), ...extraUsers]);
}

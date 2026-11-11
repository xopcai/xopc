import { assistantTurnVisuallyEquivalent, mergeConsecutiveAssistantMessages } from '@/features/chat/messages/agent-messages';
import { assistantAnswerContent } from '@/features/chat/messages/assistant-turn-content';
import type { Message } from '@/features/chat/messages/messages.types';
import { isUiUserMessage } from '@/features/chat/messages/user-round-index';

function hasSameTurnBoundaries(local: Message[], canonical: Message[]): boolean {
  return local.length === canonical.length && local.every((message, index) => {
    const expected = canonical[index];
    if (!expected || message.role !== expected.role) return false;
    return !message.turnId || !expected.turnId || message.turnId === expected.turnId;
  });
}

function hasAssistantAnswer(message: Message): boolean {
  return message.role === 'assistant' && assistantAnswerContent(message.content, { includePending: true }).some(part => {
    if (part.type === 'review') return true;
    const text = part.type === 'text' && part.text.trim();
    return Boolean(text && text !== 'NO_REPLY');
  });
}

/** A live page can contain extra user rows and still omit already displayed replies. */
function retainsAssistantAnswers(local: Message[], canonical: Message[]): boolean {
  const replies = local.filter(hasAssistantAnswer);
  let matched = 0;
  for (const incoming of canonical) {
    const previous = replies[matched];
    if (!previous) return true;
    if (!hasAssistantAnswer(incoming)) continue;
    if (previous.turnId && incoming.turnId
      ? previous.turnId === incoming.turnId && Boolean(previous.startsNewBubble) === Boolean(incoming.startsNewBubble)
      : (previous.timestamp !== undefined && previous.timestamp === incoming.timestamp)
        || assistantTurnVisuallyEquivalent(previous, incoming)) matched++;
  }
  return matched === replies.length;
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
      // The optimistic input may not have its run id yet. A paged or delayed
      // snapshot must not shrink displayed history even before that echo arrives.
      if (canonicalPrefix.length < local.length) return local;
      if (!hasSameTurnBoundaries(local, canonicalPrefix)) {
        if (!retainsAssistantAnswers(local, canonicalPrefix)) return local;
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

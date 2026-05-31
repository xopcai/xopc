import { mergeConsecutiveAssistantMessages } from '@/features/chat/messages/agent-messages';
import type { Message } from '@/features/chat/messages/messages.types';
import { isUiUserMessage } from '@/features/chat/messages/user-round-index';

/**
 * When another device sends a user turn, the passive client may be mid-SSE resume with a
 * stale committed prefix. Append only user rows the server has that we lack (by count).
 */
export function mergeMissingUserMessagesFromServer(local: Message[], server: Message[]): Message[] {
  const isUser = (m: Message) => isUiUserMessage(m.role);
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

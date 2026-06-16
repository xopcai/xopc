/** Canonical Telegram conversation id for forum/DM topics. */
export function buildTelegramConversationId(chatId: string, threadId?: string | number): string {
  if (threadId == null || threadId === '') return chatId;
  return `${chatId}:topic:${threadId}`;
}

export function parseTelegramConversationId(conversationId: string): {
  chatId: string;
  threadId?: string;
} {
  const marker = ':topic:';
  const idx = conversationId.indexOf(marker);
  if (idx === -1) {
    return { chatId: conversationId };
  }
  return {
    chatId: conversationId.slice(0, idx),
    threadId: conversationId.slice(idx + marker.length),
  };
}

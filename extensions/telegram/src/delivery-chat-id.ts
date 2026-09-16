import { conversationIdSchema } from '@xopcai/gateway-contract';
import { getConversationRouting } from '@xopcai/xopc/routing/session-key.js';

/**
 * Resolves Telegram Bot API `chat_id` from config/UI `to` / `targetChatId`.
 * Accepts numeric ids, conversation UUIDs, or
 * routing suffixes (`account:dm:peerId` / `account:group:peerId`).
 */
export function normalizeTelegramDeliveryChatId(to: string): string {
  const trimmed = to.trim();
  if (!trimmed) {
    return trimmed;
  }

  const parsed = conversationIdSchema.safeParse(trimmed).success ? getConversationRouting(trimmed) : null;
  if (parsed?.source === 'telegram') {
    return parsed.peerId;
  }

  const parts = trimmed.split(':');
  if (parts.length === 3 && (parts[1] === 'dm' || parts[1] === 'group') && parts[2] !== '') {
    return parts[2];
  }

  return trimmed;
}

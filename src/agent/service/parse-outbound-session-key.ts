import type { Config } from '../../config/schema.js';
import { INTERNAL_OUTBOUND_DROP_CHANNEL } from '../../channels/internal-outbound.js';
import { getSessionMetadata } from '../../storage/sqlite/index.js';

/**
 * Map a session key to outbound channel routing (heartbeat/cron/virtual keys included).
 */
export function parseOutboundConversationId(
  conversationId: string,
  config: Config | undefined,
): { channel: string; chatId: string } {
  const metadata = getSessionMetadata(conversationId);
  if (!metadata) throw new Error(`Conversation not found: ${conversationId}`);

  if (metadata.sessionType === 'heartbeat') {
    const hb = config?.gateway?.heartbeat;
    const target = hb?.target?.trim();
    const targetChatId = hb?.targetChatId?.trim();
    if (target && targetChatId) {
      return { channel: target, chatId: targetChatId };
    }
    return { channel: INTERNAL_OUTBOUND_DROP_CHANNEL, chatId: conversationId };
  }

  const routing = metadata?.routing;
  if (routing?.source && routing.peerId) {
    return { channel: routing.source, chatId: routing.peerId };
  }
  if (metadata?.sourceChannel && metadata.sourceChatId) {
    return { channel: metadata.sourceChannel, chatId: metadata.sourceChatId };
  }

  if (metadata.sessionType === 'cron') {
    return { channel: INTERNAL_OUTBOUND_DROP_CHANNEL, chatId: conversationId };
  }

  return { channel: 'cli', chatId: 'main' };
}

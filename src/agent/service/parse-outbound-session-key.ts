import type { Config } from '../../config/schema.js';
import { INTERNAL_OUTBOUND_DROP_CHANNEL } from '../../channels/internal-outbound.js';
import { getSessionMetadata } from '../../storage/sqlite/index.js';

/**
 * Map a session key to outbound channel routing (heartbeat/cron/virtual keys included).
 */
export function parseOutboundSessionKey(
  sessionKey: string,
  config: Config | undefined,
): { channel: string; chatId: string } {
  const parts = sessionKey.split(':').filter(Boolean);
  const first = parts[0] || 'cli';

  if (first === 'heartbeat') {
    const hb = config?.gateway?.heartbeat;
    const target = hb?.target?.trim();
    const targetChatId = hb?.targetChatId?.trim();
    if (target && targetChatId) {
      return { channel: target, chatId: targetChatId };
    }
    return { channel: INTERNAL_OUTBOUND_DROP_CHANNEL, chatId: parts.slice(1).join(':') || 'heartbeat' };
  }

  const metadata = getSessionMetadata(sessionKey);
  const routing = metadata?.routing;
  if (routing?.source && routing.peerId) {
    return { channel: routing.source, chatId: routing.peerId };
  }
  if (metadata?.sourceChannel && metadata.sourceChatId) {
    return { channel: metadata.sourceChannel, chatId: metadata.sourceChatId };
  }

  if (first === 'cron') {
    return { channel: INTERNAL_OUTBOUND_DROP_CHANNEL, chatId: parts.slice(1).join(':') || 'cron' };
  }

  return { channel: 'cli', chatId: 'main' };
}

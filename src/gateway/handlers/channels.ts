import { createLogger } from '../../utils/logger.js';
import type { GatewayEvent, RequestContext } from '../protocol.js';
import { createEvent } from '../protocol.js';

const log = createLogger('Gateway:ChannelsHandler');

export async function handleSend(
  params: Record<string, unknown>,
  _ctx: RequestContext
): Promise<{ sent: boolean; messageId?: string }> {
  const channel = params.channel as string;
  const chatId = params.chatId as string;
  const content = params.content as string;

  if (!channel || !chatId || !content) {
    throw new Error('Missing required params: channel, chatId, content');
  }

  log.info({ channel, chatId, content: content.slice(0, 100) }, 'Sending message');

  // Placeholder - would integrate with ChannelManager
  return {
    sent: true,
    messageId: `msg_${Date.now()}`,
  };
}

export async function handleChannelsStatus(): Promise<{
  channels: Array<{
    name: string;
    enabled: boolean;
    connected: boolean;
  }>;
}> {
  // Placeholder - would check actual channel statuses
  return {
    channels: [
      { name: 'telegram', enabled: true, connected: false },
    ],
  };
}

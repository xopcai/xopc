/**
 * Outbound delivery helper: normalize then invoke the plugin outbound adapter.
 */

import type { Config } from '../../config/index.js';
import type {
  ChannelOutboundContext,
  ChannelPlugin,
  OutboundDeliveryResult,
} from '../plugin-types.js';
import type { OutboundMessage } from '../transport-types.js';
import { normalizeTelegramDeliveryChatId } from '../telegram-delivery-chat-id.js';
import { normalizePayloadForPlugin } from './normalize.js';

export interface DeliverOutboundMessageParams {
  cfg: Config;
  plugin: ChannelPlugin;
  processedMsg: OutboundMessage;
}

export async function deliverOutboundMessage(
  params: DeliverOutboundMessageParams,
): Promise<OutboundDeliveryResult | undefined> {
  const { cfg, plugin, processedMsg } = params;
  const outbound = plugin.outbound;
  if (!outbound) return undefined;

  const chatId =
    plugin.id === 'telegram' && typeof processedMsg.chat_id === 'string'
      ? normalizeTelegramDeliveryChatId(processedMsg.chat_id)
      : processedMsg.chat_id;

  const msg: OutboundMessage = { ...processedMsg, chat_id: chatId };

  const normalizedPayload = normalizePayloadForPlugin(msg, plugin);

  if (msg.type === 'typing_on' || msg.type === 'typing_off') {
    if (outbound.sendPayload) {
      return outbound.sendPayload({
        cfg,
        to: chatId,
        text: msg.content ?? '',
        mediaUrl: msg.mediaUrl,
        threadId: msg.metadata?.threadId as string | number | null,
        replyToId: msg.replyToMessageId,
        accountId: msg.metadata?.accountId as string ?? undefined,
        silent: msg.silent,
        payload: normalizedPayload,
      });
    }
    return undefined;
  }

  const outboundCtx: ChannelOutboundContext = {
    cfg,
    to: chatId,
    text: msg.content ?? '',
    mediaUrl: msg.mediaUrl,
    mediaType: msg.mediaType,
    threadId: msg.metadata?.threadId as string | number | null,
    replyToId: msg.replyToMessageId,
    accountId: msg.metadata?.accountId as string ?? undefined,
    silent: msg.silent,
    audioAsVoice: msg.audioAsVoice,
  };

  if (outbound.sendPayload) {
    return outbound.sendPayload({ ...outboundCtx, payload: normalizedPayload });
  }
  if (outbound.sendMedia) {
    return outbound.sendMedia(outboundCtx);
  }
  if (outbound.sendText) {
    return outbound.sendText(outboundCtx);
  }
  return { messageId: '', chatId, success: false, error: 'No send method' };
}

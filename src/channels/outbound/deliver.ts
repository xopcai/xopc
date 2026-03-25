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

  const normalizedPayload = normalizePayloadForPlugin(processedMsg, plugin);

  if (processedMsg.type === 'typing_on' || processedMsg.type === 'typing_off') {
    if (outbound.sendPayload) {
      return outbound.sendPayload({
        cfg,
        to: processedMsg.chat_id,
        text: processedMsg.content ?? '',
        mediaUrl: processedMsg.mediaUrl,
        threadId: processedMsg.metadata?.threadId as string | number | null,
        replyToId: processedMsg.replyToMessageId,
        accountId: processedMsg.metadata?.accountId as string ?? undefined,
        silent: processedMsg.silent,
        payload: normalizedPayload,
      });
    }
    return undefined;
  }

  const outboundCtx: ChannelOutboundContext = {
    cfg,
    to: processedMsg.chat_id,
    text: processedMsg.content ?? '',
    mediaUrl: processedMsg.mediaUrl,
    mediaType: processedMsg.mediaType,
    threadId: processedMsg.metadata?.threadId as string | number | null,
    replyToId: processedMsg.replyToMessageId,
    accountId: processedMsg.metadata?.accountId as string ?? undefined,
    silent: processedMsg.silent,
    audioAsVoice: processedMsg.audioAsVoice,
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
  return { messageId: '', chatId: processedMsg.chat_id, success: false, error: 'No send method' };
}

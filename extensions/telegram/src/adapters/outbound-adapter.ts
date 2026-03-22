/**
 * Telegram outbound adapter: text chunker + sendText / sendMedia / sendPayload.
 */

import type {
  ChannelOutboundContext,
  ChannelOutboundPayloadContext,
  OutboundDeliveryResult,
} from '@xopcai/xopcbot/channels/plugin-types.js';
import type { ChannelSendOptions, ChannelSendResult } from '@xopcai/xopcbot/channels/channel-domain.js';
import type { OutboundMessage } from '@xopcai/xopcbot/types/index.js';
import { TELEGRAM_CHANNEL_DEFAULTS } from '../plugin-defaults.js';

export function telegramTextChunker(text: string, limit: number): string[] {
  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';
  for (const line of lines) {
    if ((current + '\n' + line).length > limit) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function toDelivery(r: ChannelSendResult): OutboundDeliveryResult {
  return {
    messageId: r.messageId,
    chatId: r.chatId,
    success: r.success,
    error: r.error,
  };
}

export function createTelegramOutboundSendMethods(
  send: (options: ChannelSendOptions) => Promise<ChannelSendResult>,
): {
  sendText: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
  sendMedia: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
  sendPayload: (ctx: ChannelOutboundPayloadContext) => Promise<OutboundDeliveryResult>;
} {
  return {
    sendText: async (ctx: ChannelOutboundContext) => {
      const result = await send({
        chatId: ctx.to,
        content: ctx.text,
        accountId: ctx.accountId,
        threadId: ctx.threadId?.toString(),
        replyToMessageId: ctx.replyToId?.toString(),
        silent: ctx.silent,
      });
      return toDelivery(result);
    },

    sendPayload: async (ctx: ChannelOutboundContext & { payload: unknown }) => {
      const payload = ctx.payload as OutboundMessage;
      const result = await send({
        chatId: ctx.to,
        content: ctx.text,
        type: payload.type,
        accountId: ctx.accountId,
        threadId: ctx.threadId?.toString(),
        replyToMessageId: ctx.replyToId?.toString(),
        silent: ctx.silent,
        mediaUrl: ctx.mediaUrl,
        audioAsVoice: ctx.audioAsVoice,
      });
      return toDelivery(result);
    },

    sendMedia: async (ctx: ChannelOutboundContext) => {
      const mediaUrl = ctx.mediaUrl?.trim();
      if (!mediaUrl) {
        return { messageId: '', chatId: ctx.to, success: false, error: 'No media URL' };
      }
      const result = await send({
        chatId: ctx.to,
        content: ctx.text ?? '',
        accountId: ctx.accountId,
        threadId: ctx.threadId?.toString(),
        replyToMessageId: ctx.replyToId?.toString(),
        silent: ctx.silent,
        mediaUrl,
        mediaType: ctx.mediaType,
        audioAsVoice: ctx.audioAsVoice,
      });
      return toDelivery(result);
    },
  };
}

export const TELEGRAM_OUTBOUND_DEFAULTS = {
  textChunkLimit: TELEGRAM_CHANNEL_DEFAULTS.outbound.textChunkLimit,
} as const;

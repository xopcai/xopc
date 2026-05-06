import type { Config } from '@xopcai/xopc/config/schema.js';
import type {
  ChannelOutboundAdapter,
  ChannelOutboundContext,
  OutboundDeliveryResult,
} from '@xopcai/xopc/channels/plugin-types.js';

import { resolveDingtalkAccount } from './accounts.js';
import { sendDingtalkTextMessage } from './send-text.js';

function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  const lines = text.split('\n');
  let cur = '';
  for (const line of lines) {
    const next = cur ? `${cur}\n${line}` : line;
    if (next.length > limit) {
      if (cur) chunks.push(cur);
      cur = line.length > limit ? line.slice(0, limit) : line;
      while (cur.length > limit) {
        chunks.push(cur.slice(0, limit));
        cur = cur.slice(limit);
      }
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text.slice(0, limit)];
}

export function createDingtalkOutboundAdapter(): ChannelOutboundAdapter {
  return {
    deliveryMode: 'direct',
    textChunkLimit: 4000,
    chunker: (text, limit) => chunkText(text, limit),

    async sendText(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> {
      const webhookRaw = ctx.outboundMetadata?.sessionWebhook;
      const webhook = typeof webhookRaw === 'string' ? webhookRaw.trim() : '';
      if (!webhook) {
        return {
          success: false,
          chatId: ctx.to,
          messageId: '',
          error: 'DingTalk outbound requires sessionWebhook on the inbound message metadata',
        };
      }

      const account = resolveDingtalkAccount(ctx.cfg as Config, ctx.accountId ?? null);
      try {
        await sendDingtalkTextMessage({
          config: { clientId: account.clientId, clientSecret: account.clientSecret },
          sessionWebhook: webhook,
          text: ctx.text,
        });
        return { success: true, chatId: ctx.to, messageId: '' };
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        return { success: false, chatId: ctx.to, messageId: '', error: em };
      }
    },
  };
}

import type { ChannelOutboundAdapter, ChannelOutboundContext, OutboundDeliveryResult } from '@xopcai/xopc/channels/plugin-types.js';
import type { Config } from '@xopcai/xopc/config/schema.js';

import { resolveFeishuAccount } from '../state/accounts.js';
import { createFeishuClient } from '../transport/client/client.js';

export function createFeishuOutboundAdapter(): ChannelOutboundAdapter {
  return {
    deliveryMode: 'direct',
    chunkerMode: 'text',
    textChunkLimit: 4000,

    async sendText(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> {
      const cfg = ctx.cfg as Config;
      const account = resolveFeishuAccount(cfg, ctx.accountId ?? 'default');
      if (!account.configured) {
        return { success: false, messageId: '', chatId: ctx.to, error: 'Feishu account is not configured' };
      }

      const { api } = createFeishuClient(account);
      const to = ctx.to;
      const content = ctx.text ?? '';

      // Minimal: always send as plain text. Later we add post/card rendering + reply/thread semantics.
      const receive_id_type = isProbablyOpenId(to) ? 'open_id' : 'chat_id';
      const res = await (api as any).im.message.create({
        data: {
          receive_id_type,
          receive_id: to,
          msg_type: 'text',
          content: JSON.stringify({ text: content }),
        },
      });

      const messageId = res?.data?.message_id ?? res?.message_id ?? '';
      return { success: true, messageId, chatId: to };
    },

    async sendMedia(_ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> {
      return {
        success: false,
        messageId: '',
        chatId: _ctx.to,
        error: 'Feishu sendMedia not implemented yet',
      };
    },
  };
}

function isProbablyOpenId(to: string): boolean {
  const t = to.trim();
  return t.startsWith('ou_') || t.startsWith('on_') || t.startsWith('open_id:') || t.startsWith('user:');
}


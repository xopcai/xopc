import type {
  ChannelOutboundAdapter,
  ChannelOutboundContext,
  OutboundDeliveryResult,
} from '@xopcai/xopc/channels/plugin-types.js';
import type { Config } from '@xopcai/xopc/config/schema.js';

import { resolveFeishuAccount } from '../state/accounts.js';
import { createFeishuClient } from '../transport/client/client.js';
import { loadMediaForFeishu } from './media-load.js';
import { getFeishuBindingByMessageId, recordFeishuMessageBinding } from '../state/message-bindings.js';

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

      const receive_id_type = isProbablyOpenId(to) ? 'open_id' : 'chat_id';
      const preferCard = account.renderMode === 'card';
      const payloadText = {
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      };
      const payloadCard = {
        msg_type: 'interactive',
        content: JSON.stringify({
          schema: '2.0',
          config: { update_multi: true },
          body: {
            elements: [
              {
                tag: 'markdown',
                element_id: 'md_1',
                content,
              },
            ],
          },
        }),
      };

      const send = async (useCard: boolean) => {
        const p = useCard ? payloadCard : payloadText;
        return ctx.replyToId
          ? await (api as any).im.message.reply({
              path: { message_id: ctx.replyToId },
              data: {
                ...p,
                ...(ctx.threadId ? { reply_in_thread: true } : {}),
              },
            })
          : await (api as any).im.message.create({
              params: { receive_id_type },
              data: {
                receive_id: to,
                ...p,
              },
            });
      };

      const res = preferCard
        ? await send(true).catch(async () => await send(false))
        : await send(false);

      const messageId = res?.data?.message_id ?? res?.message_id ?? '';
      if (messageId && ctx.replyToId) {
        const parent = getFeishuBindingByMessageId(ctx.replyToId);
        if (parent) {
          recordFeishuMessageBinding({
            ...parent,
            messageId,
          });
        }
      }
      return { success: true, messageId, chatId: to };
    },

    async sendMedia(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> {
      const cfg = ctx.cfg as Config;
      const account = resolveFeishuAccount(cfg, ctx.accountId ?? 'default');
      if (!account.configured) {
        return { success: false, messageId: '', chatId: ctx.to, error: 'Feishu account is not configured' };
      }
      if (!ctx.mediaUrl?.trim()) {
        return { success: false, messageId: '', chatId: ctx.to, error: 'Feishu sendMedia requires mediaUrl' };
      }

      const loaded = await loadMediaForFeishu(cfg, ctx.mediaUrl, {
        maxBytes: 20 * 1024 * 1024,
        localRoots: ctx.mediaLocalRoots,
      });

      const { api } = createFeishuClient(account);

      const isImage = loaded.mimeType.startsWith('image/');
      if (isImage) {
        const up = await (api as any).im.v1.image.create({
          data: {
            image_type: 'message',
            image: loaded.stream,
          },
        });
        const imageKey = up?.data?.image_key ?? up?.image_key;
        if (!imageKey) {
          return { success: false, messageId: '', chatId: ctx.to, error: 'Feishu image upload failed' };
        }

        const res = ctx.replyToId
          ? await (api as any).im.message.reply({
              path: { message_id: ctx.replyToId },
              data: {
                msg_type: 'image',
                content: JSON.stringify({ image_key: imageKey }),
                ...(ctx.threadId ? { reply_in_thread: true } : {}),
              },
            })
          : await (api as any).im.message.create({
              params: { receive_id_type: isProbablyOpenId(ctx.to) ? 'open_id' : 'chat_id' },
              data: {
                receive_id: ctx.to,
                msg_type: 'image',
                content: JSON.stringify({ image_key: imageKey }),
              },
            });
        const messageId = res?.data?.message_id ?? res?.message_id ?? '';
        if (messageId && ctx.replyToId) {
          const parent = getFeishuBindingByMessageId(ctx.replyToId);
          if (parent) {
            recordFeishuMessageBinding({ ...parent, messageId });
          }
        }
        return { success: true, messageId, chatId: ctx.to };
      }

      const fileType = guessFileType(loaded.filename);
      const up = await (api as any).im.v1.file.create({
        data: {
          file_type: fileType,
          file_name: loaded.filename,
          file: loaded.stream,
        },
      });
      const fileKey = up?.data?.file_key ?? up?.file_key;
      if (!fileKey) {
        return { success: false, messageId: '', chatId: ctx.to, error: 'Feishu file upload failed' };
      }

      const res = ctx.replyToId
        ? await (api as any).im.message.reply({
            path: { message_id: ctx.replyToId },
            data: {
              msg_type: 'file',
              content: JSON.stringify({ file_key: fileKey }),
              ...(ctx.threadId ? { reply_in_thread: true } : {}),
            },
          })
        : await (api as any).im.message.create({
            params: { receive_id_type: isProbablyOpenId(ctx.to) ? 'open_id' : 'chat_id' },
            data: {
              receive_id: ctx.to,
              msg_type: 'file',
              content: JSON.stringify({ file_key: fileKey }),
            },
          });

      const messageId = res?.data?.message_id ?? res?.message_id ?? '';
      if (messageId && ctx.replyToId) {
        const parent = getFeishuBindingByMessageId(ctx.replyToId);
        if (parent) {
          recordFeishuMessageBinding({ ...parent, messageId });
        }
      }
      return { success: true, messageId, chatId: ctx.to };
    },
  };
}

function isProbablyOpenId(to: string): boolean {
  const t = to.trim();
  return t.startsWith('ou_') || t.startsWith('on_') || t.startsWith('open_id:') || t.startsWith('user:');
}

function guessFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!ext) return 'stream';
  return ext;
}


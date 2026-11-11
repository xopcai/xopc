import type {
  ChannelOutboundAdapter,
  ChannelOutboundContext,
  OutboundDeliveryResult,
} from '@xopcai/xopc/channels/plugin-types.js';
import type { Config } from '@xopcai/xopc/config/schema.js';

import { resolveFeishuAccount } from '../state/accounts.js';
import { loadMediaForFeishu } from './media-load.js';
import { getFeishuBindingByMessageId, recordFeishuMessageBinding } from '../state/message-bindings.js';

function messageIdFromResponse(response: { code?: number; data?: { message_id?: string }; message_id?: string } | undefined): string {
  return response?.code === 0 ? response.data?.message_id ?? response.message_id ?? '' : '';
}

function feishuRejectedRequest(error: unknown): boolean {
  const response = (error as { response?: { status?: number } } | null)?.response;
  return response?.status === 400 || response?.status === 403;
}

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

      const { createFeishuClient } = await import('../transport/client/client.js');
      const { api } = createFeishuClient(account);
      const to = ctx.to;
      const raw = ctx.text ?? '';
      const renderMode = account.renderMode ?? 'auto';
      const preferCard = renderMode === 'card' || renderMode === 'auto';

      const { formatFeishuOutboundText } = await import('../format.js');
      const cardBody = formatFeishuOutboundText({
        text: raw,
        renderMode,
        forCardMarkdown: true,
      });
      const plainBody = formatFeishuOutboundText({
        text: raw,
        renderMode,
        forCardMarkdown: false,
      });

      const receive_id_type = isProbablyOpenId(to) ? 'open_id' : 'chat_id';
      const payloadText = {
        msg_type: 'text',
        content: JSON.stringify({ text: plainBody }),
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
                content: cardBody,
              },
            ],
          },
        }),
      };

      const sourceMessage = ctx.outboundMetadata?.inboundMessageId;
      const replyToId = ctx.replyToId ?? (ctx.threadId && typeof sourceMessage === 'string' ? sourceMessage : undefined);
      const send = async (useCard: boolean) => {
        const p = useCard ? payloadCard : payloadText;
        return replyToId
          ? await (api as any).im.message.reply({
              path: { message_id: replyToId },
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

      let response;
      if (preferCard) {
        try {
          response = await send(true);
        } catch (err) {
          if (!feishuRejectedRequest(err)) throw err;
          response = { code: -1 };
        }
        if (typeof response?.code === 'number' && response.code !== 0
          && response.code !== 99991400 && response.code !== 99991403) {
          response = await send(false);
        }
      } else {
        response = await send(false);
      }

      const messageId = messageIdFromResponse(response);
      if (!messageId) return { success: false, messageId, chatId: to, error: 'Feishu did not confirm message delivery' };
      if (messageId && replyToId) {
        const parent = getFeishuBindingByMessageId(replyToId);
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

      const { createFeishuClient } = await import('../transport/client/client.js');
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
        const messageId = messageIdFromResponse(res);
        if (messageId && ctx.replyToId) {
          const parent = getFeishuBindingByMessageId(ctx.replyToId);
          if (parent) {
            recordFeishuMessageBinding({ ...parent, messageId });
          }
        }
        return { success: Boolean(messageId), messageId, chatId: ctx.to, ...(messageId ? {} : { error: 'Feishu did not confirm image delivery' }) };
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

      const messageId = messageIdFromResponse(res);
      if (messageId && ctx.replyToId) {
        const parent = getFeishuBindingByMessageId(ctx.replyToId);
        if (parent) {
          recordFeishuMessageBinding({ ...parent, messageId });
        }
      }
      return { success: Boolean(messageId), messageId, chatId: ctx.to, ...(messageId ? {} : { error: 'Feishu did not confirm file delivery' }) };
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


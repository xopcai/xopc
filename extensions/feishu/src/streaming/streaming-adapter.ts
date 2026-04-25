import type {
  ChannelStreamHandle,
  ChannelStreamingAdapter,
} from '@xopcai/xopc/channels/plugin-types.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import { resolveFeishuAccount } from '../state/accounts.js';
import { createFeishuClient } from '../transport/client/client.js';

const log = createLogger('FeishuStreaming');

export function createFeishuStreamingAdapter(getConfig: () => Config): ChannelStreamingAdapter {
  return {
    startStream(options: {
      chatId: string;
      accountId?: string;
      threadId?: string;
      replyToMessageId?: string;
      parseMode?: 'Markdown' | 'HTML';
    }): ChannelStreamHandle | null {
      // Implement a pragmatic "stream by editing text" mode first.
      // Card Kit streaming can replace this later without changing the ChannelManager API.
      const cfg = getConfig();
      const account = resolveFeishuAccount(cfg, options.accountId ?? 'default');
      if (!account.configured) {
        return null;
      }
      const { api } = createFeishuClient(account);

      let messageId: string | undefined;
      let lastText = '';
      let timer: NodeJS.Timeout | null = null;
      let aborted = false;
      let editedAtLeastOnce = false;
      let ready: Promise<void> | null = null;

      const edit = async (text: string) => {
        if (ready) await ready;
        if (!messageId) return;
        await (api as any).im.v1.message.update({
          path: { message_id: messageId },
          data: { msg_type: 'text', content: JSON.stringify({ text }) },
        });
        editedAtLeastOnce = true;
      };

      const flush = async () => {
        if (aborted) return;
        if (ready) await ready;
        if (!messageId) return;
        const text = lastText;
        if (!text.trim()) return;
        try {
          await edit(text);
        } catch (err) {
          // Don't crash the agent loop — if editing fails, fall back to final outbound send.
          log.warn({ err, accountId: account.accountId, messageId }, 'Feishu streaming edit failed');
        }
      };

      const start = async () => {
        const receive_id_type =
          options.chatId.startsWith('ou_') || options.chatId.startsWith('on_') ? 'open_id' : 'chat_id';
        const res = options.replyToMessageId
          ? await (api as any).im.message.reply({
              path: { message_id: options.replyToMessageId },
              data: {
                msg_type: 'text',
                content: JSON.stringify({ text: 'Thinking…' }),
                ...(options.threadId ? { reply_in_thread: true } : {}),
              },
            })
          : await (api as any).im.message.create({
              params: { receive_id_type },
              data: {
                receive_id: options.chatId,
                msg_type: 'text',
                content: JSON.stringify({ text: 'Thinking…' }),
              },
            });
        messageId = res?.data?.message_id ?? res?.message_id ?? undefined;
      };

      ready = start().catch((err) => {
        log.warn({ err, accountId: account.accountId }, 'Feishu streaming start failed');
      });

      return {
        update: (text: string) => {
          lastText = text;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            void flush().catch((err) => log.warn({ err }, 'Feishu streaming flush failed'));
          }, 800);
        },
        end: async () => {
          if (timer) clearTimeout(timer);
          await flush();
        },
        abort: async () => {
          aborted = true;
          if (timer) clearTimeout(timer);
        },
        messageId: () => undefined,
        skipFinalOutbound: () => Boolean(messageId) && editedAtLeastOnce,
        updateProgress: undefined,
        setProgress: undefined,
      };
    },
  };
}


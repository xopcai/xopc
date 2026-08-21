import { randomUUID } from 'node:crypto';

import type {
  ChannelStreamHandle,
  ChannelStreamingAdapter,
} from '@xopcai/xopc/channels/plugin-types.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import { resolveFeishuAccount } from '../state/accounts.js';
import { getFeishuBindingByMessageId, recordFeishuMessageBinding } from '../state/message-bindings.js';

const log = createLogger('FeishuStreaming');

/** Normalize CardKit `card.create` responses (SDK / OpenAPI envelope shapes differ). */
function extractFeishuCardKitCreateCardId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const tryId = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  };

  const fromData = (data: unknown): string | undefined => {
    if (!data || typeof data !== 'object') return undefined;
    const d = data as Record<string, unknown>;
    return tryId(d.card_id) ?? tryId(d.cardId);
  };

  return (
    fromData(o.data) ??
    (o.data && typeof o.data === 'object' ? fromData((o.data as Record<string, unknown>).data) : undefined) ??
    tryId(o.card_id)
  );
}

function feishuOpenApiOk(res: unknown): boolean {
  if (res === null || res === undefined) return false;
  if (typeof res !== 'object') return true;
  const code = (res as Record<string, unknown>).code;
  if (code === undefined || code === null) return true;
  return Number(code) === 0;
}

export function createFeishuStreamingAdapter(getConfig: () => Config): ChannelStreamingAdapter {
  return {
    startStream(options: {
      chatId: string;
      accountId?: string;
      threadId?: string;
      replyToMessageId?: string;
      parseMode?: 'Markdown' | 'HTML';
    }): ChannelStreamHandle | null {
      const cfg = getConfig();
      const account = resolveFeishuAccount(cfg, options.accountId ?? 'default');
      if (!account.configured) {
        return null;
      }
      // Feishu streaming is opt-in. When omitted/false, fall back to normal final outbound.
      if (account.streaming !== true) {
        return null;
      }
      let apiPromise: Promise<unknown> | null = null;
      const getApi = async () => {
        apiPromise ??= import('../transport/client/client.js').then(({ createFeishuClient }) => createFeishuClient(account).api);
        return apiPromise;
      };

      let messageId: string | undefined;
      let lastText = '';
      let timer: NodeJS.Timeout | null = null;
      let aborted = false;
      let editedAtLeastOnce = false;
      let ready: Promise<void> | null = null;
      let cardId: string | undefined;
      let cardSeq = 0;
      const cardElementId = `md_${randomUUID().replace(/-/g, '')}`;
      let fallbackSent = false;

      const renderMode = account.renderMode ?? 'auto';
      const preferCard = renderMode === 'card' || renderMode === 'auto';

      const formatStreamText = async (text: string) => {
        if (!text.trim()) return text;
        if (text.trim() === 'Thinking…') return text;
        const forCardMarkdown = Boolean(preferCard && cardId);
        const { formatFeishuOutboundText } = await import('../format.js');
        return formatFeishuOutboundText({
          text,
          renderMode,
          forCardMarkdown,
        });
      };

      const recordBindingIfReply = (childMessageId: string) => {
        if (!childMessageId) return;
        const parentId = options.replyToMessageId;
        if (!parentId) return;
        const parent = getFeishuBindingByMessageId(parentId);
        if (!parent) return;
        recordFeishuMessageBinding({ ...parent, messageId: childMessageId });
      };

      const edit = async (text: string) => {
        if (ready) await ready;
        if (!messageId) return;
        const outbound = await formatStreamText(text);
        if (cardId && preferCard) {
          cardSeq += 1;
          await ((await getApi()) as any).cardkit.v1.cardElement.content({
            path: { card_id: cardId, element_id: cardElementId },
            data: {
              content: outbound,
              sequence: cardSeq,
              uuid: `${cardId}:${cardSeq}`,
            },
          });
        } else {
          await ((await getApi()) as any).im.v1.message.update({
            path: { message_id: messageId },
            data: { msg_type: 'text', content: JSON.stringify({ text: outbound }) },
          });
        }
        editedAtLeastOnce = true;
      };

      const sendFallbackText = async (text: string) => {
        if (fallbackSent) return;
        fallbackSent = true;
        const receive_id_type =
          options.chatId.startsWith('ou_') || options.chatId.startsWith('on_') ? 'open_id' : 'chat_id';
        try {
          const outbound = await formatStreamText(text);
          const res = options.replyToMessageId
            ? await ((await getApi()) as any).im.message.reply({
                path: { message_id: options.replyToMessageId },
                data: {
                  msg_type: 'text',
                  content: JSON.stringify({ text: outbound }),
                  ...(options.threadId ? { reply_in_thread: true } : {}),
                },
              })
            : await ((await getApi()) as any).im.message.create({
                params: { receive_id_type },
                data: {
                  receive_id: options.chatId,
                  msg_type: 'text',
                  content: JSON.stringify({ text: outbound }),
                },
              });
          const mid = res?.data?.message_id ?? res?.message_id ?? undefined;
          if (mid) recordBindingIfReply(mid);
          // Mark as delivered through the channel so the final outbound is skipped.
          editedAtLeastOnce = true;
          messageId = mid ?? messageId;
          // If we were in card mode, stop trying to update the card.
          cardId = undefined;
        } catch (err) {
          log.warn({ err, accountId: account.accountId }, 'Feishu streaming fallback send failed');
        }
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
          // Don't crash the agent loop. CardKit updates can fail (scopes, element conflicts); plain
          // `im.message.update` can also fail for some message states — always fall back to a text
          // reply so the user is not stuck on "Thinking…".
          log.warn({ err, accountId: account.accountId, messageId, mode: preferCard ? 'card' : 'text' }, 'Feishu streaming edit failed');
          await sendFallbackText(text);
        }
      };

      const start = async () => {
        const receive_id_type =
          options.chatId.startsWith('ou_') || options.chatId.startsWith('on_') ? 'open_id' : 'chat_id';
        const thinking = 'Thinking…';

        if (preferCard) {
          const cardSpec = {
            schema: '2.0',
            config: { update_multi: true },
            header: {
              title: { tag: 'plain_text', content: 'xopc' },
            },
            body: {
              elements: [
                {
                  tag: 'markdown',
                  element_id: cardElementId,
                  content: thinking,
                },
              ],
            },
          };

          let created: unknown;
          try {
            created = await ((await getApi()) as any).cardkit.v1.card.create({
              data: { type: 'card_json', data: JSON.stringify(cardSpec) },
            });
          } catch (err) {
            log.warn({ err, accountId: account.accountId }, 'Feishu cardkit.card.create threw; falling back to text stream');
            created = null;
          }

          const apiOk = feishuOpenApiOk(created);
          cardId = apiOk ? extractFeishuCardKitCreateCardId(created) : undefined;

          if (!apiOk) {
            log.warn(
              {
                accountId: account.accountId,
                code: (created as Record<string, unknown> | null)?.code,
                msg: (created as Record<string, unknown> | null)?.msg,
              },
              'Feishu cardkit.card.create returned non-zero code; falling back to text stream',
            );
          } else if (!cardId) {
            log.warn(
              { accountId: account.accountId, responsePreview: JSON.stringify(created).slice(0, 400) },
              'Feishu cardkit.card.create returned no card_id; falling back to text stream',
            );
          }

          if (cardId) {
            const res = options.replyToMessageId
              ? await ((await getApi()) as any).im.message.reply({
                  path: { message_id: options.replyToMessageId },
                  data: {
                    msg_type: 'interactive',
                    content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
                    ...(options.threadId ? { reply_in_thread: true } : {}),
                  },
                })
              : await ((await getApi()) as any).im.message.create({
                  params: { receive_id_type },
                  data: {
                    receive_id: options.chatId,
                    msg_type: 'interactive',
                    content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
                  },
                });
            messageId = res?.data?.message_id ?? res?.message_id ?? undefined;
            if (messageId) recordBindingIfReply(messageId);
            log.info(
              { accountId: account.accountId, chatId: options.chatId, messageId, mode: 'card' },
              'Feishu streaming started',
            );
            return;
          }

          // Clear so downstream edits use im.message.update (text), not CardKit.
          cardId = undefined;
        }

        const res = options.replyToMessageId
          ? await ((await getApi()) as any).im.message.reply({
              path: { message_id: options.replyToMessageId },
              data: {
                msg_type: 'text',
                content: JSON.stringify({ text: thinking }),
                ...(options.threadId ? { reply_in_thread: true } : {}),
              },
            })
          : await ((await getApi()) as any).im.message.create({
              params: { receive_id_type },
              data: {
                receive_id: options.chatId,
                msg_type: 'text',
                content: JSON.stringify({ text: thinking }),
              },
            });
        messageId = res?.data?.message_id ?? res?.message_id ?? undefined;
        if (messageId) recordBindingIfReply(messageId);
        log.info(
          { accountId: account.accountId, chatId: options.chatId, messageId, mode: 'text' },
          'Feishu streaming started',
        );
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
          log.debug(
            {
              accountId: account.accountId,
              chatId: options.chatId,
              messageId,
              editedAtLeastOnce,
              lastTextLen: lastText.length,
              mode: preferCard ? 'card' : 'text',
            },
            'Feishu streaming ended',
          );
        },
        abort: async () => {
          aborted = true;
          if (timer) clearTimeout(timer);
        },
        messageId: () => undefined,
        skipFinalOutbound: () => Boolean(messageId) && editedAtLeastOnce,
      };
    },
  };
}

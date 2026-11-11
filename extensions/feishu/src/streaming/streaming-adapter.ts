import { randomUUID } from 'node:crypto';

import type {
  ChannelStreamHandle,
  ChannelStreamingAdapter,
} from '@xopcai/xopc/channels/plugin-types.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import { createRetryRunner } from '@xopcai/xopc/infra/retry.js';
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

function feishuOpenApiOk(response: unknown): boolean {
  return Boolean(response && typeof response === 'object' && Number((response as { code?: number }).code) === 0);
}

class FeishuUpdateError extends Error {
  constructor(readonly code: number) {
    super('Feishu rejected the stream update');
  }
}

function checkUpdate(response: unknown): void {
  if (!feishuOpenApiOk(response)) throw new FeishuUpdateError(Number((response as { code?: number } | undefined)?.code));
}

function isRateLimited(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { code?: number } } } | null)?.response;
  const code = error instanceof FeishuUpdateError ? error.code : response?.data?.code;
  return code === 99991400 || code === 230020 || (response?.status === 429 && code !== 99991403);
}

const retryEdit = createRetryRunner({
  attempts: 3,
  minDelayMs: 500,
  maxDelayMs: 2500,
  shouldRetry: isRateLimited,
});

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
      let ending = false;
      let previewPending = false;
      let deliveredText: string | undefined;
      let finalDelivered = false;
      let editQueue = Promise.resolve();
      let ready: Promise<void> | null = null;
      let cardId: string | undefined;
      let cardSeq = 0;
      const cardElementId = `md_${randomUUID().replace(/-/g, '')}`;

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
          const response = await ((await getApi()) as any).cardkit.v1.cardElement.content({
            path: { card_id: cardId, element_id: cardElementId },
            data: {
              content: outbound,
              sequence: cardSeq,
              uuid: `${cardId}:${cardSeq}`,
            },
          });
          checkUpdate(response);
        } else {
          const response = await ((await getApi()) as any).im.v1.message.update({
            path: { message_id: messageId },
            data: { msg_type: 'text', content: JSON.stringify({ text: outbound }) },
          });
          checkUpdate(response);
        }
        deliveredText = text;
      };

      const closeCard = async () => {
        if (!cardId) return;
        const id = cardId;
        cardId = undefined;
        try {
          const api = (await getApi()) as any;
          const sequence = ++cardSeq;
          await retryEdit(async () => {
            const result = await api.cardkit.v1.card.settings({
              path: { card_id: id },
              data: {
                settings: JSON.stringify({ config: { streaming_mode: false } }),
                sequence,
                uuid: `${id}:close:${sequence}`,
              },
            });
            checkUpdate(result);
          }, 'closeFeishuStream');
        } catch (err) {
          log.warn({ accountId: account.accountId, errorType: err instanceof Error ? err.name : typeof err }, 'Feishu streaming card could not be closed');
        }
      };

      const flush = (final = false) => {
        editQueue = editQueue.then(async () => {
          if (ready) await ready;
          if (aborted || !lastText.trim()) return;
          const text = lastText;
          if (text !== deliveredText) {
            try {
              if (messageId) await retryEdit(() => edit(text), 'updateFeishuStream');
            } catch (err) {
              log.warn({ err, accountId: account.accountId, messageId }, 'Feishu streaming edit failed');
            }
          }
          if (final && !aborted) finalDelivered = text === deliveredText;
        });
        return editQueue;
      };

      const start = async () => {
        const receive_id_type =
          options.chatId.startsWith('ou_') || options.chatId.startsWith('on_') ? 'open_id' : 'chat_id';
        const thinking = 'Thinking…';

        if (preferCard) {
          const cardSpec = {
            schema: '2.0',
            config: { update_multi: true, streaming_mode: true },
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
            messageId = feishuOpenApiOk(res) ? res?.data?.message_id ?? res?.message_id : undefined;
            if (messageId) recordBindingIfReply(messageId);
            log.info(
              { accountId: account.accountId, chatId: options.chatId, messageId, mode: 'card' },
              'Feishu streaming started',
            );
            if (messageId) return;
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
        messageId = feishuOpenApiOk(res) ? res?.data?.message_id ?? res?.message_id : undefined;
        if (messageId) recordBindingIfReply(messageId);
        log.info(
          { accountId: account.accountId, chatId: options.chatId, messageId, mode: 'text' },
          'Feishu streaming started',
        );
      };

      ready = start().catch((err) => {
        log.warn({ err, accountId: account.accountId }, 'Feishu streaming start failed');
      });

      const schedulePreview = () => {
        if (timer || ending || aborted || previewPending) return;
        timer = setTimeout(() => {
          timer = null;
          previewPending = true;
          const queuedText = lastText;
          void flush().catch(err => log.warn({ err }, 'Feishu streaming flush failed')).finally(() => {
            previewPending = false;
            if (queuedText !== lastText) schedulePreview();
          });
        }, 800);
      };

      return {
        update: (text: string) => {
          lastText = text;
          schedulePreview();
        },
        end: async () => {
          ending = true;
          if (timer) clearTimeout(timer);
          await flush(true);
          await closeCard();
          log.debug(
            {
              accountId: account.accountId,
              chatId: options.chatId,
              messageId,
              finalDelivered,
              lastTextLen: lastText.length,
              mode: preferCard ? 'card' : 'text',
            },
            'Feishu streaming ended',
          );
        },
        abort: async () => {
          aborted = true;
          if (timer) clearTimeout(timer);
          await ready;
          await editQueue;
          await closeCard();
        },
        messageId: () => undefined,
        skipFinalOutbound: () => finalDelivered,
      };
    },
  };
}

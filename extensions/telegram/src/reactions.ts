import type { Bot, Context } from 'grammy';
import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import { sentMessageCache } from './sent-cache.js';

const log = createLogger('TelegramReactions');

export async function sendTelegramAckReaction(params: {
  bot: Bot;
  chatId: number | string;
  messageId: number;
  emoji: string;
}): Promise<void> {
  try {
    await params.bot.api.setMessageReaction(params.chatId, params.messageId, [
      { type: 'emoji', emoji: params.emoji as '👀' },
    ]);
  } catch (err) {
    log.debug({ err, chatId: params.chatId, messageId: params.messageId }, 'Ack reaction failed');
  }
}

export async function handleTelegramMessageReaction(params: {
  ctx: Context;
  accountId: string;
  bus: MessageBus;
  mode?: 'off' | 'own' | 'all';
}): Promise<void> {
  const { ctx, accountId, bus } = params;
  const mode = params.mode ?? 'own';
  if (mode === 'off') return;

  const update = ctx.messageReaction ?? (ctx.update as { message_reaction?: typeof ctx.messageReaction }).message_reaction;
  if (!update) return;

  const chatId = update.chat.id;
  const messageId = update.message_id;
  if (mode === 'own' && !sentMessageCache.wasSentByBot(String(chatId), messageId)) {
    return;
  }

  const added = update.new_reaction?.map((r) => ('emoji' in r ? r.emoji : r.type)).join(', ');
  if (!added) return;

  await bus.publishInbound({
    channel: 'telegram',
    chat_id: String(chatId),
    sender_id: String(update.user?.id ?? update.actor_chat?.id ?? ''),
    content: `[Reaction] ${added} on message ${messageId}`,
    metadata: {
      accountId,
      messageId: String(messageId),
      isReaction: true,
      reaction: added,
    },
  });
}

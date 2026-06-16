import type { Bot } from 'grammy';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

const log = createLogger('TelegramActions');

export async function telegramSetReaction(params: {
  bot: Bot;
  chatId: string;
  messageId: number;
  emoji: string;
}): Promise<boolean> {
  try {
    await params.bot.api.setMessageReaction(params.chatId, params.messageId, [
      { type: 'emoji', emoji: params.emoji as '👍' },
    ]);
    return true;
  } catch (err) {
    log.warn({ err, chatId: params.chatId, messageId: params.messageId }, 'setMessageReaction failed');
    return false;
  }
}

export async function telegramEditMessage(params: {
  bot: Bot;
  chatId: string;
  messageId: number;
  text: string;
}): Promise<boolean> {
  try {
    await params.bot.api.editMessageText(params.chatId, params.messageId, params.text);
    return true;
  } catch (err) {
    log.warn({ err, chatId: params.chatId, messageId: params.messageId }, 'editMessageText failed');
    return false;
  }
}

export async function telegramDeleteMessage(params: {
  bot: Bot;
  chatId: string;
  messageId: number;
}): Promise<boolean> {
  try {
    await params.bot.api.deleteMessage(params.chatId, params.messageId);
    return true;
  } catch (err) {
    log.warn({ err, chatId: params.chatId, messageId: params.messageId }, 'deleteMessage failed');
    return false;
  }
}

export async function telegramSendPoll(params: {
  bot: Bot;
  chatId: string;
  question: string;
  options: string[];
  threadId?: number;
}): Promise<number | undefined> {
  try {
    const result = await params.bot.api.sendPoll(params.chatId, params.question, params.options, {
      ...(params.threadId ? { message_thread_id: params.threadId } : {}),
      is_anonymous: true,
    });
    return result.message_id;
  } catch (err) {
    log.warn({ err, chatId: params.chatId }, 'sendPoll failed');
    return undefined;
  }
}

/**
 * Debouncer key / policy for coalescing short Telegram messages.
 */

import type { Context } from 'grammy';
import type { Message } from '@grammyjs/types';

export interface TelegramMessageEvent {
  ctx: Context;
  accountId: string;
  message: Message;
}

export function telegramDebouncerKeyPolicy() {
  return {
    buildKey: (item: TelegramMessageEvent) => {
      const chatId = item.ctx.chat?.id?.toString();
      const userId = item.ctx.from?.id?.toString();
      if (!chatId || !userId) return undefined;
      return `telegram:${item.accountId}:${chatId}:${userId}`;
    },
    shouldDebounce: (item: TelegramMessageEvent) => {
      const text = item.message.text ?? item.message.caption ?? '';
      if (text.startsWith('/')) return false;
      if (item.message.photo || item.message.document || item.message.video) return false;
      return text.length < 100;
    },
  };
}

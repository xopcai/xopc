import type { ChannelMessageActionContext } from '@xopcai/xopc/channels/plugin-types.js';
import type { TelegramAccountManager } from '../account-manager.js';
import {
  telegramDeleteMessage,
  telegramEditMessage,
  telegramSendPoll,
  telegramSetReaction,
} from '../telegram-actions.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

const log = createLogger('TelegramMessageActions');

let accountManagerRef: TelegramAccountManager | null = null;

export function bindTelegramMessageActionAccountManager(manager: TelegramAccountManager): void {
  accountManagerRef = manager;
}

export async function handleTelegramChannelAction(ctx: ChannelMessageActionContext): Promise<void> {
  const manager = accountManagerRef;
  if (!manager) {
    log.warn('Telegram message actions: account manager not bound');
    return;
  }

  const bot = manager.getBot(ctx.accountId);
  if (!bot) {
    log.warn({ accountId: ctx.accountId }, 'Telegram message actions: bot unavailable');
    return;
  }

  const messageId = Number.parseInt(ctx.messageId, 10);
  if (!Number.isFinite(messageId)) {
    return;
  }

  switch (ctx.action) {
    case 'react': {
      const emoji = ctx.data?.trim() || '👍';
      await telegramSetReaction({ bot, chatId: ctx.chatId, messageId, emoji });
      break;
    }
    case 'edit': {
      const text = ctx.data?.trim();
      if (text) {
        await telegramEditMessage({ bot, chatId: ctx.chatId, messageId, text });
      }
      break;
    }
    case 'delete':
      await telegramDeleteMessage({ bot, chatId: ctx.chatId, messageId });
      break;
    case 'poll': {
      try {
        const parsed = JSON.parse(ctx.data) as { question?: string; options?: string[] };
        if (parsed.question && Array.isArray(parsed.options) && parsed.options.length >= 2) {
          await telegramSendPoll({
            bot,
            chatId: ctx.chatId,
            question: parsed.question,
            options: parsed.options.slice(0, 10),
          });
        }
      } catch {
        log.warn({ dataPreview: ctx.data.slice(0, 80) }, 'Invalid poll action payload');
      }
      break;
    }
    default:
      log.debug({ action: ctx.action }, 'Unhandled Telegram message action');
  }
}

import type { Context } from 'grammy';
import type { Config } from '@xopcai/xopc/config/index.js';
import { generateSessionKey } from '@xopcai/xopc/chat-commands/session-key.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import {
  clearTelegramThreadBinding,
  getTelegramThreadBinding,
  setTelegramThreadBinding,
} from './thread-bindings.js';
import { buildTelegramConversationId } from './conversation-id.js';

const log = createLogger('TelegramFocus');

export async function handleTelegramFocusCommand(params: {
  ctx: Context;
  accountId: string;
  config: Config;
}): Promise<void> {
  const { ctx, accountId } = params;
  const chatId = String(ctx.chat?.id ?? '');
  const senderId = String(ctx.from?.id ?? '');
  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  const threadId = (ctx.message as { message_thread_id?: number } | undefined)?.message_thread_id;
  const text = ctx.message?.text?.trim() ?? '';
  const parts = text.split(/\s+/);
  const sub = parts[1]?.toLowerCase();

  if (sub === 'off' || sub === 'clear') {
    clearTelegramThreadBinding(chatId, threadId != null ? String(threadId) : undefined);
    await ctx.reply('Thread focus cleared.');
    return;
  }

  const sessionKey =
    parts.length > 1 && parts[1] && !parts[1].startsWith('/')
      ? parts.slice(1).join(' ').trim()
      : generateSessionKey({
          source: 'telegram',
          chatId,
          senderId,
          isGroup,
          threadId: threadId != null ? String(threadId) : undefined,
          accountId,
        });

  setTelegramThreadBinding({
    sessionKey,
    chatId,
    threadId: threadId != null ? String(threadId) : undefined,
    createdAtMs: Date.now(),
    lastActivityMs: Date.now(),
  });

  log.info(
    { accountId, chatId, threadId, sessionKey, conversationId: buildTelegramConversationId(chatId, threadId) },
    'Telegram thread focus set',
  );

  await ctx.reply(`Focused on session:\n${sessionKey}`);
}

export function resolveTelegramFocusedSessionKey(params: {
  chatId: string;
  threadId?: string;
  defaultSessionKey: string;
}): string {
  const binding = getTelegramThreadBinding(params.chatId, params.threadId);
  if (!binding) {
    return params.defaultSessionKey;
  }
  binding.lastActivityMs = Date.now();
  return binding.sessionKey;
}

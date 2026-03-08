/**
 * Telegram Channel Adapter
 *
 * Adapts Telegram messages to the unified command system format.
 */

import type { Context } from 'grammy';
import type {
  ChannelAdapter,
  UnifiedMessage,
  PlatformMetadata,
  MessageAttachment,
  ReplyPayload,
  PlatformFeature,
} from '../../commands/types.js';
import type { Config } from '../../config/schema.js';
import { generateSessionKey } from '../../commands/session-key.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('TelegramAdapter');

export class TelegramAdapter implements ChannelAdapter {
  readonly id = 'telegram' as const;
  readonly name = 'Telegram';
  readonly features: PlatformFeature[] = [
    'buttons',
    'markdown',
    'html',
    'threads',
    'edit',
    'typing',
    'voice',
  ];

  private config?: Config;

  async init(config: Config): Promise<void> {
    this.config = config;
    log.info('Telegram adapter initialized');
  }

  async start(): Promise<void> {
    log.info('Telegram adapter started');
  }

  async stop(): Promise<void> {
    log.info('Telegram adapter stopped');
  }

  /**
   * Convert Telegram message to unified format
   */
  async normalizeMessage(ctx: Context): Promise<UnifiedMessage | null> {
    const message = ctx.message;
    if (!message) return null;

    const chat = ctx.chat;
    if (!chat) return null;

    const from = ctx.from;
    if (!from) return null;

    const chatId = String(chat.id);
    const senderId = String(from.id);
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';
    const threadId = (message as any).message_thread_id
      ? String((message as any).message_thread_id)
      : undefined;

    // Get content
    let content = message.text ?? message.caption ?? '';

    // Handle voice message transcription
    let attachments: MessageAttachment[] | undefined;
    if (message.voice || message.audio) {
      // Voice transcription would be handled by the plugin
      // Here we just mark it as a voice attachment
      attachments = [{
        type: 'voice',
        mimeType: message.voice?.mime_type || message.audio?.mime_type,
      }];
    }

    // Handle photos
    if (message.photo?.length) {
      attachments = attachments || [];
      const _photo = message.photo[message.photo.length - 1];
      attachments.push({
        type: 'photo',
        mimeType: 'image/jpeg',
      });
    }

    // Check if it's a command
    const isCommand = content.startsWith('/');
    let commandName: string | undefined;
    let commandArgs: string | undefined;

    if (isCommand) {
      const withoutPrefix = content.slice(1);
      const spaceIndex = withoutPrefix.indexOf(' ');
      if (spaceIndex === -1) {
        commandName = withoutPrefix;
        commandArgs = '';
      } else {
        commandName = withoutPrefix.slice(0, spaceIndex);
        commandArgs = withoutPrefix.slice(spaceIndex + 1).trim();
      }

      // Remove bot username from command (e.g., /new@botname -> /new)
      const atIndex = commandName.indexOf('@');
      if (atIndex !== -1) {
        commandName = commandName.slice(0, atIndex);
      }
    }

    // Generate unified session key
    const sessionKey = generateSessionKey({
      source: 'telegram',
      chatId,
      senderId,
      isGroup,
      threadId,
    });

    const platformData: PlatformMetadata = {
      messageId: String(message.message_id),
      threadId,
      isGroup,
      isForum: chat.type === 'supergroup' && (chat as any).is_forum,
      botUsername: ctx.me?.username,
      raw: ctx,
    };

    return {
      source: 'telegram',
      channelId: 'telegram:default', // TODO: support multi-account
      chatId,
      senderId,
      senderName: from.username || from.first_name,
      content,
      isCommand,
      commandName,
      commandArgs,
      sessionKey,
      platformData,
      attachments,
      timestamp: message.date * 1000,
    };
  }

  /**
   * Send a reply to Telegram
   */
  async sendReply(chatId: string, reply: ReplyPayload): Promise<void> {
    // This would be called by the command context
    // Implementation depends on the bot instance
    log.debug({ chatId, textLength: reply.text.length }, 'Sending reply');
  }

  /**
   * Set typing indicator
   */
  async setTyping(chatId: string, typing: boolean): Promise<void> {
    log.debug({ chatId, typing }, 'Setting typing indicator');
  }
}

export const telegramAdapter = new TelegramAdapter();

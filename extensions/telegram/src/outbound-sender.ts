/**
 * Telegram Outbound Sender
 *
 * Handles all outbound message sending to Telegram:
 * - Text messages (with chunking)
 * - Data URL media (base64 encoded)
 * - Remote URL media
 * - Voice messages (TTS audio)
 * - Typing indicators
 *
 * TTS audio is passed as mediaUrl with audioAsVoice flag.
 * No TTS generation happens here - it's done at the dispatch layer.
 */

import type { Bot } from 'grammy';
import { GrammyError, InputFile } from 'grammy';
import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelSendOptions, ChannelSendResult } from '@xopcai/xopc/channels/channel-domain.js';
import type { TelegramAccountManager } from './account-manager.js';
import { buildSendOptions, parseDataUrl, resolveMediaMethod } from './send-options.js';
import { splitTelegramCaption } from './caption.js';
import { renderTelegramHtmlText, markdownToTelegramChunks } from './format.js';
import { sentMessageCache } from './sent-cache.js';
import { createRetryRunner } from '@xopcai/xopc/infra/retry.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import { sendTelegramRichMessage } from './rich-message.js';
import { isTelegramHtmlParseError } from './errors.js';

const log = createLogger('TelegramOutboundSender');

/** Maximum message chunk size */
const MESSAGE_CHUNK_SIZE = 3800;

export interface OutboundSenderDeps {
  accountManager: TelegramAccountManager;
  config: Config;
}

/**
 * Create outbound message sender
 *
 * Note: TTS is handled at the dispatch layer (ChannelManager),
 * not here. If a message has TTS audio, it will be passed as
 * mediaUrl with audioAsVoice=true.
 */
export function createOutboundSender(deps: OutboundSenderDeps) {
  const { accountManager } = deps;

  async function send(options: ChannelSendOptions): Promise<ChannelSendResult> {
    const {
      chatId,
      content,
      type = 'message',
      accountId = 'default',
      threadId,
      replyToMessageId,
      mediaUrl,
      mediaType,
      silent,
      audioAsVoice,
    } = options;

    log.debug({
      chatId,
      accountId,
      hasContent: !!content,
      hasMediaUrl: !!mediaUrl,
      audioAsVoice,
      mediaType,
    }, 'Sending outbound message');

    const bot = accountManager.getBot(accountId);
    if (!bot) {
      log.error({ accountId }, 'Bot not found');
      return { messageId: '', chatId, success: false, error: 'Bot not initialized' };
    }

    // Handle typing indicators
    if (type === 'typing_on') {
      try {
        await bot.api.sendChatAction(chatId, 'typing');
      } catch (err) {
        log.warn({ err }, 'Failed to send typing action');
      }
      return { messageId: '', chatId, success: true };
    }

    if (type === 'typing_off') {
      return { messageId: '', chatId, success: true };
    }

    // Skip empty messages without media
    if ((!content || content.trim() === '') && !mediaUrl) {
      log.debug({ chatId }, 'Skipping empty message');
      return { messageId: '', chatId, success: true };
    }

    try {
      let sentMessageId: number;

      // Handle voice messages (TTS audio with audioAsVoice flag)
      if (mediaUrl && audioAsVoice) {
        sentMessageId = await sendVoiceMessage(bot, chatId, mediaUrl, content, {
          threadId,
          replyToMessageId,
          silent,
        });
      }
      // Handle data URL media
      else if (mediaUrl && mediaUrl.startsWith('data:')) {
        sentMessageId = await sendDataUrlMedia(bot, chatId, mediaUrl, content, {
          threadId,
          replyToMessageId,
          silent,
        });
      }
      // Handle remote URL media
      else if (mediaUrl) {
        sentMessageId = await sendRemoteUrlMedia(bot, chatId, mediaUrl, mediaType, content, {
          threadId,
          replyToMessageId,
          silent,
        });
      }
      // Handle text only
      else {
        sentMessageId = await sendTextMessage(bot, chatId, content!, {
          threadId,
          replyToMessageId,
          silent,
        });
      }

      // Record sent message
      if (sentMessageId) {
        sentMessageCache.record(chatId, sentMessageId);
      }

      return { messageId: String(sentMessageId), chatId, success: true };
    } catch (err) {
      log.error({ chatId, err }, 'Failed to send message');
      return { messageId: '', chatId, success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function sendVoiceMessage(
    bot: Bot,
    chatId: string,
    mediaUrl: string,
    content?: string,
    options?: { threadId?: string; replyToMessageId?: string; silent?: boolean }
  ): Promise<number> {
    const parsed = parseDataUrl(mediaUrl);
    if (!parsed) {
      throw new Error('Invalid voice message data URL format');
    }

    const { buffer } = parsed;
    const file = new InputFile(buffer, 'voice.ogg');

    // Use caption for the text content (if any)
    const caption = content?.trim();
    const htmlCaption = caption ? renderTelegramHtmlText(caption) : undefined;

    const sendOptions = buildSendOptions({
      threadId: options?.threadId,
      replyToMessageId: options?.replyToMessageId,
      silent: options?.silent,
      caption: htmlCaption,
    });

    const result = await bot.api.sendVoice(chatId, file, sendOptions);

    log.info({ chatId, messageId: result.message_id }, 'Voice message sent');

    return result.message_id;
  }

  async function sendDataUrlMedia(
    bot: Bot,
    chatId: string,
    dataUrl: string,
    content?: string,
    options?: { threadId?: string; replyToMessageId?: string; silent?: boolean }
  ): Promise<number> {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      throw new Error('Invalid data URL format');
    }

    const { mimeType, buffer } = parsed;
    const file = new InputFile(buffer);

    const { caption, followUpText } = content ? splitTelegramCaption(content) : { caption: '', followUpText: undefined };
    const htmlCaption = caption ? renderTelegramHtmlText(caption) : undefined;

    const sendOptions = buildSendOptions({
      threadId: options?.threadId,
      replyToMessageId: options?.replyToMessageId,
      silent: options?.silent,
      caption: htmlCaption,
    });

    const method = resolveMediaMethod(mimeType);
    let result: { message_id: number };

    switch (method) {
      case 'sendPhoto':
        result = await bot.api.sendPhoto(chatId, file, sendOptions);
        break;
      case 'sendVideo':
        result = await bot.api.sendVideo(chatId, file, sendOptions);
        break;
      case 'sendAudio':
        result = await bot.api.sendAudio(chatId, file, sendOptions);
        break;
      default:
        result = await bot.api.sendDocument(chatId, file, sendOptions);
    }

    // Send follow-up text if needed
    if (followUpText) {
      const followHtml = renderTelegramHtmlText(followUpText);
      const followResult = await bot.api.sendMessage(chatId, followHtml, {
        parse_mode: 'HTML',
        reply_to_message_id: result.message_id,
      });
      sentMessageCache.record(chatId, followResult.message_id);
    }

    return result.message_id;
  }

  async function sendRemoteUrlMedia(
    bot: Bot,
    chatId: string,
    mediaUrl: string,
    mediaType?: string,
    content?: string,
    options?: { threadId?: string; replyToMessageId?: string; silent?: boolean }
  ): Promise<number> {
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const file = new InputFile(Buffer.from(buffer));

    const { caption, followUpText } = content ? splitTelegramCaption(content) : { caption: '', followUpText: undefined };
    const htmlCaption = caption ? renderTelegramHtmlText(caption) : undefined;

    const sendOptions = buildSendOptions({
      threadId: options?.threadId,
      replyToMessageId: options?.replyToMessageId,
      silent: options?.silent,
      caption: htmlCaption,
    });

    let result: { message_id: number };

    switch (mediaType) {
      case 'photo':
        result = await bot.api.sendPhoto(chatId, file, sendOptions);
        break;
      case 'video':
        result = await bot.api.sendVideo(chatId, file, sendOptions);
        break;
      case 'audio':
        result = await bot.api.sendAudio(chatId, file, sendOptions);
        break;
      default:
        result = await bot.api.sendDocument(chatId, file, sendOptions);
    }

    if (followUpText) {
      const followHtml = renderTelegramHtmlText(followUpText);
      await bot.api.sendMessage(chatId, followHtml, {
        parse_mode: 'HTML',
        reply_to_message_id: result.message_id,
      });
    }

    return result.message_id;
  }

  async function sendTextMessage(
    bot: Bot,
    chatId: string,
    content: string,
    options?: { threadId?: string; replyToMessageId?: string; silent?: boolean }
  ): Promise<number> {
    const chunks = markdownToTelegramChunks(content, MESSAGE_CHUNK_SIZE);

    const retryRunner = createRetryRunner({
      attempts: 3,
      minDelayMs: 300,
      maxDelayMs: 5000,
      shouldRetry: err => err instanceof GrammyError && err.error_code === 429,
      retryAfterMs: err => err instanceof GrammyError ? (err.parameters.retry_after ?? 0) * 1000 : undefined,
    });

    const rich = await retryRunner(() => sendTelegramRichMessage(bot.api, chatId, content, options), 'sendRichMessage');
    if (rich !== undefined) return rich;
    if (!chunks.length) return 0;

    const sendChunk = async (chunk: typeof chunks[number], replyToMessageId?: string): Promise<number> => {
      const sendOptions = buildSendOptions({ ...options, replyToMessageId });
      try {
        const result = await bot.api.sendMessage(chatId, chunk.html, { ...sendOptions, parse_mode: 'HTML' });
        return result.message_id;
      } catch (err) {
        if (!isTelegramHtmlParseError(err)) throw err;
        const result = await bot.api.sendMessage(chatId, chunk.text, sendOptions);
        return result.message_id;
      }
    };

    const firstMessageId = await retryRunner(() => sendChunk(chunks[0], options?.replyToMessageId), 'sendMessage');
    for (const chunk of chunks.slice(1)) {
      await retryRunner(() => sendChunk(chunk, String(firstMessageId)), 'sendMessage');
    }

    return firstMessageId;
  }

  return { send };
}

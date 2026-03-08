/**
 * Telegram Outbound Sender
 *
 * Handles all outbound message sending to Telegram:
 * - Text messages (with chunking)
 * - Data URL media (base64 encoded)
 * - Remote URL media
 * - TTS voice messages
 * - Typing indicators
 */

import type { Bot } from 'grammy';
import { InputFile } from 'grammy';
import type { Config } from '../../config/schema.js';
import type { ChannelSendOptions, ChannelSendResult } from '../types.js';
import type { TelegramAccountManager } from './account-manager.js';
import { buildSendOptions, parseDataUrl, resolveMediaMethod } from './send-options.js';
import { splitTelegramCaption } from './caption.js';
import { renderTelegramHtmlText, markdownToTelegramChunks } from '../format.js';
import { sentMessageCache } from './sent-cache.js';
import { createRetryRunner, isRecoverableNetworkError } from '../../infra/retry.js';
import { createLogger } from '../../utils/logger.js';
import { isTelegramHtmlParseError } from './errors.js';
import { speak, isTTSAvailable } from '../../tts/index.js';
import { compressAudio } from '../../utils/audio.js';

const log = createLogger('TelegramOutboundSender');

/** Maximum message chunk size */
const MESSAGE_CHUNK_SIZE = 3800;

/** Maximum retry attempts for TTS generation */
const TTS_MAX_RETRIES = 3;

/** Delay between TTS retry attempts in milliseconds */
const TTS_RETRY_DELAY_MS = 500;

export interface OutboundSenderDeps {
  accountManager: TelegramAccountManager;
  config: Config;
}

/**
 * Create outbound message sender
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
    } = options;

    log.info({ chatId, accountId, hasContent: !!content, hasMediaUrl: !!mediaUrl }, 'Sending outbound message');

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

      // Handle data URL media
      if (mediaUrl && mediaUrl.startsWith('data:')) {
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
      // Handle TTS voice
      else if (options.tts && deps.config?.tts && isTTSAvailable(deps.config.tts)) {
        sentMessageId = await sendTtsVoice(bot, chatId, content, {
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
      shouldRetry: (err) => isRecoverableNetworkError(err, 'send'),
    });

    // Send first chunk
    const sendFirstChunk = async (): Promise<number> => {
      const sendOptions = buildSendOptions({
        threadId: options?.threadId,
        replyToMessageId: options?.replyToMessageId,
        silent: options?.silent,
      });

      try {
        const result = await bot.api.sendMessage(chatId, chunks[0].html, {
          ...sendOptions,
          parse_mode: 'HTML',
        });
        return result.message_id;
      } catch (err) {
        // Fallback to plain text on HTML parse error
        if (isTelegramHtmlParseError(err)) {
          log.warn({ chatId, err }, 'HTML parse error, retrying with plain text');
          const plainResult = await bot.api.sendMessage(chatId, chunks[0].text, {
            reply_to_message_id: options?.replyToMessageId ? parseInt(options.replyToMessageId, 10) : undefined,
          });
          return plainResult.message_id;
        }
        throw err;
      }
    };

    const firstMessageId = await retryRunner(sendFirstChunk, 'sendMessage');

    // Send remaining chunks as replies
    for (let i = 1; i < chunks.length; i++) {
      await retryRunner(async () => {
        await bot.api.sendMessage(chatId, chunks[i].html, {
          parse_mode: 'HTML',
          reply_to_message_id: firstMessageId,
        });
      }, `sendMessage-reply-${i}`);
    }

    return firstMessageId;
  }

  async function sendTtsVoice(
    bot: Bot,
    chatId: string,
    content: string | undefined,
    options?: { threadId?: string; replyToMessageId?: string; silent?: boolean }
  ): Promise<number> {
    log.info({ chatId, contentLength: content?.length }, 'Generating TTS voice message');

    let sentMessageId: number | undefined;
    let ttsErrorOccurred = false;

    for (let attempt = 1; attempt <= TTS_MAX_RETRIES + 1; attempt++) {
      try {
        const ttsResult = await speak(content || '', deps.config!.tts!);

        // Compress audio if it's wav format
        const { buffer: compressedAudio, format: compressedFormat } = await compressAudio(
          Buffer.from(ttsResult.audio),
          ttsResult.format
        );

        const file = new InputFile(compressedAudio, `voice.${compressedFormat}`);

        const sendOptions = buildSendOptions({
          threadId: options?.threadId,
          replyToMessageId: options?.replyToMessageId,
          silent: options?.silent,
        });

        // Use sendVoice for opus, sendAudio for other formats
        if (compressedFormat === 'opus') {
          const result = await bot.api.sendVoice(chatId, file, sendOptions);
          sentMessageId = result.message_id;
        } else {
          const result = await bot.api.sendAudio(chatId, file, sendOptions);
          sentMessageId = result.message_id;
        }

        log.info({
          chatId,
          messageId: sentMessageId,
          provider: ttsResult.provider,
          format: compressedFormat,
          attempt,
        }, 'TTS voice message sent');
        break; // Success, exit retry loop
      } catch (ttsError) {
        const errorMsg = ttsError instanceof Error ? ttsError.message : String(ttsError);

        if (attempt <= TTS_MAX_RETRIES) {
          log.warn({
            error: errorMsg,
            attempt,
            maxRetries: TTS_MAX_RETRIES,
            textLength: content?.length,
          }, `TTS generation failed (attempt ${attempt}/${TTS_MAX_RETRIES + 1}), retrying...`);
          ttsErrorOccurred = true;
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, attempt * TTS_RETRY_DELAY_MS));
        } else {
          log.error({
            error: errorMsg,
            attempt,
            textLength: content?.length,
            provider: deps.config!.tts!.provider,
          }, 'TTS generation failed after all retries, falling back to text');
          ttsErrorOccurred = true;
        }
      }
    }

    // Fallback to text message if all TTS attempts failed
    if (ttsErrorOccurred && !sentMessageId) {
      log.info({ chatId }, 'Falling back to text message after TTS failure');
      sentMessageId = await sendTextMessage(bot, chatId, content || '', options);
    }

    return sentMessageId;
  }

  return { send };
}

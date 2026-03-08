/**
 * Telegram Inbound Processor
 *
 * Handles inbound message processing from Telegram:
 * - Message queuing (per chat)
 * - Deduplication
 * - Access control
 * - Media download
 * - STT transcription
 * - Event publishing to bus
 */

import type { Bot, Context } from 'grammy';
import type { Message } from '@grammyjs/types';
import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../bus/index.js';
import type { TelegramAccountManager } from './account-manager.js';
import { telegramUpdateDedupe, buildTelegramUpdateKey } from './dedupe.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('TelegramInboundProcessor');

/** Maximum voice message duration for STT in seconds */
const STT_MAX_VOICE_DURATION_SECONDS = 60;

// =============================================================================
// External Service Interfaces (for dependency injection)
// =============================================================================

export interface AccessControlService {
  normalizeAllowFromWithStore(options: { allowFrom?: Array<string | number> }): unknown;
  evaluateGroupBaseAccess(options: {
    isGroup: boolean;
    groupConfig?: unknown;
    topicConfig?: unknown;
    hasGroupAllowOverride: boolean;
    effectiveGroupAllow: unknown;
    senderId?: string;
    senderUsername?: string;
  }): { allowed: boolean; reason?: string };
  resolveRequireMention(options: {
    topicConfig?: unknown;
    groupConfig?: unknown;
    defaultRequireMention?: boolean;
  }): boolean;
  hasBotMention(options: { botUsername: string; text?: string; entities?: unknown }): boolean;
  removeBotMention(text: string, botUsername: string): string;
}

export interface SessionKeyService {
  generateSessionKey(options: {
    source: string;
    chatId: string;
    senderId: string;
    isGroup: boolean;
    threadId?: string;
  }): string;
}

export interface STTService {
  transcribe(buffer: Buffer, config: unknown, options?: { language?: string }): Promise<{ text: string }>;
  isSTTAvailable(config: unknown): boolean;
}

export interface MediaUtils {
  getMimeType(type: string, filePath?: string): string;
}

// =============================================================================
// Dependencies Interface
// =============================================================================

export interface InboundProcessorDeps {
  bus: MessageBus;
  config: Config;
  accountManager: TelegramAccountManager;
  // External services (injected for testability)
  accessControl: AccessControlService;
  sessionKeyService: SessionKeyService;
  sttService: STTService;
  mediaUtils: MediaUtils;
}

interface QueuedMessage {
  ctx: Context;
  accountId: string;
  resolve: () => void;
  reject: (err: Error) => void;
}

// =============================================================================
// Media Processing Types
// =============================================================================

interface MediaItem {
  type: string;
  fileId: string;
}

interface ProcessedAttachment {
  type: string;
  mimeType: string;
  data: string;
  name?: string;
  size?: number;
}

// =============================================================================
// Helper Functions (reduce nesting in main processor)
// =============================================================================

/**
 * Extract media items from message
 */
function extractMediaItems(message: Message): MediaItem[] {
  const media: MediaItem[] = [];
  
  if (message.photo?.length) {
    media.push({ type: 'photo', fileId: message.photo[message.photo.length - 1].file_id });
  }
  if (message.document) {
    media.push({ type: 'document', fileId: message.document.file_id });
  }
  if (message.video) {
    media.push({ type: 'video', fileId: message.video.file_id });
  }
  if (message.audio) {
    media.push({ type: 'audio', fileId: message.audio.file_id });
  }
  if (message.voice) {
    media.push({ type: 'voice', fileId: message.voice.file_id });
  }
  
  return media;
}

/**
 * Process a single media item (download + optional STT)
 */
async function processMediaItem(
  item: MediaItem,
  bot: Bot,
  botToken: string,
  accountApiRoot: string,
  message: Message,
  sttService: STTService,
  mediaUtils: MediaUtils,
  sttConfig: unknown
): Promise<{ attachment: ProcessedAttachment | null; transcribedText: string }> {
  try {
    const file = await bot.api.getFile(item.fileId);
    const downloadUrl = `${accountApiRoot}/file/bot${botToken}/${file.file_path}`;
    const response = await fetch(downloadUrl);

    // Debug log for media download
    log.info({
      type: item.type,
      fileId: item.fileId,
      downloadUrl,
      responseStatus: response.status,
    }, 'Media download response');

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();

    // Debug log for buffer size
    log.info({
      type: item.type,
      fileId: item.fileId,
      bufferSize: buffer.byteLength,
      filePath: file.file_path,
    }, 'Media buffer downloaded');

    if (buffer.byteLength === 0) {
      log.warn({
        type: item.type,
        fileId: item.fileId,
        filePath: file.file_path,
      }, 'Media buffer is empty, may cause issues');
    }
    let transcribedText = '';

    // Handle voice messages with STT
    if (item.type === 'voice' && sttService.isSTTAvailable(sttConfig)) {
      const voiceDuration = message.voice?.duration || 0;
      if (voiceDuration <= STT_MAX_VOICE_DURATION_SECONDS) {
        try {
          const sttResult = await sttService.transcribe(Buffer.from(buffer), sttConfig, {
            language: (sttConfig as { provider?: string })?.provider === 'alibaba' ? 'zh' : undefined,
          });
          transcribedText = sttResult.text;
        } catch (sttError) {
          log.error({ sttError }, 'STT transcription failed');
          transcribedText = '[STT failed]';
        }
      } else {
        transcribedText = `[Voice message too long (>${STT_MAX_VOICE_DURATION_SECONDS}s)]`;
      }
    }

    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = mediaUtils.getMimeType(item.type, file.file_path);

    // Debug log for attachment creation
    log.info({
      type: item.type,
      mimeType,
      base64Length: base64.length,
      size: buffer.byteLength,
      name: file.file_path?.split('/').pop(),
    }, 'Attachment created');

    return {
      attachment: {
        type: item.type,
        mimeType,
        data: base64,
        name: file.file_path?.split('/').pop(),
        size: buffer.byteLength,
      },
      transcribedText,
    };
  } catch (err) {
    log.error({ type: item.type, fileId: item.fileId, err }, 'Failed to download media');
    return { attachment: null, transcribedText: '' };
  }
}

/**
 * Process all media items
 */
async function processAllMedia(
  media: MediaItem[],
  bot: Bot,
  botToken: string,
  accountApiRoot: string,
  message: Message,
  sttService: STTService,
  mediaUtils: MediaUtils,
  sttConfig: unknown
): Promise<{ attachments: ProcessedAttachment[]; transcribedText: string }> {
  const attachments: ProcessedAttachment[] = [];
  let transcribedText = '';

  for (const item of media) {
    const result = await processMediaItem(
      item,
      bot,
      botToken,
      accountApiRoot,
      message,
      sttService,
      mediaUtils,
      sttConfig
    );
    
    if (result.attachment) {
      attachments.push(result.attachment);
    }
    if (result.transcribedText) {
      transcribedText = result.transcribedText;
    }
  }

  return { attachments, transcribedText };
}

// =============================================================================
// Main Processor Factory
// =============================================================================

/**
 * Create inbound message processor
 */
export function createInboundProcessor(deps: InboundProcessorDeps) {
  const { bus, config, accountManager, accessControl, sessionKeyService, sttService, mediaUtils } = deps;

  const messageQueues = new Map<string, QueuedMessage[]>();
  const processingLocks = new Map<string, Promise<void>>();

  const getChatKey = (accountId: string, chatId: string): string => `${accountId}:${chatId}`;

  const processNextMessage = async (chatKey: string): Promise<void> => {
    if (processingLocks.has(chatKey)) return;

    const queue = messageQueues.get(chatKey);
    if (!queue || queue.length === 0) return;

    let lockResolve: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      lockResolve = resolve;
    });
    processingLocks.set(chatKey, lockPromise);

    const { ctx, accountId, resolve, reject } = queue.shift()!;

    try {
      await processMessageInternal(ctx, accountId);
      resolve();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      lockResolve?.();
      processingLocks.delete(chatKey);
      if (queue.length > 0) {
        processNextMessage(chatKey);
      } else {
        messageQueues.delete(chatKey);
      }
    }
  };

  const processMessageInternal = async (ctx: Context, accountId: string) => {
    // Deduplication check
    const updateKey = buildTelegramUpdateKey(ctx);
    if (updateKey && telegramUpdateDedupe.checkAndAdd(updateKey)) {
      log.debug({ updateKey, accountId }, 'Duplicate update detected, skipping');
      return;
    }

    const account = accountManager.getAccount(accountId);
    if (!account) {
      log.warn({ accountId }, 'Account not found for message processing');
      return;
    }

    const botUsername = accountManager.getBotUsername(accountId);
    if (!botUsername) {
      log.warn({ accountId }, 'Bot username not available');
      return;
    }

    const message = ctx.message;
    if (!message) return;

    const chatId = String(ctx.chat?.id);
    const senderId = String(ctx.from?.id);
    const senderUsername = ctx.from?.username;
    const content = message.text ?? message.caption ?? '';
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const threadId = (message as { message_thread_id?: number }).message_thread_id;

    // Access control
    const effectiveAllowFrom = accessControl.normalizeAllowFromWithStore({
      allowFrom: isGroup ? account.groupAllowFrom : account.allowFrom,
    });

    const baseAccess = accessControl.evaluateGroupBaseAccess({
      isGroup,
      groupConfig: account.groups?.[chatId],
      topicConfig: threadId ? account.groups?.[chatId]?.topics?.[String(threadId)] : undefined,
      hasGroupAllowOverride: !!(account.groups?.[chatId]?.allowFrom ||
        (threadId && account.groups?.[chatId]?.topics?.[String(threadId)]?.allowFrom)),
      effectiveGroupAllow: effectiveAllowFrom,
      senderId,
      senderUsername,
    });

    if (!baseAccess.allowed) {
      log.debug({ accountId, chatId, reason: baseAccess.reason }, 'Message blocked by base access');
      return;
    }

    // Check mention in groups
    if (isGroup) {
      const requireMention = accessControl.resolveRequireMention({
        topicConfig: threadId ? account.groups?.[chatId]?.topics?.[String(threadId)] : undefined,
        groupConfig: account.groups?.[chatId],
        defaultRequireMention: true,
      });

      // For media messages (photo, video, etc.) without caption, check caption entities too.
      // A media message with a bot mention in caption_entities should pass the mention check.
      const hasMedia = !!(message.photo || message.document || message.video || message.audio || message.voice);
      const captionEntities = (message as any).caption_entities;
      const hasMention = accessControl.hasBotMention({ botUsername, text: content, entities: message.entities }) ||
        (hasMedia && accessControl.hasBotMention({ botUsername, text: message.caption ?? '', entities: captionEntities }));

      if (requireMention && !hasMention) {
        // Allow media-only messages (no caption) through if the group policy allows it.
        // This prevents silently dropping photos sent without a bot mention when
        // the group is configured to allow media without explicit mention.
        if (!hasMedia || content.trim().length > 0) {
          log.debug({ accountId, chatId }, 'Group message without mention ignored');
          return;
        }
        log.debug({ accountId, chatId }, 'Group media message without mention - processing anyway');
      }
    }

    const cleanContent = isGroup ? accessControl.removeBotMention(content, botUsername) : content;

    // Generate session key
    const sessionKey = sessionKeyService.generateSessionKey({
      source: 'telegram',
      chatId,
      senderId,
      isGroup,
      threadId: threadId ? String(threadId) : undefined,
    });

    // Collect and process media
    const media = extractMediaItems(message);
    const bot = accountManager.getBot(accountId);
    const botToken = account.token;

    let attachments: ProcessedAttachment[] = [];
    let transcribedText = '';

    if (bot && botToken && media.length > 0) {
      const accountApiRoot = account.apiRoot?.replace(/\/$/, '') || 'https://api.telegram.org';
      const mediaResult = await processAllMedia(
        media,
        bot,
        botToken,
        accountApiRoot,
        message,
        sttService,
        mediaUtils,
        config?.stt
      );
      attachments = mediaResult.attachments;
      transcribedText = mediaResult.transcribedText;
    }

    // Combine transcribed text with content
    const finalContent = transcribedText
      ? transcribedText + (cleanContent ? '\n\n' + cleanContent : '')
      : cleanContent;

    const isCommand = cleanContent.startsWith('/');

    log.info({
      accountId,
      chatId,
      senderId,
      isGroup,
      sessionKey,
      contentLength: finalContent.length,
      attachmentCount: attachments.length,
      isCommand,
    }, 'Processing Telegram message');

    await bus.publishInbound({
      channel: 'telegram',
      sender_id: senderId,
      chat_id: chatId,
      content: finalContent,
      metadata: {
        accountId,
        sessionKey,
        messageId: String(message.message_id),
        isGroup,
        isCommand,
        threadId: threadId ? String(threadId) : undefined,
        media: media.length > 0 ? media : undefined,
        transcribedVoice: !!transcribedText || undefined,
      },
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  };

  // Main enqueue function
  return (ctx: Context, accountId: string): Promise<void> => {
    const chatId = String(ctx.chat?.id);
    const chatKey = getChatKey(accountId, chatId);

    return new Promise((resolve, reject) => {
      const queue = messageQueues.get(chatKey) || [];
      queue.push({ ctx, accountId, resolve, reject });
      messageQueues.set(chatKey, queue);
      processNextMessage(chatKey);
    });
  };
}

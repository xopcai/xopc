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
import type { Config } from '@xopcai/xopc/config/schema.js';
import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import type { TelegramAccountManager } from './account-manager.js';
import { telegramUpdateDedupe, buildTelegramUpdateKey } from './dedupe.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import { normalizeTelegramCommandName, parseSlashCommand } from '@xopcai/xopc/chat-commands/command-parse.js';
import { tryConsumeTelegramClarifyFreeText } from '@xopcai/xopc/gateway/clarify-runtime.js';
import { resolveRoute } from '@xopcai/xopc/routing/index.js';
import { resolveTelegramGroupContext } from './group-config-resolver.js';
import { resolveTelegramFocusedSessionKey } from './focus-handler.js';
import { buildTelegramConversationId } from './conversation-id.js';
import { checkMentionInTranscription } from '@xopcai/xopc/voice/stt/mention.js';

const log = createLogger('TelegramInboundProcessor');

/** Must bypass the per-chat queue so /abort can cancel an in-flight turn. */
function isAbortSlashCommand(text: string): boolean {
  const parsed = parseSlashCommand(text);
  if (!parsed) return false;
  const cmd = normalizeTelegramCommandName(parsed.command);
  return cmd === 'abort' || cmd === 'stop' || cmd === 'cancel';
}

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
    accountId?: string;
    agentId?: string;
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
  emoji?: string;
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
  if (message.sticker) {
    media.push({ type: 'sticker', fileId: message.sticker.file_id, emoji: message.sticker.emoji });
  }

  return media;
}

/**
 * Download + STT a Telegram voice message (for mention probe or media pipeline).
 */
async function downloadAndTranscribeTelegramVoice(params: {
  voice: NonNullable<Message['voice']>;
  bot: Bot;
  botToken: string;
  accountApiRoot: string;
  sttService: STTService;
  sttConfig: unknown;
}): Promise<string> {
  const { voice, bot, botToken, accountApiRoot, sttService, sttConfig } = params;
  const voiceDuration = voice.duration || 0;
  if (voiceDuration > STT_MAX_VOICE_DURATION_SECONDS) {
    return '';
  }
  if (!sttService.isSTTAvailable(sttConfig)) {
    return '';
  }
  try {
    const file = await bot.api.getFile(voice.file_id);
    const downloadUrl = `${accountApiRoot}/file/bot${botToken}/${file.file_path}`;
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      return '';
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return '';
    }
    const sttResult = await sttService.transcribe(buffer, sttConfig, {
      language: (sttConfig as { provider?: string })?.provider === 'alibaba' ? 'zh' : undefined,
    });
    return sttResult.text?.trim() ?? '';
  } catch {
    return '';
  }
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
  sttConfig: unknown,
  reuseVoiceTranscript?: string,
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
      if (reuseVoiceTranscript !== undefined && reuseVoiceTranscript !== '') {
        transcribedText = reuseVoiceTranscript;
      } else {
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
  sttConfig: unknown,
  reuseVoiceTranscript?: string,
): Promise<{ attachments: ProcessedAttachment[]; transcribedText: string }> {
  const attachments: ProcessedAttachment[] = [];
  let transcribedText = '';
  let voiceReuseConsumed = false;

  for (const item of media) {
    const reuse =
      item.type === 'voice' && reuseVoiceTranscript && !voiceReuseConsumed
        ? reuseVoiceTranscript
        : undefined;
    if (reuse) {
      voiceReuseConsumed = true;
    }
    const result = await processMediaItem(
      item,
      bot,
      botToken,
      accountApiRoot,
      message,
      sttService,
      mediaUtils,
      sttConfig,
      reuse,
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
  const {
    bus,
    config,
    accountManager,
    accessControl,
    sessionKeyService,
    sttService,
    mediaUtils,
  } = deps;

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

    const message = ctx.message ?? ctx.channelPost;
    if (!message) return;

    const chatId = String(ctx.chat?.id);
    const senderId = String(ctx.from?.id);
    const senderUsername = ctx.from?.username;
    const content = message.text ?? message.caption ?? '';
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const threadId = (message as { message_thread_id?: number }).message_thread_id;

    // Access control (group/topic allowlists, mention gating)
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

    const botEarly = accountManager.getBot(accountId);
    const botTokenEarly = account.botToken;
    const accountApiRootEarly = account.apiRoot?.replace(/\/$/, '') || 'https://api.telegram.org';

    let voiceProbeText = '';
    if (
      isGroup &&
      message.voice &&
      botEarly &&
      botTokenEarly &&
      sttService.isSTTAvailable(config?.tools?.media?.audio)
    ) {
      voiceProbeText = await downloadAndTranscribeTelegramVoice({
        voice: message.voice,
        bot: botEarly,
        botToken: botTokenEarly,
        accountApiRoot: accountApiRootEarly,
        sttService,
        sttConfig: config?.tools?.media?.audio,
      });
    }

    if (isGroup) {
      const requireMention = accessControl.resolveRequireMention({
        topicConfig: threadId ? account.groups?.[chatId]?.topics?.[String(threadId)] : undefined,
        groupConfig: account.groups?.[chatId],
        defaultRequireMention: true,
      });

      const hasMedia = !!(message.photo || message.document || message.video || message.audio || message.voice);
      const captionEntities = (message as any).caption_entities;
      const voiceMention = voiceProbeText.trim();
      const hasMention =
        accessControl.hasBotMention({ botUsername, text: content, entities: message.entities }) ||
        (hasMedia &&
          accessControl.hasBotMention({
            botUsername,
            text: message.caption ?? '',
            entities: captionEntities,
          })) ||
        (voiceMention.length > 0 &&
          (accessControl.hasBotMention({ botUsername, text: voiceMention }) ||
            checkMentionInTranscription(voiceMention, [botUsername])));

      if (requireMention && !hasMention) {
        const isVoiceOnly =
          !!message.voice &&
          !message.photo &&
          !message.document &&
          !message.video &&
          !message.audio &&
          !(message.caption ?? '').trim() &&
          !content.trim();

        if (isVoiceOnly) {
          log.debug({ accountId, chatId }, 'Group voice without mention after STT probe, ignored');
          return;
        }

        if (!hasMedia || content.trim().length > 0) {
          log.debug({ accountId, chatId }, 'Group message without mention ignored');
          return;
        }
        log.debug({ accountId, chatId }, 'Group media message without mention - processing anyway');
      }
    }

    const cleanContent = isGroup ? accessControl.removeBotMention(content, botUsername) : content;

    const groupCtx = resolveTelegramGroupContext({ account, chatId, threadId });
    const route = resolveRoute({
      config,
      channel: 'telegram',
      accountId,
      peerKind: isGroup ? 'group' : 'dm',
      peerId: isGroup ? chatId : senderId,
      threadId: threadId ? String(threadId) : null,
    });
    const routedAgentId = groupCtx.agentId ?? route.agentId;

    const defaultSessionKey = sessionKeyService.generateSessionKey({
      source: 'telegram',
      chatId,
      senderId,
      isGroup,
      threadId: threadId ? String(threadId) : undefined,
      accountId,
      agentId: routedAgentId,
    });

    const sessionKey = resolveTelegramFocusedSessionKey({
      chatId,
      threadId: threadId ? String(threadId) : undefined,
      defaultSessionKey,
    });

    const conversationId = buildTelegramConversationId(chatId, threadId);

    // Collect and process media
    const media = extractMediaItems(message);
    const bot = accountManager.getBot(accountId);
    const botToken = account.botToken;

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
        config?.tools?.media?.audio,
        voiceProbeText || undefined,
      );
      attachments = mediaResult.attachments;
      transcribedText = mediaResult.transcribedText;
    }

    // Combine transcribed text with content. If the user caption is a slash command, put it first
    // so routing and logs match a normal `/cmd` message (STT prefix no longer hides the command).
    const captionIsCommand = cleanContent.trim().startsWith('/');
    let finalContent = transcribedText
      ? captionIsCommand && cleanContent
        ? cleanContent.trim() + (transcribedText ? `\n\n${transcribedText}` : '')
        : transcribedText + (cleanContent ? '\n\n' + cleanContent : '')
      : cleanContent;

    const stickerItem = media.find((m) => m.type === 'sticker');
    if (stickerItem && !finalContent.trim()) {
      finalContent = stickerItem.emoji?.trim()
        ? `[Sticker ${stickerItem.emoji}]`
        : '[Sticker]';
    }

    const isCommand = cleanContent.trim().startsWith('/');

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

    if (
      finalContent.trim().length > 0 &&
      !isCommand &&
      tryConsumeTelegramClarifyFreeText(sessionKey, finalContent.trim())
    ) {
      log.debug({ sessionKey }, 'Telegram: consumed message as clarify reply');
      return;
    }

    await bus.publishInbound({
      channel: 'telegram',
      sender_id: senderId,
      chat_id: chatId,
      content: finalContent,
      metadata: {
        accountId,
        sessionKey,
        senderUsername,
        messageId: String(message.message_id),
        isGroup,
        isCommand,
        threadId: threadId ? String(threadId) : undefined,
        conversationId,
        channelSystemPrompt: groupCtx.systemPrompt,
        channelAgentId: routedAgentId,
        media: media.length > 0 ? media : undefined,
        transcribedVoice: !!transcribedText || undefined,
      },
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  };

  // Main enqueue function
  return (ctx: Context, accountId: string): Promise<void> => {
    const message = ctx.message;
    if (message) {
      const raw = message.text ?? message.caption ?? '';
      if (raw.trim() && isAbortSlashCommand(raw.trim())) {
        return processMessageInternal(ctx, accountId);
      }
    }

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

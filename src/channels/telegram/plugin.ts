/**
 * Telegram Channel Plugin
 * 
 * 插件模式多账户实现，支持:
 * - 多账户
 * - 层级访问控制
 * - Update offset 持久化
 * - Streaming message
 */

import { Bot, type Context, InputFile } from 'grammy';
import { run } from '@grammyjs/runner';
import type {
  ChannelPlugin,
  ChannelInitOptions,
  ChannelStartOptions,
  ChannelSendOptions,
  ChannelSendStreamOptions,
  ChannelSendResult,
  ChannelStatus,
  ChannelMetadata,
  TelegramAccountConfig,
} from '../types.js';
import {
  normalizeAllowFromWithStore,
  evaluateGroupBaseAccess,
  evaluateGroupPolicyAccess,
  resolveGroupPolicy,
  resolveRequireMention,
  hasBotMention,
  removeBotMention,
} from '../access-control.js';
import { readUpdateOffset, writeUpdateOffset } from '../update-offset-store.js';
import { draftStreamManager } from '../draft-stream.js';
import { formatTelegramMessage } from '../format.js';
import { createLogger } from '../../utils/logger.js';
import type { Config } from '../../config/index.js';
import { createTelegramCommandHandler } from './command-handler.js';

const log = createLogger('TelegramPlugin');

// ============================================
// MIME Type Helper
// ============================================

function getMimeType(type: string, filePath?: string): string {
  // Try to get from file extension
  if (filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const extMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain',
      zip: 'application/zip',
    };
    if (ext && extMap[ext]) return extMap[ext];
  }

  // Fallback based on type
  const typeMap: Record<string, string> = {
    photo: 'image/jpeg',
    video: 'video/mp4',
    audio: 'audio/mpeg',
    document: 'application/octet-stream',
    sticker: 'image/webp',
  };
  return typeMap[type] || 'application/octet-stream';
}

// ============================================
// Account Manager
// ============================================

class TelegramAccountManager {
  private accounts = new Map<string, TelegramAccountConfig>();
  private bots = new Map<string, Bot>();
  private runners = new Map<string, ReturnType<typeof run>>();
  private statuses = new Map<string, ChannelStatus>();
  private botUsernames = new Map<string, string>();

  registerAccount(account: TelegramAccountConfig): void {
    this.accounts.set(account.accountId, account);
    this.statuses.set(account.accountId, {
      accountId: account.accountId,
      running: false,
      mode: 'stopped',
    });
  }

  getAccount(accountId: string): TelegramAccountConfig | undefined {
    return this.accounts.get(accountId);
  }

  getAllAccounts(): TelegramAccountConfig[] {
    return Array.from(this.accounts.values());
  }

  registerBot(accountId: string, bot: Bot): void {
    this.bots.set(accountId, bot);
  }

  getBot(accountId: string): Bot | undefined {
    return this.bots.get(accountId);
  }

  registerRunner(accountId: string, runner: ReturnType<typeof run>): void {
    this.runners.set(accountId, runner);
  }

  async stopRunner(accountId: string): Promise<void> {
    const runner = this.runners.get(accountId);
    if (runner) {
      await runner.stop();
      this.runners.delete(accountId);
    }
  }

  updateStatus(status: ChannelStatus): void {
    this.statuses.set(status.accountId, status);
  }

  getStatus(accountId: string): ChannelStatus | undefined {
    return this.statuses.get(accountId);
  }

  setBotUsername(accountId: string, username: string): void {
    this.botUsernames.set(accountId, username);
  }

  getBotUsername(accountId: string): string | undefined {
    return this.botUsernames.get(accountId);
  }
}

// ============================================
// Message Processor
// ============================================

interface MessageProcessorDeps {
  bus: any;
  config: Config;
  accountManager: TelegramAccountManager;
  _commandHandler?: ReturnType<typeof createTelegramCommandHandler>;
}

interface QueuedMessage {
  ctx: Context;
  accountId: string;
  resolve: () => void;
  reject: (err: Error) => void;
}

function createMessageProcessor(deps: MessageProcessorDeps) {
  const { bus, config, accountManager, _commandHandler } = deps;
  
  const messageQueues = new Map<string, QueuedMessage[]>();
  const processingChats = new Set<string>();

  const getChatKey = (accountId: string, chatId: string): string => `${accountId}:${chatId}`;

  const processNextMessage = async (chatKey: string) => {
    if (processingChats.has(chatKey)) return;

    const queue = messageQueues.get(chatKey);
    if (!queue || queue.length === 0) return;

    processingChats.add(chatKey);
    const { ctx, accountId, resolve, reject } = queue.shift()!;

    try {
      await processMessageInternal(ctx, accountId);
      resolve();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      processingChats.delete(chatKey);
      if (queue.length > 0) {
        processNextMessage(chatKey);
      } else {
        messageQueues.delete(chatKey);
      }
    }
  };

  const enqueueMessage = (ctx: Context, accountId: string): Promise<void> => {
    const chatId = String(ctx.chat?.id);
    const chatKey = getChatKey(accountId, chatId);
    
    return new Promise((resolve, reject) => {
      const queue = messageQueues.get(chatKey) || [];
      queue.push({ ctx, accountId, resolve, reject });
      messageQueues.set(chatKey, queue);
      processNextMessage(chatKey);
    });
  };

  const processMessageInternal = async (ctx: Context, accountId: string) => {
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
    const threadId = (message as any)?.message_thread_id;

    const groupConfig = account.groups?.[chatId];
    const topicConfig = threadId ? groupConfig?.topics?.[String(threadId)] : undefined;

    const effectiveAllowFrom = normalizeAllowFromWithStore({
      allowFrom: isGroup ? account.groupAllowFrom : account.allowFrom,
    });

    const baseAccess = evaluateGroupBaseAccess({
      isGroup,
      groupConfig,
      topicConfig,
      hasGroupAllowOverride: !!(groupConfig?.allowFrom || topicConfig?.allowFrom),
      effectiveGroupAllow: effectiveAllowFrom,
      senderId,
      senderUsername,
    });

    if (!baseAccess.allowed) {
      log.debug({ accountId, chatId, senderId, reason: baseAccess.reason }, 'Message blocked by base access');
      return;
    }

    const groupPolicy = resolveGroupPolicy({
      topicConfig,
      groupConfig,
      accountGroupPolicy: account.groupPolicy,
      defaultGroupPolicy: config.channels?.telegram?.groupPolicy,
    });

    const policyAccess = evaluateGroupPolicyAccess({
      isGroup,
      groupPolicy,
      effectiveGroupAllow: effectiveAllowFrom,
      senderId,
      senderUsername,
    });

    if (!policyAccess.allowed) {
      log.debug({ accountId, chatId, senderId, reason: policyAccess.reason }, 'Message blocked by policy');
      return;
    }

    if (isGroup) {
      const requireMention = resolveRequireMention({
        topicConfig,
        groupConfig,
        defaultRequireMention: true,
      });

      if (requireMention && !hasBotMention({ botUsername, text: content, entities: message.entities })) {
        log.debug({ accountId, chatId }, 'Group message without mention ignored');
        return;
      }
    }

    const cleanContent = isGroup ? removeBotMention(content, botUsername) : content;

    const sessionKey = isGroup
      ? `telegram:group:${chatId}${threadId ? `:topic:${threadId}` : ''}`
      : `telegram:dm:${senderId}`;

    const media: Array<{ type: string; fileId: string }> = [];
    if (message.photo?.length) {
      media.push({ type: 'photo', fileId: message.photo[message.photo.length - 1].file_id });
    }
    if (message.document) media.push({ type: 'document', fileId: message.document.file_id });
    if (message.video) media.push({ type: 'video', fileId: message.video.file_id });
    if (message.audio) media.push({ type: 'audio', fileId: message.audio.file_id });

    // Download media files and convert to attachments
    const attachments: Array<{ type: string; mimeType: string; data: string; name?: string; size?: number }> = [];
    const bot = accountManager.getBot(accountId);
    const botToken = account.token;

    if (bot && botToken && media.length > 0) {
      for (const item of media) {
        try {
          const file = await bot.api.getFile(item.fileId);
          // Construct download URL: https://api.telegram.org/file/bot<token>/<file_path>
          const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
          const response = await fetch(downloadUrl);
          if (!response.ok) {
            throw new Error(`Failed to download: ${response.status}`);
          }
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          const mimeType = getMimeType(item.type, file.file_path);
          attachments.push({
            type: item.type,
            mimeType,
            data: base64,
            name: file.file_path.split('/').pop(),
            size: buffer.byteLength,
          });
          log.debug({ type: item.type, size: buffer.byteLength }, 'Media downloaded');
        } catch (err) {
          log.error({ type: item.type, fileId: item.fileId, err }, 'Failed to download media');
        }
      }
    }

    log.info({ accountId, chatId, senderId, isGroup, threadId, sessionKey, contentLength: cleanContent.length, attachmentCount: attachments.length }, 'Processing Telegram message');

    await bus.publishInbound({
      channel: 'telegram',
      sender_id: senderId,
      chat_id: chatId,
      content: cleanContent,
      metadata: {
        sessionKey,
        messageId: String(message.message_id),
        isGroup,
        threadId: threadId ? String(threadId) : undefined,
        media: media.length > 0 ? media : undefined,
      },
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  };

  return enqueueMessage;
}

// ============================================
// Telegram Plugin Implementation
// ============================================

export class TelegramChannelPlugin implements ChannelPlugin {
  id = 'telegram' as const;
  
  meta: ChannelMetadata = {
    id: 'telegram',
    name: 'Telegram',
    description: 'Telegram messaging channel',
    capabilities: {
      chatTypes: ['direct', 'group', 'channel', 'thread'],
      reactions: true,
      threads: true,
      media: true,
      polls: false,
      nativeCommands: true,
      blockStreaming: true,
    },
  };

  private accountManager = new TelegramAccountManager();
  private messageProcessor!: ReturnType<typeof createMessageProcessor>;
  private commandHandlers = new Map<string, ReturnType<typeof createTelegramCommandHandler>>();
  private bus: any = null;
  private config: Config | null = null;

  async init(options: ChannelInitOptions): Promise<void> {
    this.bus = options.bus;
    this.config = options.config;
    
    // Create command handler for shared state
    const commandHandler = createTelegramCommandHandler({
      bus: options.bus,
      config: options.config,
      getSessionModel: (sessionKey) => this.getSessionModel(sessionKey),
      setSessionModel: (sessionKey, modelId) => this.setSessionModel(sessionKey, modelId),
    });
    
    this.messageProcessor = createMessageProcessor({
      bus: options.bus,
      config: options.config,
      accountManager: this.accountManager,
      _commandHandler: commandHandler,
    });

    const telegramConfig = options.config.channels?.telegram;
    if (!telegramConfig?.enabled) {
      log.info('Telegram channel disabled in config');
      return;
    }

    // Register legacy single-account config
    if (telegramConfig.token) {
      const legacyAccount: TelegramAccountConfig = {
        accountId: 'default',
        name: 'Default Account',
        enabled: true,
        token: telegramConfig.token,
        allowFrom: telegramConfig.allowFrom ?? [],
        dmPolicy: telegramConfig.dmPolicy ?? 'pairing',
        groupPolicy: telegramConfig.groupPolicy ?? 'open',
        apiRoot: telegramConfig.apiRoot,
      };
      this.accountManager.registerAccount(legacyAccount);
      log.info('Registered legacy Telegram account (default)');
    }

    // Register multi-account configs
    if (telegramConfig.accounts) {
      for (const [accountId, accountConfig] of Object.entries(telegramConfig.accounts)) {
        const account: TelegramAccountConfig = { ...accountConfig, accountId };
        this.accountManager.registerAccount(account);
        log.info({ accountId }, 'Registered Telegram account');
      }
    }
  }

  async start(options?: ChannelStartOptions): Promise<void> {
    const accounts = options?.accountId
      ? [this.accountManager.getAccount(options.accountId)].filter(Boolean) as TelegramAccountConfig[]
      : this.accountManager.getAllAccounts();

    for (const account of accounts) {
      await this.startAccount(account);
    }
  }

  private async startAccount(account: TelegramAccountConfig): Promise<void> {
    const { accountId, token, apiRoot } = account;

    if (!token) {
      log.warn({ accountId }, 'Skipping account - no token configured');
      return;
    }

    try {
      const botConfig = apiRoot ? { client: { apiRoot } } : undefined;
      const bot = new Bot(token, botConfig);
      this.accountManager.registerBot(accountId, bot);

      const me = await bot.api.getMe();
      this.accountManager.setBotUsername(accountId, me.username);
      log.info({ accountId, username: me.username }, 'Telegram bot initialized');

      // Get or create command handler for this account
      let commandHandler = this.commandHandlers.get(accountId);
      if (!commandHandler) {
        commandHandler = createTelegramCommandHandler({
          bus: this.bus!,
          config: this.config!,
          getSessionModel: (sessionKey) => this.getSessionModel(sessionKey),
          setSessionModel: (sessionKey, modelId) => this.setSessionModel(sessionKey, modelId),
          showProviderModels: async (ctx, providerId) => {
            await commandHandler!.handleProviderSelect(ctx, providerId);
          },
          showProvidersAgain: async (ctx) => {
            await commandHandler!.handleShowProviders(ctx);
          },
          handleCleanupConfirm: async (ctx) => {
            await commandHandler!.handleCleanupConfirm(ctx);
          },
        });
        this.commandHandlers.set(accountId, commandHandler);
      }

      // Register slash commands
      bot.command('models', async (ctx) => {
        await commandHandler!.handleModels(ctx);
      });
      
      bot.command('usage', async (ctx) => {
        await commandHandler!.handleUsage(ctx);
      });
      
      bot.command('cleanup', async (ctx) => {
        await commandHandler!.handleCleanup(ctx);
      });

      // Register message handler
      const enqueueMessage = this.messageProcessor;
      bot.on('message', async (ctx) => {
        try {
          await enqueueMessage(ctx, accountId);
        } catch (err) {
          log.error({ accountId, err }, 'Failed to process message');
        }
      });

      // Register callback query handler for inline keyboards
      bot.on('callback_query:data', async (ctx) => {
        try {
          const data = ctx.callbackQuery.data;
          
          if (data.startsWith('provider:')) {
            const providerId = data.slice('provider:'.length);
            await commandHandler!.handleProviderSelect(ctx, providerId);
          } else if (data.startsWith('model:')) {
            const modelId = data.slice('model:'.length);
            await commandHandler!.handleModelSelect(ctx, modelId);
          } else if (data === 'providers') {
            await commandHandler!.handleShowProviders(ctx);
          } else if (data === 'cleanup:confirm') {
            await commandHandler!.handleCleanupConfirm(ctx);
          } else if (data === 'cancel') {
            await commandHandler!.handleCancel(ctx);
          } else {
            log.warn({ callbackData: data, accountId }, 'Unknown callback query data');
            await ctx.answerCallbackQuery('Unknown action');
          }
        } catch (err) {
          log.error({ accountId, err }, 'Failed to handle callback query');
          await ctx.answerCallbackQuery('Failed to process action');
        }
      });

      // Error handler
      bot.catch((err) => {
        const ctx = err.ctx;
        log.error({ accountId, updateId: ctx.update.update_id, error: err.error }, 'Telegram bot error');
      });

      // Persist update offset
      const lastUpdateId = await readUpdateOffset(accountId);
      log.debug({ accountId, lastUpdateId }, 'Starting Telegram polling');

      bot.use(async (ctx, next) => {
        const updateId = ctx.update.update_id;
        if (lastUpdateId === null || updateId > lastUpdateId) {
          await writeUpdateOffset(accountId, updateId);
        }
        await next();
      });

      // Start polling
      const runner = run(bot, {
        runner: {
          fetch: { timeout: 30, allowed_updates: undefined },
          silent: true,
          maxRetryTime: 5 * 60 * 1000,
          retryInterval: 'exponential',
        },
      });

      this.accountManager.registerRunner(accountId, runner);

      this.accountManager.updateStatus({
        accountId,
        running: true,
        lastStartAt: Date.now(),
        mode: 'polling',
      });

      log.info({ accountId, mode: 'polling' }, 'Telegram account started');
    } catch (err) {
      log.error({ accountId, err }, 'Failed to start Telegram account');
      this.accountManager.updateStatus({
        accountId,
        running: false,
        lastError: err instanceof Error ? err.message : String(err),
        mode: 'stopped',
      });
      throw err;
    }
  }

  async stop(accountId?: string): Promise<void> {
    const accounts = accountId
      ? [this.accountManager.getAccount(accountId)].filter(Boolean) as TelegramAccountConfig[]
      : this.accountManager.getAllAccounts();

    for (const account of accounts) {
      await this.accountManager.stopRunner(account.accountId);
      this.accountManager.updateStatus({
        accountId: account.accountId,
        running: false,
        lastStopAt: Date.now(),
        mode: 'stopped',
      });
      log.info({ accountId: account.accountId }, 'Telegram account stopped');
    }
  }

  async send(options: ChannelSendOptions): Promise<ChannelSendResult> {
    const { chatId, content, type = 'message', accountId = 'default', threadId, replyToMessageId, mediaUrl, mediaType, silent } = options;

    log.info({ chatId, accountId, hasContent: !!content, hasMediaUrl: !!mediaUrl, mediaType, contentLength: content?.length }, 'TelegramPlugin.send called');

    const bot = this.accountManager.getBot(accountId);
    if (!bot) {
      log.error({ accountId }, 'Bot not found for account');
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
      // Telegram handles this automatically
      return { messageId: '', chatId, success: true };
    }

    // Skip empty messages only if there's no media to send
    if ((!content || content.trim() === '') && !mediaUrl) {
      log.debug({ chatId }, 'Skipping empty message (no content and no media)');
      return { messageId: '', chatId, success: true };
    }

    try {
      let sentMessageId: number;

      // Check for data URL first (base64 encoded)
      if (mediaUrl && mediaUrl.startsWith('data:')) {
        log.info({ chatId, mediaType, contentLength: content.length, dataUrlLength: mediaUrl.length }, 'Sending media as data URL');
        // Handle data URL (base64 encoded media)
        const dataUrlMatch = mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!dataUrlMatch) {
          log.error({ chatId }, 'Invalid data URL format');
          return { messageId: '', chatId, success: false, error: 'Invalid data URL format' };
        }
        const mimeType = dataUrlMatch[1];
        const base64Data = dataUrlMatch[2];
        const buffer = Buffer.from(base64Data, 'base64');
        log.debug({ chatId, mimeType, bufferSize: buffer.length }, 'Decoded base64 media');
        const file = new InputFile(buffer);

        const sendOptions: any = {
          parse_mode: 'HTML',
          caption: content ? formatTelegramMessage(content).html : undefined,
        };
        if (threadId) sendOptions.message_thread_id = parseInt(threadId, 10);
        if (replyToMessageId) sendOptions.reply_to_message_id = parseInt(replyToMessageId, 10);
        if (silent) sendOptions.disable_notification = true;

        log.debug({ chatId, mediaType: mimeType, method: 'sendPhoto/sendDocument' }, 'Calling Telegram API');

        // Determine media type from mime type
        const mediaCategory = mimeType.split('/')[0];
        let apiResult;
        switch (mediaCategory) {
          case 'image':
            apiResult = await bot.api.sendPhoto(chatId, file, sendOptions);
            log.info({ chatId, messageId: apiResult?.message_id, ok: apiResult?.ok }, 'Telegram sendPhoto response');
            sentMessageId = apiResult.message_id;
            break;
          case 'video':
            apiResult = await bot.api.sendVideo(chatId, file, sendOptions);
            log.info({ chatId, messageId: apiResult?.message_id, ok: apiResult?.ok }, 'Telegram sendVideo response');
            sentMessageId = apiResult.message_id;
            break;
          case 'audio':
            apiResult = await bot.api.sendAudio(chatId, file, sendOptions);
            log.info({ chatId, messageId: apiResult?.message_id, ok: apiResult?.ok }, 'Telegram sendAudio response');
            sentMessageId = apiResult.message_id;
            break;
          default:
            apiResult = await bot.api.sendDocument(chatId, file, sendOptions);
            log.info({ chatId, messageId: apiResult?.message_id, ok: apiResult?.ok }, 'Telegram sendDocument response');
            sentMessageId = apiResult.message_id;
        }
      } else if (mediaUrl) {
        log.info({ chatId, mediaType, mediaUrl: mediaUrl.substring(0, 100), hasContent: !!content }, 'Sending media from URL');
        // Handle regular URL
        const response = await fetch(mediaUrl);
        if (!response.ok) {
          log.error({ chatId, status: response.status }, 'Failed to fetch media');
          throw new Error(`Failed to fetch media: ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        log.debug({ chatId, bufferSize: buffer.byteLength }, 'Fetched media from URL');
        const file = new InputFile(Buffer.from(buffer));

        const sendOptions: any = {
          parse_mode: 'HTML',
          caption: content ? formatTelegramMessage(content).html : undefined,
        };
        if (threadId) sendOptions.message_thread_id = parseInt(threadId, 10);
        if (replyToMessageId) sendOptions.reply_to_message_id = parseInt(replyToMessageId, 10);
        if (silent) sendOptions.disable_notification = true;

        log.debug({ chatId, mediaType, method: 'sendPhoto/sendVideo/sendDocument' }, 'Calling Telegram API');

        let apiResult;
        switch (mediaType) {
          case 'photo':
            apiResult = await bot.api.sendPhoto(chatId, file, sendOptions);
            log.info({ chatId, messageId: apiResult?.message_id, ok: apiResult?.ok }, 'Telegram sendPhoto response');
            break;
          case 'video':
            apiResult = await bot.api.sendVideo(chatId, file, sendOptions);
            log.info({ chatId, messageId: apiResult?.message_id, ok: apiResult?.ok }, 'Telegram sendVideo response');
            break;
          case 'audio':
            apiResult = await bot.api.sendAudio(chatId, file, sendOptions);
            log.info({ chatId, messageId: apiResult?.message_id, ok: apiResult?.ok }, 'Telegram sendAudio response');
            break;
          default:
            apiResult = await bot.api.sendDocument(chatId, file, sendOptions);
            log.info({ chatId, messageId: apiResult?.message_id, ok: apiResult?.ok }, 'Telegram sendDocument response');
        }

        // Validate API response
        if (!apiResult || !apiResult.ok) {
          log.error({ chatId, apiResult }, 'Telegram API returned error');
          return { messageId: '', chatId, success: false, error: `Telegram API error: ${JSON.stringify(apiResult)}` };
        }
        if (!apiResult.message_id) {
          log.error({ chatId, apiResult }, 'Telegram API response missing message_id');
          return { messageId: '', chatId, success: false, error: 'Telegram API response missing message_id' };
        }
        sentMessageId = apiResult.message_id;
      } else {
        const { html } = formatTelegramMessage(content || '');
        const sendOptions: any = { parse_mode: 'HTML' };
        if (threadId) sendOptions.message_thread_id = parseInt(threadId, 10);
        if (replyToMessageId) sendOptions.reply_to_message_id = parseInt(replyToMessageId, 10);
        if (silent) sendOptions.disable_notification = true;

        sentMessageId = (await bot.api.sendMessage(chatId, html, sendOptions)).message_id;
      }

      return { messageId: String(sentMessageId), chatId, success: true };
    } catch (err) {
      log.error({ accountId, chatId, err, mediaUrl: !!mediaUrl, mediaType }, 'Failed to send message - caught error');
      return { messageId: '', chatId, success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  startStream(options: ChannelSendStreamOptions): ReturnType<ChannelPlugin['startStream']> {
    const { chatId, accountId = 'default', threadId, replyToMessageId, parseMode = 'HTML' } = options;

    const bot = this.accountManager.getBot(accountId);
    if (!bot) throw new Error('Bot not initialized');

    const streamKey = `${accountId}:${chatId}:${threadId || 'dm'}`;
    const draftStream = draftStreamManager.getOrCreate(streamKey, {
      api: bot.api,
      chatId,
      threadId: threadId ? parseInt(threadId, 10) : undefined,
      replyToMessageId: replyToMessageId ? parseInt(replyToMessageId, 10) : undefined,
      parseMode: parseMode === 'HTML' ? 'HTML' : 'Markdown',
    });

    return {
      update: (text: string) => {
        const { html } = formatTelegramMessage(text);
        draftStream.update(html);
      },
      end: async () => {
        await draftStream.flush();
        await draftStreamManager.stop(streamKey);
      },
      abort: async () => {
        await draftStream.clear();
        await draftStreamManager.stop(streamKey);
      },
      messageId: () => draftStream.messageId(),
    };
  }

  getStatus(accountId?: string): ChannelStatus {
    if (accountId) {
      return this.accountManager.getStatus(accountId) ?? { accountId, running: false, mode: 'stopped' };
    }

    const allStatuses = this.accountManager.getAllAccounts().map((acc) => this.accountManager.getStatus(acc.accountId));
    const anyRunning = allStatuses.some((s) => s?.running);
    return { accountId: 'all', running: anyRunning, mode: anyRunning ? 'polling' : 'stopped' };
  }

  // ========== Session Model Management ==========

  private sessionModels = new Map<string, string>();

  getSessionModel(sessionKey: string): string | undefined {
    return this.sessionModels.get(sessionKey);
  }

  setSessionModel(sessionKey: string, modelId: string): void {
    this.sessionModels.set(sessionKey, modelId);
    log.info({ sessionKey, modelId }, 'Session model set');
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    for (const account of this.accountManager.getAllAccounts()) {
      const bot = this.accountManager.getBot(account.accountId);
      if (!bot) continue;

      try {
        await bot.api.getMe();
      } catch (err) {
        return { success: false, error: `Account ${account.accountId}: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    return { success: true };
  }
}

export const telegramPlugin = new TelegramChannelPlugin();

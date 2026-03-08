/**
 * Telegram Channel Extension
 * 
 * Multi-account implementation with plugin architecture, supporting:
 * - Multiple accounts
 * - Hierarchical access control
 * - Update offset persistence
 * - Streaming messages
 */

import { Bot, type Context } from 'grammy';
import { run } from '@grammyjs/runner';
import type {
  ChannelExtension,
  ChannelInitOptions,
  ChannelStartOptions,
  ChannelSendOptions,
  ChannelSendStreamOptions,
  ChannelSendResult,
  ChannelStatus,
  ChannelMetadata,
  TelegramAccountConfig,
} from '../types.js';
import { readUpdateOffset, writeUpdateOffset } from './update-offset-store.js';
import { draftStreamManager } from './draft-stream.js';
import { MediaGroupBuffer } from './media-group.js';
import { InboundDebounce, buildTelegramDebounceKey } from './debounce.js';
import type { Message } from '@grammyjs/types';
import type { Config } from '../../config/index.js';
import { createTelegramCommandHandler } from './command-handler.js';
import { TelegramAccountManager } from './account-manager.js';
import { createInboundProcessor } from './inbound-processor.js';
import { createOutboundSender } from './outbound-sender.js';
import { renderTelegramHtmlText } from './format.js';
import type { ProgressStage } from '../types.js';
import { createLogger } from '../../utils/logger.js';
// Import services for dependency injection into inbound-processor
import {
  normalizeAllowFromWithStore,
  evaluateGroupBaseAccess,
  resolveRequireMention,
  hasBotMention,
  removeBotMention,
} from './access-control.js';
import { generateSessionKey } from '../../commands/session-key.js';
import { transcribe, isSTTAvailable } from '../../stt/index.js';
import { getMimeType } from '../../utils/media.js';

const log = createLogger('TelegramExtension');

// ============================================
// Telegram Extension Implementation
// ============================================

export class TelegramChannelExtension implements ChannelExtension {
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
  private inboundProcessor!: ReturnType<typeof createInboundProcessor>;
  private outboundSender!: ReturnType<typeof createOutboundSender>;
  private commandHandlers = new Map<string, ReturnType<typeof createTelegramCommandHandler>>();
  private bus: any = null;
  private config: Config | null = null;

  // New: Media group buffer for combining album photos
  private mediaGroupBuffer: MediaGroupBuffer;

  // New: Inbound debounce for combining rapid messages
  private inboundDebounce: InboundDebounce<{
    ctx: Context;
    accountId: string;
    message: Message;
  }>;

  constructor() {
    // Initialize media group buffer
    this.mediaGroupBuffer = new MediaGroupBuffer({
      timeoutMs: 500,
      onFlush: async (messages, ctx, accountId) => {
        await this.processMediaGroup(messages, ctx, accountId);
      },
    });

    // Initialize inbound debounce
    this.inboundDebounce = new InboundDebounce({
      debounceMs: 300,
      buildKey: (item) => buildTelegramDebounceKey(item.ctx),
      shouldDebounce: (item) => {
        // Don't debounce commands or media
        const text = item.message.text ?? item.message.caption ?? '';
        if (text.startsWith('/')) return false;
        if (item.message.photo || item.message.document || item.message.video) return false;
        return text.length < 100; // Only debounce short messages
      },
      onFlush: async (items) => {
        await this.processDebouncedMessages(items);
      },
      onError: (err, items) => {
        log.error({ err, itemCount: items.length }, 'Debounced message processing failed');
      },
    });
  }

  async init(options: ChannelInitOptions): Promise<void> {
    this.bus = options.bus;
    this.config = options.config;
    
    this.inboundProcessor = createInboundProcessor({
      bus: options.bus,
      config: options.config,
      accountManager: this.accountManager,
      // Inject external services for testability
      accessControl: {
        normalizeAllowFromWithStore,
        evaluateGroupBaseAccess,
        resolveRequireMention,
        hasBotMention,
        removeBotMention,
      },
      sessionKeyService: {
        generateSessionKey,
      },
      sttService: {
        transcribe,
        isSTTAvailable,
      },
      mediaUtils: {
        getMimeType,
      },
    });

    this.outboundSender = createOutboundSender({
      accountManager: this.accountManager,
      config: options.config,
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
        streamMode: telegramConfig.streamMode,
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

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      
      // Add delay between starting multiple accounts to avoid rate limits
      if (i > 0) {
        const delay = 2000; // 2 seconds between accounts
        log.debug({ accountId: account.accountId, delayMs: delay }, 'Waiting before starting next account');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      await this.startAccount(account);
    }
  }

  private async startAccount(account: TelegramAccountConfig): Promise<void> {
    const { accountId, token, apiRoot } = account;

    if (!token) {
      log.warn({ accountId }, 'Skipping account - no token configured');
      return;
    }

    // Check if already running
    if (this.accountManager.isRunning(accountId)) {
      log.warn({ accountId }, 'Account is already running, skipping start');
      return;
    }

    // Check if currently starting (prevent concurrent starts)
    if (this.accountManager.isStarting(accountId)) {
      log.warn({ accountId }, 'Account is already starting, skipping duplicate start');
      return;
    }

    this.accountManager.markStarting(accountId);

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

      // Register slash commands with Telegram Bot API
      try {
        await bot.api.setMyCommands([
          { command: 'start', description: 'Show welcome message and help' },
          { command: 'models', description: 'Show available models' },
          { command: 'usage', description: 'Show token usage stats' },
          { command: 'cleanup', description: 'Clean up old sessions' },
          { command: 'new', description: 'Start a new session (archive current)' },
          { command: 'skills', description: 'Manage skills (e.g., /skills reload)' },
          { command: 'tts', description: 'Manage TTS settings (e.g., /tts always)' },
        ]);
        log.info({ accountId }, 'Registered Telegram bot commands');
      } catch (err) {
        log.error({ accountId, err }, 'Failed to register Telegram bot commands');
      }

      // Register command handlers
      bot.command('models', async (ctx) => {
        await commandHandler!.handleModels(ctx);
      });
      
      bot.command('cleanup', async (ctx) => {
        await commandHandler!.handleCleanup(ctx);
      });

      bot.command('start', async (ctx) => {
        await commandHandler!.handleStart(ctx);
      });

      // Register message handler with media group and debounce support
      bot.on('message', async (ctx) => {
        try {
          // Check for media group (photo album)
          const mediaGroupId = (ctx.message as { media_group_id?: string }).media_group_id;
          if (mediaGroupId) {
            const buffered = await this.mediaGroupBuffer.process(ctx, accountId);
            if (buffered) return; // Message was buffered, will be processed as group
          }

          // Process through inbound debounce for text messages
          const debounceKey = buildTelegramDebounceKey(ctx);
          if (debounceKey) {
            await this.inboundDebounce.process({
              ctx,
              accountId,
              message: ctx.message,
            });
            return;
          }

          // Process immediately (no debounce key)
          await this.inboundProcessor(ctx, accountId);
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
        const error = err.error;
        
        // Handle 409 Conflict error (multiple instances)
        if (error && typeof error === 'object' && 'error_code' in error && error.error_code === 409) {
          log.error({ accountId }, 'Telegram bot conflict detected - another instance is running with the same token');
          // Stop this instance to avoid further conflicts
          this.accountManager.stopRunner(accountId).catch((stopErr) => {
            log.error({ accountId, err: stopErr }, 'Failed to stop runner after conflict');
          });
          return;
        }
        
        log.error({ accountId, updateId: ctx.update.update_id, error }, 'Telegram bot error');
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

      // Start polling with enhanced error handling
      const runner = run(bot, {
        runner: {
          fetch: { 
            timeout: 30, 
            allowed_updates: undefined,
          },
          silent: true,
          maxRetryTime: 5 * 60 * 1000,
          retryInterval: 'exponential',
        },
      });

      // Handle runner errors to catch 409 conflicts early
      const task = runner.task();
      if (task) {
        task.then(() => {
          log.info({ accountId }, 'Telegram runner task completed');
        }).catch((err) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes('409') || errorMessage.includes('Conflict')) {
            log.error({ accountId }, 'Telegram runner stopped due to conflict (409)');
            this.accountManager.updateStatus({
              accountId,
              running: false,
              lastError: 'Conflict: another instance is running',
              mode: 'stopped',
            });
          }
        });
      }

      this.accountManager.registerRunner(accountId, runner);

      this.accountManager.updateStatus({
        accountId,
        running: true,
        lastStartAt: Date.now(),
        mode: 'polling',
      });

      this.accountManager.markStartComplete(accountId);

      log.info({ accountId, mode: 'polling' }, 'Telegram account started');
    } catch (err) {
      this.accountManager.markStartComplete(accountId);
      
      // Handle specific error codes
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      if (errorMessage.includes('409') || errorMessage.includes('Conflict')) {
        log.error({ accountId }, 'Telegram bot conflict (409) - another instance is already running with this token');
        log.info({ accountId }, 'Try stopping other instances or wait a few seconds before restarting');
      } else {
        log.error({ accountId, err }, 'Failed to start Telegram account');
      }
      
      this.accountManager.updateStatus({
        accountId,
        running: false,
        lastError: errorMessage,
        mode: 'stopped',
      });
      throw err;
    }
  }

  async stop(accountId?: string): Promise<void> {
    // Flush all pending buffers before stopping
    await this.mediaGroupBuffer.flushAll();
    await this.inboundDebounce.flushAll();

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

  /**
   * Process a media group (album) as a single message
   */
  private async processMediaGroup(messages: Message[], firstCtx: Context, accountId: string): Promise<void> {

    // Get combined caption from last message with caption
    const lastMessageWithCaption = [...messages].reverse().find(m => m.caption || m.text);
    const combinedCaption = lastMessageWithCaption?.caption || lastMessageWithCaption?.text || '';

    // Collect the highest-resolution photo from each message in the album
    const allPhotos = messages
      .filter(m => m.photo?.length)
      .map(m => m.photo![m.photo!.length - 1]);

    // Also collect other media types
    const allMedia: Array<{ type: string; fileId: string }> = [];
    for (const msg of messages) {
      if (msg.document) allMedia.push({ type: 'document', fileId: msg.document.file_id });
      if (msg.video) allMedia.push({ type: 'video', fileId: msg.video.file_id });
    }

    log.info({
      accountId,
      chatId: firstCtx.chat?.id,
      messageCount: messages.length,
      photoCount: allPhotos.length,
      mediaCount: allMedia.length,
    }, 'Processing media group');

    // Preserve photo field so extractMediaItems can find it
    const syntheticCtx = {
      ...firstCtx,
      message: {
        ...firstCtx.message,
        caption: combinedCaption,
        photo: allPhotos.length > 0 ? allPhotos : firstCtx.message?.photo,
      },
    };

    await this.inboundProcessor(syntheticCtx as Context, accountId);
  }

  /**
   * Process debounced (combined) messages
   */
  private async processDebouncedMessages(items: Array<{ ctx: Context; accountId: string; message: Message }>): Promise<void> {
    if (items.length === 0) return;

    const first = items[0];
    const accountId = first.accountId;

    if (items.length === 1) {
      // Single message - process normally
      await this.inboundProcessor(first.ctx, accountId);
      return;
    }

    // Combine messages
    const combinedText = items
      .map(item => item.message.text ?? item.message.caption ?? '')
      .filter(Boolean)
      .join('\n');

    // Collect photos from all merged messages
    const allPhotos = items
      .filter(item => item.message.photo?.length)
      .map(item => item.message.photo![item.message.photo!.length - 1]);

    log.info({
      accountId,
      chatId: first.ctx.chat?.id,
      messageCount: items.length,
      combinedLength: combinedText.length,
      photoCount: allPhotos.length,
    }, 'Processing debounced messages');

    // Preserve photo field in the merged synthetic context
    const syntheticCtx = {
      ...first.ctx,
      message: {
        ...first.message,
        text: combinedText || undefined,
        caption: undefined,
        photo: allPhotos.length > 0 ? allPhotos : first.message.photo,
      },
    };

    await this.inboundProcessor(syntheticCtx as Context, accountId);
  }

  async send(options: ChannelSendOptions): Promise<ChannelSendResult> {
    return this.outboundSender.send(options);
  }

  startStream(options: ChannelSendStreamOptions): ReturnType<ChannelExtension['startStream']> {
    const { chatId, accountId = 'default', threadId, replyToMessageId, parseMode = 'HTML' } = options;

    const bot = this.accountManager.getBot(accountId);
    if (!bot) throw new Error('Bot not initialized');

    // Get account config to check streamMode
    const account = this.accountManager.getAccount(accountId);
    const streamMode = account?.streamMode ?? 'partial';

    // If streamMode is 'off', return a no-op stream handle
    if (streamMode === 'off') {
      return {
        update: () => { /* no-op */ },
        updateProgress: () => { /* no-op */ },
        setProgress: () => { /* no-op */ },
        end: async () => { /* no-op */ },
        abort: async () => { /* no-op */ },
        messageId: () => undefined,
      };
    }

    const streamKey = `${accountId}:${chatId}:${threadId || 'dm'}`;
    const draftStream = draftStreamManager.getOrCreate(streamKey, {
      api: bot.api,
      chatId,
      threadId: threadId ? parseInt(threadId, 10) : undefined,
      replyToMessageId: replyToMessageId ? parseInt(replyToMessageId, 10) : undefined,
      parseMode: parseMode === 'HTML' ? 'HTML' : 'Markdown',
      enableProgress: true, // Enable progress indicator
    });

    return {
      update: (text: string) => {
        // Convert Markdown to Telegram HTML before passing to draft stream.
        // The draft stream is configured with parseMode='HTML', so it expects
        // pre-converted HTML, not raw Markdown.
        const html = renderTelegramHtmlText(text);
        draftStream.update(html);
      },
      /** Update stream with progress stage indicator */
      updateProgress: (text: string, stage: ProgressStage, detail?: string) => {
        const html = renderTelegramHtmlText(text);
        draftStream.updateWithProgress(html, stage, detail);
      },
      /** Set progress stage without updating text */
      setProgress: (stage: ProgressStage, detail?: string) => {
        draftStream.setProgress(stage, detail);
      },
      end: async () => {
        // Clear progress indicator before ending
        draftStream.setProgress('idle');
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

export const telegramExtension = new TelegramChannelExtension();

/**
 * Telegram Channel Plugin - Implementation based on ChannelPlugin interface
 * 
 * This plugin integrates Telegram with the ChannelPlugin architecture.
 * It reuses components from the telegram/ directory where possible.
 */

import { Bot, type Context } from 'grammy';
import { run } from '@grammyjs/runner';
import type { Message } from '@grammyjs/types';

import type { Config } from '../config/index.js';
import type {
  ChannelPlugin,
  ChannelPluginDefaults,
  ChannelPluginInitOptions,
  ChannelPluginReloadMeta,
  ChannelPluginStartOptions,
  ChannelOutboundContext,
  OutboundDeliveryResult,
  ChannelStreamHandle,
  ChannelStatusAdapter,
  ChannelSecurityAdapter,
  ChannelConfigAdapter,
  ChannelMetadata,
  ChannelSecurityContext,
} from './plugin-types.js';
import type { OutboundMessage } from '../types/index.js';
import { generateSessionKey } from '../commands/session-key.js';

import { createLogger } from '../utils/logger.js';
import { createInboundDebouncer } from '../infra/debounce.js';
import { getChatChannelMeta } from './registry.js';
import { getMimeType } from '../utils/media.js';
import { transcribe as sttTranscribe, isSTTAvailable } from '../stt/index.js';
import type { STTConfig } from '../stt/types.js';

// Reuse telegram/ modules
import { TelegramAccountManager } from './telegram/account-manager.js';
import { createOutboundSender } from './telegram/outbound-sender.js';
import { createTelegramCommandHandler } from './telegram/command-handler.js';
import { createInboundProcessor } from './telegram/inbound-processor.js';
import {
  normalizeAllowFromWithStore,
  evaluateGroupBaseAccess,
  resolveRequireMention,
  hasBotMention,
  removeBotMention as removeBotMentionAccess,
} from './telegram/access-control.js';
import { TELEGRAM_CHANNEL_DEFAULTS } from './telegram/plugin-defaults.js';
import {
  createTelegramPluginAdapters,
  type TelegramResolvedAccount,
} from './telegram/telegram-plugin-adapters.js';

const log = createLogger('TelegramPlugin');

const TELEGRAM_REGISTRY_META = getChatChannelMeta('telegram');

const telegramInboundAccessControl = {
  normalizeAllowFromWithStore: (opts: { allowFrom?: Array<string | number>; storeAllowFrom?: string[] }) =>
    normalizeAllowFromWithStore(opts),
  evaluateGroupBaseAccess: (opts: Parameters<typeof evaluateGroupBaseAccess>[0]) => evaluateGroupBaseAccess(opts),
  resolveRequireMention: (opts: Parameters<typeof resolveRequireMention>[0]) => resolveRequireMention(opts),
  hasBotMention: (opts: Parameters<typeof hasBotMention>[0]) => hasBotMention(opts),
  removeBotMention: (text: string, botUsername: string) => removeBotMentionAccess(text, botUsername),
};

export type { TelegramResolvedAccount as TelegramAccount } from './telegram/telegram-plugin-adapters.js';

interface TelegramMessageEvent {
  ctx: Context;
  accountId: string;
  message: Message;
}

// ============================================
// Plugin Implementation
// ============================================

export class TelegramChannelPlugin implements ChannelPlugin<TelegramResolvedAccount> {
  readonly id = 'telegram' as const;

  readonly reload: ChannelPluginReloadMeta = {
    configPrefixes: ['channels.telegram'],
  };

  readonly meta: ChannelMetadata = {
    id: TELEGRAM_REGISTRY_META.id,
    name: TELEGRAM_REGISTRY_META.label,
    description: TELEGRAM_REGISTRY_META.description,
    capabilities: TELEGRAM_REGISTRY_META.capabilities,
  };

  readonly defaults: ChannelPluginDefaults = {
    queue: { debounceMs: TELEGRAM_CHANNEL_DEFAULTS.queue.debounceMs },
    outbound: { textChunkLimit: TELEGRAM_CHANNEL_DEFAULTS.outbound.textChunkLimit },
  };
  
  // Internal state
  private bus!: NonNullable<ChannelPluginInitOptions['bus']>;
  private cfg!: NonNullable<ChannelPluginInitOptions['config']>;
  private debouncer!: ReturnType<typeof createInboundDebouncer<TelegramMessageEvent>>;
  
  // Reused components
  private accountManager!: TelegramAccountManager;
  private outboundSender!: ReturnType<typeof createOutboundSender>;
  private commandHandler!: ReturnType<typeof createTelegramCommandHandler>;
  private inboundProcessor!: ReturnType<typeof createInboundProcessor>;

  // Interface implementations
  configAdapter!: ChannelConfigAdapter<TelegramResolvedAccount>;
  securityAdapter!: ChannelSecurityAdapter<TelegramResolvedAccount>;
  statusAdapter!: ChannelStatusAdapter<TelegramResolvedAccount>;
  
  // Outbound adapter
  outbound = {
    deliveryMode: 'direct' as const,
    chunker: (text: string, limit: number) => {
      const chunks: string[] = [];
      const lines = text.split('\n');
      let current = '';
      for (const line of lines) {
        if ((current + '\n' + line).length > limit) {
          if (current) chunks.push(current);
          current = line;
        } else {
          current = current ? current + '\n' + line : line;
        }
      }
      if (current) chunks.push(current);
      return chunks;
    },
    chunkerMode: 'text' as const,
    textChunkLimit: TELEGRAM_CHANNEL_DEFAULTS.outbound.textChunkLimit,
    sendText: async (ctx) => this.doSendText(ctx),
    sendMedia: async (ctx) => this.doSendMedia(ctx),
    sendPayload: async (ctx) => this.doSendPayload(ctx),
  };
  
  // ========================================
  // Lifecycle Methods
  // ========================================
  
  async init(options: ChannelPluginInitOptions): Promise<void> {
    this.bus = options.bus;
    this.cfg = options.config;
    
    // Initialize reused components
    this.accountManager = new TelegramAccountManager();
    this.loadAccounts();
    this.bindOutboundComponents();

    const debounceMs =
      this.defaults.queue?.debounceMs ?? TELEGRAM_CHANNEL_DEFAULTS.queue.debounceMs;
    this.debouncer = createInboundDebouncer<TelegramMessageEvent>({
      debounceMs,
      buildKey: (item) => {
        const chatId = item.ctx.chat?.id?.toString();
        const userId = item.ctx.from?.id?.toString();
        if (!chatId || !userId) return undefined;
        return `telegram:${item.accountId}:${chatId}:${userId}`;
      },
      shouldDebounce: (item) => {
        const text = item.message.text ?? item.message.caption ?? '';
        if (text.startsWith('/')) return false;
        if (item.message.photo || item.message.document || item.message.video) return false;
        return text.length < 100;
      },
      onFlush: async (items) => {
        await this.processMessages(items);
      },
      onError: (err, items) => {
        log.error({ err, count: items.length }, 'Debounced message processing failed');
      },
    });
    
    log.info('Telegram plugin initialized');
  }

  private bindOutboundComponents(): void {
    this.outboundSender = createOutboundSender({
      accountManager: this.accountManager,
      config: this.cfg,
    });
    this.commandHandler = createTelegramCommandHandler({
      bus: this.bus,
      config: this.cfg,
      getSessionModel: () => undefined,
      setSessionModel: () => {},
    });
    const adapters = createTelegramPluginAdapters({
      accountManager: this.accountManager,
    });
    this.configAdapter = adapters.configAdapter;
    this.securityAdapter = adapters.securityAdapter;
    this.statusAdapter = adapters.statusAdapter;

    this.inboundProcessor = createInboundProcessor({
      bus: this.bus,
      config: this.cfg,
      accountManager: this.accountManager,
      accessControl: telegramInboundAccessControl,
      sessionKeyService: {
        generateSessionKey: (opts) =>
          generateSessionKey({
            source: 'telegram',
            chatId: opts.chatId,
            senderId: opts.senderId,
            isGroup: opts.isGroup,
            threadId: opts.threadId,
            accountId: opts.accountId,
          }),
      },
      sttService: {
        transcribe: async (buffer, config, options) => {
          const result = await sttTranscribe(buffer, config as STTConfig, options);
          return { text: result.text };
        },
        isSTTAvailable: (config) => isSTTAvailable(config as STTConfig | undefined),
      },
      mediaUtils: { getMimeType },
      externalAccessGate: true,
    });
  }

  async onConfigUpdated(cfg: Config): Promise<void> {
    await this.reapplyFromConfig(cfg);
  }

  private async reapplyFromConfig(cfg: Config): Promise<void> {
    this.cfg = cfg;
    await this.stop();
    this.accountManager.reset();
    const telegramCfg = cfg.channels?.telegram as Record<string, unknown> | undefined;
    const enabled = Boolean(telegramCfg && telegramCfg.enabled !== false);
    if (!enabled) {
      this.bindOutboundComponents();
      return;
    }
    this.loadAccounts();
    this.bindOutboundComponents();
    await this.start();
  }
  
  private loadAccounts(): void {
    const telegramCfg = this.cfg.channels?.telegram as Record<string, unknown> | undefined;
    if (!telegramCfg) return;
    
    if (telegramCfg.botToken && !telegramCfg.accounts) {
      this.accountManager.registerAccount({
        accountId: 'default',
        name: 'Default Account',
        enabled: true,
        botToken: telegramCfg.botToken as string,
        apiRoot: telegramCfg.apiRoot as string | undefined,
        dmPolicy: telegramCfg.dmPolicy as any,
        groupPolicy: telegramCfg.groupPolicy as any,
        allowFrom: telegramCfg.allowFrom as Array<string | number> | undefined,
        groupAllowFrom: telegramCfg.groupAllowFrom as Array<string | number> | undefined,
      });
      return;
    }
    
    const accounts = telegramCfg.accounts as Record<string, any> | undefined;
    if (accounts) {
      for (const [id, account] of Object.entries(accounts)) {
        this.accountManager.registerAccount({ ...account, accountId: id });
      }
    }
  }
  
  channelIsRunning(cfg: Config): boolean {
    return this.accountManager.getAllAccounts().some(
      (a) => a.enabled !== false && !!a.botToken && this.accountManager.isRunning(a.accountId),
    );
  }

  async start(options?: ChannelPluginStartOptions): Promise<void> {
    const accountIds = options?.accountId 
      ? [options.accountId] 
      : this.configAdapter.listAccountIds(this.cfg);
    
    for (const accountId of accountIds) {
      const account = this.configAdapter.resolveAccount(this.cfg, accountId);
      if (!account.enabled || !account.botToken) continue;
      await this.startAccount(account);
    }
  }
  
  async stop(accountId?: string): Promise<void> {
    if (!this.configAdapter) return;
    const ids = accountId ? [accountId] : this.configAdapter.listAccountIds(this.cfg);
    for (const id of ids) {
      await this.accountManager.stopRunner(id);
      log.info({ accountId: id }, 'Telegram account stopped');
    }
  }
  
  // ========================================
  // Private Methods
  // ========================================
  
  private async startAccount(account: TelegramResolvedAccount): Promise<void> {
    if (this.accountManager.isRunning(account.accountId)) return;
    if (!account.botToken) return;
    
    this.accountManager.markStarting(account.accountId);
    
    try {
      const botConfig = account.apiRoot ? { client: { apiRoot: account.apiRoot } } : undefined;
      const bot = new Bot(account.botToken, botConfig);
      const me = await bot.api.getMe();
      
      // No cap on getUpdates retry window: transient outages must not crash the process
      // (the previous 5m limit caused unhandled rejections after short offline periods).
      const runner = run(bot, {
        runner: {
          fetch: { timeout: 30 },
          silent: true,
          maxRetryTime: Number.POSITIVE_INFINITY,
          retryInterval: 'exponential',
        },
      });

      this.accountManager.registerBot(account.accountId, bot);
      this.accountManager.registerRunner(account.accountId, runner);
      this.attachRunnerExitHandler(account.accountId, runner);
      this.accountManager.setBotUsername(account.accountId, me.username);
      this.accountManager.updateStatus({
        accountId: account.accountId,
        running: true,
        mode: 'polling',
      });
      
      this.setupMessageHandler(account.accountId, bot);
      
      log.info({ accountId: account.accountId, username: me.username }, 'Telegram account started');
    } finally {
      this.accountManager.markStartComplete(account.accountId);
    }
  }
  
  private attachRunnerExitHandler(accountId: string, runner: ReturnType<typeof run>): void {
    const task = runner.task();
    if (!task) return;
    void task.catch((err) => {
      log.error({ err, accountId }, 'Telegram polling runner exited');
      void this.accountManager.stopRunner(accountId).catch((e) => {
        log.error({ err: e, accountId }, 'Telegram runner cleanup failed');
      });
    });
  }

  private setupMessageHandler(accountId: string, bot: Bot): void {
    // Use command handler for Telegram-specific commands
    bot.on('message', async (ctx) => {
      try {
        const text = ctx.message.text ?? ctx.message.caption ?? '';
        const command = text.trim().split(' ')[0].split('@')[0].toLowerCase();
        
        // Intercept /models command to show inline keyboard
        if (command === '/models') {
          await this.commandHandler.handleModels(ctx);
          return;
        }
        
        // Intercept /start command
        if (command === '/start') {
          await this.commandHandler.handleStart(ctx);
          return;
        }
        
        // Intercept /cleanup command
        if (command === '/cleanup') {
          await this.commandHandler.handleCleanup(ctx);
          return;
        }
        
        await this.debouncer.enqueue({ ctx, accountId, message: ctx.message });
      } catch (err) {
        log.error({ accountId, err }, 'Message handler error');
      }
    });
    
    // Handle callback queries from inline keyboards
    bot.on('callback_query:data', async (ctx) => {
      try {
        await this.handleCallbackQuery(ctx, accountId);
      } catch (err) {
        log.error({ accountId, err }, 'Callback query handler error');
        await ctx.answerCallbackQuery('An error occurred').catch(() => {});
      }
    });
  }
  
  private async handleCallbackQuery(ctx: Context, _accountId: string): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data) return;
    
    // Delegate to command handler
    if (data.startsWith('provider:')) {
      const providerId = data.substring('provider:'.length);
      await this.commandHandler.handleProviderSelect(ctx, providerId);
      return;
    }
    
    if (data.startsWith('model:')) {
      const modelId = data.substring('model:'.length);
      await this.commandHandler.handleModelSelect(ctx, modelId);
      return;
    }
    
    if (data === 'cancel') {
      await this.commandHandler.handleCancel(ctx);
      return;
    }
    
    if (data === 'providers') {
      await this.commandHandler.handleShowProviders(ctx);
      return;
    }
    
    if (data === 'cleanup:confirm') {
      await this.commandHandler.handleCleanupConfirm(ctx);
      return;
    }
    
    await ctx.answerCallbackQuery('Unknown action');
  }
  
  private async processMessages(items: TelegramMessageEvent[]): Promise<void> {
    if (items.length === 0) return;
    
    const last = items[items.length - 1];
    const ctx = last.ctx;
    const accountId = last.accountId;
    if (!this.accountManager.getAccount(accountId)) {
      log.warn({ accountId }, 'Unknown account');
      return;
    }

    const account = this.configAdapter.resolveAccount(this.cfg, accountId);

    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const senderId = ctx.from?.id?.toString() ?? '';
    const senderUsername = ctx.from?.username;
    const chatId = ctx.chat?.id?.toString() ?? '';
    
    // Security check
    const securityCtx: ChannelSecurityContext = {
      accountId,
      chatId,
      senderId,
      senderName: senderUsername,
      isGroup,
    };
    
    const accessResult = this.securityAdapter.checkAccess?.(securityCtx, account, this.cfg);
    
    if (!accessResult?.allowed) {
      log.debug({ accountId, chatId, reason: accessResult?.reason }, 'Access denied');
      return;
    }

    await this.inboundProcessor(ctx, accountId);
  }
  
  private async doSendText(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> {
    const result = await this.outboundSender.send({
      chatId: ctx.to,
      content: ctx.text,
      accountId: ctx.accountId,
      threadId: ctx.threadId?.toString(),
      replyToMessageId: ctx.replyToId?.toString(),
      silent: ctx.silent,
    });
    
    return {
      messageId: result.messageId,
      chatId: result.chatId,
      success: result.success,
      error: result.error,
    };
  }
  
  private async doSendPayload(ctx: ChannelOutboundContext & { payload: any }): Promise<OutboundDeliveryResult> {
    const payload = ctx.payload as OutboundMessage;
    
    const result = await this.outboundSender.send({
      chatId: ctx.to,
      content: ctx.text,
      type: payload.type,
      accountId: ctx.accountId,
      threadId: ctx.threadId?.toString(),
      replyToMessageId: ctx.replyToId?.toString(),
      silent: ctx.silent,
      mediaUrl: ctx.mediaUrl,
      audioAsVoice: ctx.audioAsVoice,
    });
    
    return {
      messageId: result.messageId,
      chatId: result.chatId,
      success: result.success,
      error: result.error,
    };
  }

  private async doSendMedia(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> {
    const mediaUrl = ctx.mediaUrl?.trim();
    if (!mediaUrl) {
      return { messageId: '', chatId: ctx.to, success: false, error: 'No media URL' };
    }
    const result = await this.outboundSender.send({
      chatId: ctx.to,
      content: ctx.text ?? '',
      accountId: ctx.accountId,
      threadId: ctx.threadId?.toString(),
      replyToMessageId: ctx.replyToId?.toString(),
      silent: ctx.silent,
      mediaUrl,
      mediaType: ctx.mediaType,
      audioAsVoice: ctx.audioAsVoice,
    });
    return {
      messageId: result.messageId,
      chatId: result.chatId,
      success: result.success,
      error: result.error,
    };
  }
  
  // Streaming (interface implementation)
  startStream(_options: { chatId: string; accountId?: string; threadId?: string; replyToMessageId?: string }): ChannelStreamHandle | null {
    return null;
  }
}

// Export singleton
export const telegramPlugin = new TelegramChannelPlugin();

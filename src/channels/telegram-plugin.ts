/**
 * Telegram Channel Plugin - Implementation based on ChannelPlugin interface
 * 
 * This plugin integrates Telegram with the ChannelPlugin architecture.
 * It reuses components from the telegram/ directory where possible.
 */

import { Bot, type Context } from 'grammy';
import { run } from '@grammyjs/runner';
import type { Message } from '@grammyjs/types';

import type {
  ChannelPlugin,
  ChannelPluginInitOptions,
  ChannelPluginStartOptions,
  ChannelOutboundContext,
  OutboundDeliveryResult,
  ChannelStreamHandle,
  ChannelStatusAdapter,
  ChannelSecurityAdapter,
  ChannelConfigAdapter,
  ChannelCapabilities,
  ChannelMetadata,
  ChannelAccountSnapshot,
  ChannelSecurityContext,
} from './plugin-types.js';
import type { OutboundMessage } from '../types/index.js';
import { generateSessionKey } from '../commands/session-key.js';

import { createLogger } from '../utils/logger.js';
import { createInboundDebouncer } from '../infra/debounce.js';
import { removeBotMention, evaluateAccess, resolveDmPolicy, resolveGroupPolicy } from './security.js';

// Reuse telegram/ modules
import { TelegramAccountManager } from './telegram/account-manager.js';
import { createOutboundSender } from './telegram/outbound-sender.js';
import { createTelegramCommandHandler } from './telegram/command-handler.js';

const log = createLogger('TelegramPlugin');

// ============================================
// Types (compatible with both plugin-types and telegram/types)
// ============================================

interface TelegramAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  token: string;
  apiRoot?: string;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'disabled' | 'allowlist';
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  requireMention?: boolean;
  streamMode?: 'off' | 'partial' | 'block';
}

interface TelegramMessageEvent {
  ctx: Context;
  accountId: string;
  message: Message;
}

// ============================================
// Plugin Implementation
// ============================================

export class TelegramChannelPlugin implements ChannelPlugin<TelegramAccount> {
  readonly id = 'telegram' as const;
  
  readonly meta: ChannelMetadata = {
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
    } as ChannelCapabilities,
  };
  
  // Internal state
  private bus!: NonNullable<ChannelPluginInitOptions['bus']>;
  private cfg!: NonNullable<ChannelPluginInitOptions['config']>;
  private debouncer!: ReturnType<typeof createInboundDebouncer<TelegramMessageEvent>>;
  
  // Reused components
  private accountManager!: TelegramAccountManager;
  private outboundSender!: ReturnType<typeof createOutboundSender>;
  private commandHandler!: ReturnType<typeof createTelegramCommandHandler>;
  
  // Interface implementations
  configAdapter!: ChannelConfigAdapter<TelegramAccount>;
  securityAdapter!: ChannelSecurityAdapter<TelegramAccount>;
  statusAdapter!: ChannelStatusAdapter<TelegramAccount>;
  
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
    textChunkLimit: 4000,
    sendText: async (ctx) => this.doSendText(ctx),
    sendMedia: async (ctx) => ({ messageId: '', chatId: ctx.to, success: false, error: 'Not implemented' }),
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
    
    this.initAdapters();
    
    this.debouncer = createInboundDebouncer<TelegramMessageEvent>({
      debounceMs: 300,
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
  
  private loadAccounts(): void {
    const telegramCfg = this.cfg.channels?.telegram as Record<string, unknown> | undefined;
    if (!telegramCfg) return;
    
    if (telegramCfg.token && !telegramCfg.accounts) {
      this.accountManager.registerAccount({
        accountId: 'default',
        name: 'Default Account',
        enabled: true,
        token: telegramCfg.token as string,
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
  
  private initAdapters(): void {
    // Config Adapter
    this.configAdapter = {
      listAccountIds: () => this.accountManager.getAllAccounts().map(a => a.accountId),
      resolveAccount: (_cfg, accountId = 'default') => {
        const account = this.accountManager.getAccount(accountId);
        if (!account) return { accountId, enabled: false, token: '' };
        return {
          accountId: account.accountId,
          name: account.name,
          enabled: account.enabled !== false,
          token: account.token || '',
          apiRoot: account.apiRoot,
          dmPolicy: account.dmPolicy as any,
          groupPolicy: account.groupPolicy as any,
          allowFrom: account.allowFrom,
          groupAllowFrom: account.groupAllowFrom,
          requireMention: (account as any).requireMention,
          streamMode: account.streamMode,
        } as TelegramAccount;
      },
      isEnabled: (account) => account.enabled !== false,
      disabledReason: (account) => {
        if (account.enabled === false) return 'Account disabled';
        if (!account.token) return 'No token configured';
        return '';
      },
      isConfigured: async (account) => !!account.token,
      describeAccount: (account) => {
        const status = this.accountManager.getStatus(account.accountId);
        return {
          accountId: account.accountId,
          channelId: 'telegram',
          enabled: account.enabled !== false,
          configured: !!account.token,
          status: status?.running ? 'running' : 'stopped',
        } as ChannelAccountSnapshot;
      },
    };
    
    // Security Adapter
    this.securityAdapter = {
      resolveDmPolicy: ({ account }) => resolveDmPolicy(account.dmPolicy as any, 'open'),
      resolveGroupPolicy: ({ account }) => resolveGroupPolicy(account.groupPolicy as any, 'open'),
      resolveAllowFrom: ({ account }) => account.allowFrom,
      checkAccess: (ctx, account) => {
        const isGroup = ctx.isGroup;
        const allowFrom = isGroup 
          ? (account.groupAllowFrom ?? account.allowFrom ?? [])
          : (account.allowFrom ?? []);
        const result = evaluateAccess({
          context: {
            channel: 'telegram',
            accountId: account.accountId,
            chatId: ctx.chatId,
            senderId: ctx.senderId,
            senderName: ctx.senderName,
            isGroup,
            isDm: !isGroup,
          },
          dmPolicy: account.dmPolicy as any,
          groupPolicy: account.groupPolicy as any,
          allowFrom,
          groupAllowFrom: account.groupAllowFrom,
        });
        return { allowed: result.allowed, reason: result.reason };
      },
    };
    
    // Status Adapter
    this.statusAdapter = {
      defaultRuntime: {
        accountId: 'default',
        channelId: 'telegram',
        enabled: true,
        configured: false,
      },
      buildChannelSummary: async ({ account }) => {
        const status = this.accountManager.getStatus(account.accountId);
        return {
          accountId: account.accountId,
          enabled: account.enabled !== false,
          configured: !!account.token,
          running: status?.running ?? false,
          username: this.accountManager.getBotUsername(account.accountId),
        };
      },
      probeAccount: async ({ account, timeoutMs }) => {
        const bot = this.accountManager.getBot(account.accountId);
        if (!bot) throw new Error('Bot not initialized');
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          const me = await bot.api.getMe();
          clearTimeout(timeout);
          return { ok: true, username: me.username, id: me.id };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
      buildAccountSnapshot: async ({ account }) => {
        const status = this.accountManager.getStatus(account.accountId);
        return {
          accountId: account.accountId,
          channelId: 'telegram',
          enabled: account.enabled !== false,
          configured: !!account.token,
          status: status?.running ? 'running' : 'stopped',
        } as ChannelAccountSnapshot;
      },
      resolveAccountState: ({ account, configured, enabled }) => {
        if (!configured) return 'offline';
        if (!enabled) return 'disabled';
        const status = this.accountManager.getStatus(account.accountId);
        return status?.running ? 'online' : 'offline';
      },
    };
  }
  
  async start(options?: ChannelPluginStartOptions): Promise<void> {
    const accountIds = options?.accountId 
      ? [options.accountId] 
      : this.configAdapter.listAccountIds(this.cfg);
    
    for (const accountId of accountIds) {
      const account = this.configAdapter.resolveAccount(this.cfg, accountId);
      if (!account.enabled || !account.token) continue;
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
  
  private async startAccount(account: TelegramAccount): Promise<void> {
    if (this.accountManager.isRunning(account.accountId)) return;
    if (!account.token) return;
    
    this.accountManager.markStarting(account.accountId);
    
    try {
      const botConfig = account.apiRoot ? { client: { apiRoot: account.apiRoot } } : undefined;
      const bot = new Bot(account.token, botConfig);
      const me = await bot.api.getMe();
      
      const runner = run(bot, {
        runner: { fetch: { timeout: 30 }, silent: true, maxRetryTime: 5 * 60 * 1000, retryInterval: 'exponential' },
      });
      
      this.accountManager.registerBot(account.accountId, bot);
      this.accountManager.registerRunner(account.accountId, runner);
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
    const account = this.accountManager.getAccount(accountId);
    
    if (!account) {
      log.warn({ accountId }, 'Unknown account');
      return;
    }
    
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
    
    const accessResult = this.securityAdapter.checkAccess(securityCtx, account as any, this.cfg);
    
    if (!accessResult?.allowed) {
      log.debug({ accountId, chatId, reason: accessResult?.reason }, 'Access denied');
      return;
    }
    
    const botUsername = this.accountManager.getBotUsername(accountId) ?? '';
    const text = ctx.message.text ?? ctx.message.caption ?? '';
    const cleanedText = (account as any).requireMention && isGroup
      ? removeBotMention({ text, botUsername })
      : text;
    
    // Media processing is simplified - in production, use createInboundProcessor
    // For now, just extract text content
    const finalContent = cleanedText;

    // Generate proper session key with new routing format
    const sessionKey = generateSessionKey({
      source: 'telegram',
      chatId,
      senderId,
      isGroup,
      threadId: ctx.message.message_thread_id?.toString(),
      accountId,
    });

    const inboundMsg = {
      channel: 'telegram' as const,
      chat_id: chatId,
      sender_id: senderId,
      content: finalContent,
      metadata: {
        accountId,
        senderUsername,
        messageId: ctx.message.message_id?.toString(),
        threadId: ctx.message.message_thread_id?.toString(),
        isGroup,
        sessionKey,
      },
    };
    
    log.info({
      accountId,
      chatId,
      senderId,
      contentLength: finalContent.length,
    }, 'Processing Telegram message');
    
    this.bus.publishInbound(inboundMsg);
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
  
  // Streaming (interface implementation)
  startStream(_options: { chatId: string; accountId?: string; threadId?: string; replyToMessageId?: string }): ChannelStreamHandle | null {
    return null;
  }
}

// Export singleton
export const telegramPlugin = new TelegramChannelPlugin();

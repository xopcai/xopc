/**
 * Telegram Channel Plugin - Implementation based on ChannelPlugin interface
 */

import { Bot, type Context } from 'grammy';
import { run } from '@grammyjs/runner';
import type { Message } from '@grammyjs/types';
import { InputFile } from 'grammy';

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
  DmPolicy,
  GroupPolicy,
  ChannelSecurityContext,
} from './plugin-types.js';
import type { OutboundMessage } from '../types/index.js';

import { createLogger } from '../utils/logger.js';
import { createInboundDebouncer } from '../infra/debounce.js';
import { createRetryRunner } from '../infra/retry.js';
import { removeBotMention, evaluateAccess, resolveDmPolicy, resolveGroupPolicy } from './security.js';
import { renderTelegramHtmlText, stripUnknownHtmlTags } from './telegram/format.js';

const log = createLogger('TelegramPlugin');

// ============================================
// Types
// ============================================

interface TelegramAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  token: string;
  apiRoot?: string;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  requireMention?: boolean;
  streamMode?: 'off' | 'partial' | 'block';
}

interface TelegramBotState {
  bot: Bot;
  username: string;
  runner?: ReturnType<typeof run>;
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
  private accounts = new Map<string, TelegramAccount>();
  private bots = new Map<string, TelegramBotState>();
  private bus!: NonNullable<ChannelPluginInitOptions['bus']>;
  private cfg!: NonNullable<ChannelPluginInitOptions['config']>;
  private debouncer!: ReturnType<typeof createInboundDebouncer<TelegramMessageEvent>>;
  
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
    this.loadAccounts();
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
  
  private initAdapters(): void {
    // Config Adapter
    this.configAdapter = {
      listAccountIds: (cfg) => {
        const telegramCfg = cfg.channels?.telegram as Record<string, unknown> | undefined;
        if (!telegramCfg) return [];
        if (telegramCfg.token && !telegramCfg.accounts) return ['default'];
        const accounts = telegramCfg.accounts as Record<string, TelegramAccount> | undefined;
        return accounts ? Object.keys(accounts) : [];
      },
      resolveAccount: (cfg, accountId = 'default') => {
        const telegramCfg = cfg.channels?.telegram as Record<string, unknown> | undefined;
        if (!telegramCfg) return { accountId, enabled: false, token: '' };
        if (telegramCfg.token && !telegramCfg.accounts) {
          return {
            accountId: 'default',
            name: 'Default Account',
            enabled: true,
            token: telegramCfg.token as string,
            apiRoot: telegramCfg.apiRoot as string | undefined,
            dmPolicy: telegramCfg.dmPolicy as DmPolicy | undefined,
            groupPolicy: telegramCfg.groupPolicy as GroupPolicy | undefined,
            allowFrom: telegramCfg.allowFrom as Array<string | number> | undefined,
            groupAllowFrom: telegramCfg.groupAllowFrom as Array<string | number> | undefined,
            requireMention: telegramCfg.requireMention as boolean | undefined,
          };
        }
        const accounts = telegramCfg.accounts as Record<string, TelegramAccount> | undefined;
        if (accounts && accountId in accounts) return accounts[accountId];
        return { accountId, enabled: false, token: '' };
      },
      isEnabled: (account) => account.enabled !== false,
      disabledReason: (account) => {
        if (account.enabled === false) return 'Account disabled';
        if (!account.token) return 'No token configured';
        return '';
      },
      isConfigured: async (account) => !!account.token,
      describeAccount: (account) => {
        const botState = this.bots.get(account.accountId);
        return {
          accountId: account.accountId,
          channelId: 'telegram',
          enabled: account.enabled !== false,
          configured: !!account.token,
          status: botState?.runner ? 'running' : 'stopped',
        } as ChannelAccountSnapshot;
      },
    };
    
    // Security Adapter
    this.securityAdapter = {
      resolveDmPolicy: ({ account }) => resolveDmPolicy(account.dmPolicy, 'open'),
      resolveGroupPolicy: ({ account }) => resolveGroupPolicy(account.groupPolicy, 'open'),
      resolveAllowFrom: ({ account }) => account.allowFrom,
      checkAccess: (ctx, account) => {
        const isGroup = ctx.isGroup;
        const policy = isGroup 
          ? resolveGroupPolicy(account.groupPolicy, 'open')
          : resolveDmPolicy(account.dmPolicy, 'open');
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
          dmPolicy: account.dmPolicy,
          groupPolicy: account.groupPolicy,
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
        const botState = this.bots.get(account.accountId);
        return {
          accountId: account.accountId,
          enabled: account.enabled !== false,
          configured: !!account.token,
          running: !!botState?.runner,
          username: botState?.username,
        };
      },
      probeAccount: async ({ account, timeoutMs }) => {
        const botState = this.bots.get(account.accountId);
        if (!botState?.bot) throw new Error('Bot not initialized');
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          const me = await botState.bot.api.getMe();
          clearTimeout(timeout);
          return { ok: true, username: me.username, id: me.id };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
      buildAccountSnapshot: async ({ account }) => {
        const botState = this.bots.get(account.accountId);
        return {
          accountId: account.accountId,
          channelId: 'telegram',
          enabled: account.enabled !== false,
          configured: !!account.token,
          status: botState?.runner ? 'running' : 'stopped',
        } as ChannelAccountSnapshot;
      },
      resolveAccountState: ({ account, configured, enabled }) => {
        if (!configured) return 'offline';
        if (!enabled) return 'disabled';
        const botState = this.bots.get(account.accountId);
        return botState?.runner ? 'online' : 'offline';
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
    const ids = accountId ? [accountId] : Array.from(this.bots.keys());
    for (const id of ids) {
      await this.stopAccount(id);
    }
  }
  
  // ========================================
  // Private Methods
  // ========================================
  
  private loadAccounts(): void {
    const telegramCfg = this.cfg.channels?.telegram as Record<string, unknown> | undefined;
    if (!telegramCfg) return;
    
    if (telegramCfg.token && !telegramCfg.accounts) {
      this.accounts.set('default', {
        accountId: 'default',
        name: 'Default Account',
        enabled: true,
        token: telegramCfg.token as string,
        apiRoot: telegramCfg.apiRoot as string | undefined,
        dmPolicy: telegramCfg.dmPolicy as DmPolicy | undefined,
        groupPolicy: telegramCfg.groupPolicy as GroupPolicy | undefined,
        allowFrom: telegramCfg.allowFrom as Array<string | number> | undefined,
        groupAllowFrom: telegramCfg.groupAllowFrom as Array<string | number> | undefined,
        requireMention: telegramCfg.requireMention as boolean | undefined,
      });
      return;
    }
    
    const accounts = telegramCfg.accounts as Record<string, TelegramAccount> | undefined;
    if (accounts) {
      for (const [id, account] of Object.entries(accounts)) {
        this.accounts.set(id, { ...account, accountId: id });
      }
    }
  }
  
  private async startAccount(account: TelegramAccount): Promise<void> {
    if (this.bots.has(account.accountId)) return;
    
    const botConfig = account.apiRoot ? { client: { apiRoot: account.apiRoot } } : undefined;
    const bot = new Bot(account.token, botConfig);
    const me = await bot.api.getMe();
    
    const runner = run(bot, {
      runner: { fetch: { timeout: 30 }, silent: true, maxRetryTime: 5 * 60 * 1000, retryInterval: 'exponential' },
    });
    
    this.bots.set(account.accountId, { bot, username: me.username, runner });
    this.setupMessageHandler(account.accountId, bot);
    
    log.info({ accountId: account.accountId, username: me.username }, 'Telegram account started');
  }
  
  private async stopAccount(accountId: string): Promise<void> {
    const botState = this.bots.get(accountId);
    if (!botState) return;
    await botState.runner?.stop();
    this.bots.delete(accountId);
    log.info({ accountId }, 'Telegram account stopped');
  }
  
  private setupMessageHandler(accountId: string, bot: Bot): void {
    bot.on('message', async (ctx) => {
      try {
        await this.debouncer.enqueue({ ctx, accountId, message: ctx.message });
      } catch (err) {
        log.error({ accountId, err }, 'Message handler error');
      }
    });
  }
  
  private async processMessages(items: TelegramMessageEvent[]): Promise<void> {
    if (items.length === 0) return;
    
    const last = items[items.length - 1];
    const ctx = last.ctx;
    const accountId = last.accountId;
    const account = this.accounts.get(accountId);
    
    if (!account) {
      log.warn({ accountId }, 'Unknown account');
      return;
    }
    
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const senderId = ctx.from?.id?.toString() ?? '';
    const senderUsername = ctx.from?.username;
    const chatId = ctx.chat?.id?.toString() ?? '';
    
    // 安全检查
    const securityCtx: ChannelSecurityContext = {
      accountId,
      chatId,
      senderId,
      senderName: senderUsername,
      isGroup,
    };
    
    const accessResult = this.securityAdapter.checkAccess(securityCtx, account, this.cfg);
    
    if (!accessResult?.allowed) {
      log.debug({ accountId, chatId, reason: accessResult?.reason }, 'Access denied');
      return;
    }
    
    const text = ctx.message.text ?? ctx.message.caption ?? '';
    const cleanedText = account.requireMention && isGroup
      ? removeBotMention({ text, botUsername: this.bots.get(accountId)?.username ?? '' })
      : text;
    
    const inboundMsg = {
      channel: 'telegram' as const,
      chat_id: chatId,
      sender_id: senderId,
      content: cleanedText,
      metadata: {
        accountId,
        senderUsername,
        messageId: ctx.message.message_id?.toString(),
        threadId: ctx.message.message_thread_id?.toString(),
        isGroup,
      },
    };
    
    this.bus.publishInbound(inboundMsg);
  }
  
  private async doSendText(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> {
    const botState = this.bots.get(ctx.accountId ?? 'default');
    if (!botState?.bot) {
      return { messageId: '', chatId: ctx.to, success: false, error: 'Bot not initialized' };
    }
    
    // Skip empty messages
    if (!ctx.text || ctx.text.trim() === '') {
      log.debug({ chatId: ctx.to }, 'Skipping empty message');
      return { messageId: '', chatId: ctx.to, success: true };
    }
    
    // Convert markdown to Telegram HTML, then strip unknown HTML tags
    const htmlText = renderTelegramHtmlText(ctx.text);
    const sanitizedText = stripUnknownHtmlTags(htmlText);
    
    const retry = createRetryRunner({ label: 'telegram-send' });
    
    try {
      const message = await retry(async () => 
        botState.bot.api.sendMessage(ctx.to, sanitizedText, {
          parse_mode: 'HTML',
          reply_to_message_id: ctx.replyToId ? parseInt(ctx.replyToId.toString()) : undefined,
          message_thread_id: ctx.threadId ? parseInt(ctx.threadId.toString()) : undefined,
          disable_notification: ctx.silent,
        })
      );
      return { messageId: message.message_id.toString(), chatId: ctx.to, success: true };
    } catch (err) {
      return { messageId: '', chatId: ctx.to, success: false, error: String(err) };
    }
  }
  
  private async doSendPayload(ctx: ChannelOutboundContext & { payload: any }): Promise<OutboundDeliveryResult> {
    const botState = this.bots.get(ctx.accountId ?? 'default');
    if (!botState?.bot) {
      return { messageId: '', chatId: ctx.to, success: false, error: 'Bot not initialized' };
    }
    
    const payload = ctx.payload as OutboundMessage;
    
    // Handle typing indicators
    if (payload.type === 'typing_on') {
      try {
        await botState.bot.api.sendChatAction(ctx.to, 'typing');
        log.debug({ chatId: ctx.to }, 'Sent typing indicator');
        return { messageId: '', chatId: ctx.to, success: true };
      } catch (err) {
        log.warn({ chatId: ctx.to, err }, 'Failed to send typing indicator');
        return { messageId: '', chatId: ctx.to, success: false, error: String(err) };
      }
    }
    
    if (payload.type === 'typing_off') {
      // Telegram doesn't have a typing_off action, just ignore
      return { messageId: '', chatId: ctx.to, success: true };
    }
    
    // Handle voice messages (TTS audio with audioAsVoice flag)
    if (ctx.mediaUrl && ctx.audioAsVoice) {
      return this.doSendVoice(ctx);
    }
    
    // Handle other media types
    if (ctx.mediaUrl) {
      return this.doSendMedia(ctx);
    }
    
    // For text-only messages, fall back to sendText
    return this.doSendText(ctx);
  }
  
  private async doSendVoice(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> {
    const botState = this.bots.get(ctx.accountId ?? 'default');
    if (!botState?.bot) {
      return { messageId: '', chatId: ctx.to, success: false, error: 'Bot not initialized' };
    }
    
    if (!ctx.mediaUrl) {
      return { messageId: '', chatId: ctx.to, success: false, error: 'No mediaUrl for voice message' };
    }
    
    try {
      // Parse data URL
      const parsed = this.parseDataUrl(ctx.mediaUrl);
      if (!parsed) {
        return { messageId: '', chatId: ctx.to, success: false, error: 'Invalid voice message data URL format' };
      }
      
      const { buffer } = parsed;
      const file = new InputFile(buffer, 'voice.ogg');
      
      // Use caption for the text content (if any)
      const caption = ctx.text?.trim();
      
      const sendOptions: any = {
        reply_to_message_id: ctx.replyToId ? parseInt(ctx.replyToId.toString(), 10) : undefined,
        message_thread_id: ctx.threadId ? parseInt(ctx.threadId.toString(), 10) : undefined,
        disable_notification: ctx.silent,
      };
      
      if (caption) {
        // Convert markdown to Telegram HTML, then strip unknown HTML tags
        const htmlCaption = stripUnknownHtmlTags(renderTelegramHtmlText(caption));
        sendOptions.caption = htmlCaption;
        sendOptions.parse_mode = 'HTML';
      }
      
      const result = await botState.bot.api.sendVoice(ctx.to, file, sendOptions);
      
      log.info({ chatId: ctx.to, messageId: result.message_id }, 'Voice message sent');
      
      return { messageId: result.message_id.toString(), chatId: ctx.to, success: true };
    } catch (err) {
      log.error({ chatId: ctx.to, err }, 'Failed to send voice message');
      return { messageId: '', chatId: ctx.to, success: false, error: String(err) };
    }
  }
  
  private async doSendMedia(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> {
    const botState = this.bots.get(ctx.accountId ?? 'default');
    if (!botState?.bot) {
      return { messageId: '', chatId: ctx.to, success: false, error: 'Bot not initialized' };
    }
    
    if (!ctx.mediaUrl) {
      return { messageId: '', chatId: ctx.to, success: false, error: 'No mediaUrl' };
    }
    
    try {
      // Parse data URL
      const parsed = this.parseDataUrl(ctx.mediaUrl);
      if (!parsed) {
        return { messageId: '', chatId: ctx.to, success: false, error: 'Invalid data URL format' };
      }
      
      const { mimeType, buffer } = parsed;
      const file = new InputFile(buffer);
      
      // Use caption for the text content (if any)
      const caption = ctx.text?.trim();
      
      const sendOptions: any = {
        reply_to_message_id: ctx.replyToId ? parseInt(ctx.replyToId.toString(), 10) : undefined,
        message_thread_id: ctx.threadId ? parseInt(ctx.threadId.toString(), 10) : undefined,
        disable_notification: ctx.silent,
      };
      
      if (caption) {
        const htmlCaption = stripUnknownHtmlTags(renderTelegramHtmlText(caption));
        sendOptions.caption = htmlCaption;
        sendOptions.parse_mode = 'HTML';
      }
      
      // Determine media type from MIME type
      const method = this.resolveMediaMethod(mimeType);
      let result: { message_id: number };
      
      switch (method) {
        case 'sendPhoto':
          result = await botState.bot.api.sendPhoto(ctx.to, file, sendOptions);
          break;
        case 'sendVideo':
          result = await botState.bot.api.sendVideo(ctx.to, file, sendOptions);
          break;
        case 'sendAudio':
          result = await botState.bot.api.sendAudio(ctx.to, file, sendOptions);
          break;
        default:
          result = await botState.bot.api.sendDocument(ctx.to, file, sendOptions);
      }
      
      return { messageId: result.message_id.toString(), chatId: ctx.to, success: true };
    } catch (err) {
      log.error({ chatId: ctx.to, err }, 'Failed to send media message');
      return { messageId: '', chatId: ctx.to, success: false, error: String(err) };
    }
  }
  
  private parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
    if (!dataUrl.startsWith('data:')) return null;
    
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    
    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    return { mimeType, buffer };
  }
  
  private resolveMediaMethod(mimeType: string): 'sendPhoto' | 'sendVideo' | 'sendAudio' | 'sendDocument' {
    if (mimeType.startsWith('image/')) return 'sendPhoto';
    if (mimeType.startsWith('video/')) return 'sendVideo';
    if (mimeType.startsWith('audio/')) return 'sendAudio';
    return 'sendDocument';
  }
  
  // Streaming (接口实现)
  startStream(_options: { chatId: string; accountId?: string; threadId?: string; replyToMessageId?: string }): ChannelStreamHandle | null {
    return null;
  }
}

// Export singleton
export const telegramPlugin = new TelegramChannelPlugin();

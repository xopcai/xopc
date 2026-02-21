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

const log = createLogger('TelegramPlugin');

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
}

interface QueuedMessage {
  ctx: Context;
  accountId: string;
  resolve: () => void;
  reject: (err: Error) => void;
}

function createMessageProcessor(deps: MessageProcessorDeps) {
  const { bus, config, accountManager } = deps;
  
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

    log.info({ accountId, chatId, senderId, isGroup, threadId, sessionKey, contentLength: cleanContent.length }, 'Processing Telegram message');

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
  private bus: any = null;
  private config: Config | null = null;

  async init(options: ChannelInitOptions): Promise<void> {
    this.bus = options.bus;
    this.config = options.config;
    this.messageProcessor = createMessageProcessor({
      bus: options.bus,
      config: options.config,
      accountManager: this.accountManager,
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

      // Register message handler
      const enqueueMessage = this.messageProcessor;
      bot.on('message', async (ctx) => {
        try {
          await enqueueMessage(ctx, accountId);
        } catch (err) {
          log.error({ accountId, err }, 'Failed to process message');
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

    const bot = this.accountManager.getBot(accountId);
    if (!bot) {
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

    // Skip empty messages
    if (!content || content.trim() === '') {
      log.debug({ chatId }, 'Skipping empty message');
      return { messageId: '', chatId, success: true };
    }

    try {
      let sentMessageId: number;

      if (mediaUrl) {
        const response = await fetch(mediaUrl);
        if (!response.ok) throw new Error(`Failed to fetch media: ${response.status}`);
        const buffer = await response.arrayBuffer();
        const file = new InputFile(Buffer.from(buffer));

        const sendOptions: any = {
          parse_mode: 'HTML',
          caption: content ? formatTelegramMessage(content).html : undefined,
        };
        if (threadId) sendOptions.message_thread_id = parseInt(threadId, 10);
        if (replyToMessageId) sendOptions.reply_to_message_id = parseInt(replyToMessageId, 10);
        if (silent) sendOptions.disable_notification = true;

        switch (mediaType) {
          case 'photo':
            sentMessageId = (await bot.api.sendPhoto(chatId, file, sendOptions)).message_id;
            break;
          case 'video':
            sentMessageId = (await bot.api.sendVideo(chatId, file, sendOptions)).message_id;
            break;
          case 'audio':
            sentMessageId = (await bot.api.sendAudio(chatId, file, sendOptions)).message_id;
            break;
          default:
            sentMessageId = (await bot.api.sendDocument(chatId, file, sendOptions)).message_id;
        }
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
      log.error({ accountId, chatId, err }, 'Failed to send message');
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

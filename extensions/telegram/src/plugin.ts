/**
 * Telegram Channel Plugin - Implementation based on ChannelPlugin interface
 *
 * This plugin integrates Telegram with the ChannelPlugin architecture.
 * It reuses components from this package's src tree where possible.
 */

import { Bot, type Context } from 'grammy';
import { run } from '@grammyjs/runner';

import type { Config } from '@xopcai/xopcbot/config/index.js';
import type {
  ChannelPlugin,
  ChannelPluginDefaults,
  ChannelPluginInitOptions,
  ChannelPluginReloadMeta,
  ChannelPluginSessionModelHooks,
  ChannelPluginStartOptions,
  ChannelOutboundAdapter,
  ChannelSecurityContext,
  ChannelGatewayAdapter,
  ChannelStreamingAdapter,
  ChannelCommandAdapter,
} from '@xopcai/xopcbot/channels/plugin-types.js';
import { generateSessionKey } from '@xopcai/xopcbot/commands/session-key.js';

import { createLogger } from '@xopcai/xopcbot/utils/logger.js';
import { createInboundDebouncer } from '@xopcai/xopcbot/infra/debounce.js';
import { getChatChannelMeta } from '@xopcai/xopcbot/channels/registry.js';
import { getMimeType } from '@xopcai/xopcbot/utils/media.js';
import { transcribe as sttTranscribe, isSTTAvailable } from '@xopcai/xopcbot/stt/index.js';
import type { STTConfig } from '@xopcai/xopcbot/stt/types.js';

import { TelegramAccountManager } from './account-manager.js';
import { createOutboundSender } from './outbound-sender.js';
import { createTelegramCommandHandler } from './command-handler.js';
import { createInboundProcessor } from './inbound-processor.js';
import { TELEGRAM_CHANNEL_DEFAULTS } from './plugin-defaults.js';
import {
  createTelegramPluginAdapters,
  createTelegramSetupWizard,
  createTelegramOutboundSendMethods,
  telegramTextChunker,
  TELEGRAM_OUTBOUND_DEFAULTS,
  createTelegramInboundAccessControl,
  telegramDebouncerKeyPolicy,
  type TelegramMessageEvent,
} from './adapters/index.js';
import {
  createTelegramGatewayAdapter,
  createTelegramStreamingAdapter,
  createTelegramCommandAdapter,
} from './channel.js';
import type { TelegramResolvedAccount } from './adapters/index.js';

const log = createLogger('TelegramPlugin');

const TELEGRAM_REGISTRY_META = getChatChannelMeta('telegram');

export type { TelegramResolvedAccount as TelegramAccount } from './channel.js';

export class TelegramChannelPlugin implements ChannelPlugin<TelegramResolvedAccount> {
  readonly id = 'telegram' as const;

  readonly reload: ChannelPluginReloadMeta = {
    configPrefixes: ['channels.telegram'],
  };

  readonly meta = {
    id: TELEGRAM_REGISTRY_META.id,
    label: TELEGRAM_REGISTRY_META.label,
    selectionLabel: 'Telegram Bot',
    docsPath: '/channels/telegram',
    blurb: TELEGRAM_REGISTRY_META.description,
    order: 1,
  } as const;

  readonly capabilities = TELEGRAM_REGISTRY_META.capabilities;

  readonly defaults: ChannelPluginDefaults = {
    queue: { debounceMs: TELEGRAM_CHANNEL_DEFAULTS.queue.debounceMs },
    outbound: { textChunkLimit: TELEGRAM_CHANNEL_DEFAULTS.outbound.textChunkLimit },
  };

  readonly setupWizard = createTelegramSetupWizard();

  private bus!: NonNullable<ChannelPluginInitOptions['bus']>;
  private cfg!: NonNullable<ChannelPluginInitOptions['config']>;
  private debouncer!: ReturnType<typeof createInboundDebouncer<TelegramMessageEvent>>;

  private accountManager!: TelegramAccountManager;
  private outboundSender!: ReturnType<typeof createOutboundSender>;
  private commandHandler!: ReturnType<typeof createTelegramCommandHandler>;
  private inboundProcessor!: ReturnType<typeof createInboundProcessor>;
  private sessionModelHooks?: ChannelPluginSessionModelHooks;

  config!: import('@xopcai/xopcbot/channels/plugin-types.js').ChannelConfigAdapter<TelegramResolvedAccount>;
  security!: import('@xopcai/xopcbot/channels/plugin-types.js').ChannelSecurityAdapter<TelegramResolvedAccount>;
  status!: import('@xopcai/xopcbot/channels/plugin-types.js').ChannelStatusAdapter<TelegramResolvedAccount>;

  outbound!: ChannelOutboundAdapter;

  gateway!: ChannelGatewayAdapter<TelegramResolvedAccount>;

  streaming!: ChannelStreamingAdapter;

  commands!: ChannelCommandAdapter;

  async init(options: ChannelPluginInitOptions): Promise<void> {
    this.bus = options.bus;
    this.cfg = options.config;
    this.sessionModelHooks = options.sessionModel;

    this.accountManager = new TelegramAccountManager();
    this.loadAccounts();
    this.bindOutboundComponents();

    const debounceMs =
      this.defaults.queue?.debounceMs ?? TELEGRAM_CHANNEL_DEFAULTS.queue.debounceMs;
    const keyPolicy = telegramDebouncerKeyPolicy();
    this.debouncer = createInboundDebouncer<TelegramMessageEvent>({
      debounceMs,
      ...keyPolicy,
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
    const sm = this.sessionModelHooks;
    this.commandHandler = createTelegramCommandHandler({
      bus: this.bus,
      config: this.cfg,
      accountManager: this.accountManager,
      getSessionModel: (sessionKey) => sm?.getModelForSession(sessionKey),
      setSessionModel: (sessionKey, modelId) => {
        if (!sm) return;
        void sm.switchModelForSession(sessionKey, modelId);
      },
    });
    const adapters = createTelegramPluginAdapters({
      accountManager: this.accountManager,
    });
    this.config = adapters.config;
    this.security = adapters.security;
    this.status = adapters.status;

    const accessControl = createTelegramInboundAccessControl();

    this.inboundProcessor = createInboundProcessor({
      bus: this.bus,
      config: this.cfg,
      accountManager: this.accountManager,
      accessControl,
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

    const sends = createTelegramOutboundSendMethods((opts) => this.outboundSender.send(opts));
    this.outbound = {
      deliveryMode: 'direct',
      chunker: telegramTextChunker,
      chunkerMode: 'text',
      textChunkLimit: TELEGRAM_OUTBOUND_DEFAULTS.textChunkLimit,
      ...sends,
    };

    this.gateway = createTelegramGatewayAdapter({
      startAccount: (account) => this.startAccount(account),
      stopAccount: (accountId) => this.accountManager.stopRunner(accountId),
    });
    this.streaming = createTelegramStreamingAdapter({ accountManager: this.accountManager });
    this.commands = createTelegramCommandAdapter();
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
      : this.config.listAccountIds(this.cfg);

    for (const accountId of accountIds) {
      const account = this.config.resolveAccount(this.cfg, accountId);
      if (!account.enabled || !account.botToken) continue;
      await this.startAccount(account);
    }
  }

  async stop(accountId?: string): Promise<void> {
    if (!this.config) return;
    const ids = accountId ? [accountId] : this.config.listAccountIds(this.cfg);
    for (const id of ids) {
      await this.accountManager.stopRunner(id);
      log.info({ accountId: id }, 'Telegram account stopped');
    }
  }

  private async startAccount(account: TelegramResolvedAccount): Promise<void> {
    if (this.accountManager.isRunning(account.accountId)) return;
    if (!account.botToken) return;

    this.accountManager.markStarting(account.accountId);

    try {
      const botConfig = account.apiRoot ? { client: { apiRoot: account.apiRoot } } : undefined;
      const bot = new Bot(account.botToken, botConfig);
      const me = await bot.api.getMe();

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
    bot.on('message', async (ctx) => {
      try {
        const text = ctx.message.text ?? ctx.message.caption ?? '';
        const command = text.trim().split(' ')[0].split('@')[0].toLowerCase();

        if (command === '/models') {
          await this.commandHandler.handleModels(ctx);
          return;
        }

        if (command === '/start') {
          await this.commandHandler.handleStart(ctx);
          return;
        }

        if (command === '/cleanup') {
          await this.commandHandler.handleCleanup(ctx);
          return;
        }

        await this.debouncer.enqueue({ ctx, accountId, message: ctx.message });
      } catch (err) {
        log.error({ accountId, err }, 'Message handler error');
      }
    });

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

    const account = this.config.resolveAccount(this.cfg, accountId);

    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const senderId = ctx.from?.id?.toString() ?? '';
    const senderUsername = ctx.from?.username;
    const chatId = ctx.chat?.id?.toString() ?? '';

    const securityCtx: ChannelSecurityContext = {
      accountId,
      chatId,
      senderId,
      senderName: senderUsername,
      isGroup,
    };

    const accessResult = this.security.checkAccess?.(securityCtx, account, this.cfg);

    if (!accessResult?.allowed) {
      log.debug({ accountId, chatId, reason: accessResult?.reason }, 'Access denied');
      return;
    }

    await this.inboundProcessor(ctx, accountId);
  }
}

export const telegramPlugin = new TelegramChannelPlugin();

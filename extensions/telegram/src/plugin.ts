/**
 * Telegram Channel Plugin - Implementation based on ChannelPlugin interface
 *
 * This plugin integrates Telegram with the ChannelPlugin architecture.
 * It reuses components from this package's src tree where possible.
 */

import { isDeepStrictEqual } from 'node:util';

import { Bot, type Context } from 'grammy';

import type { Config } from '@xopcai/xopc/config/index.js';
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
} from '@xopcai/xopc/channels/plugin-types.js';
import { generateSessionKey } from '@xopcai/xopc/chat-commands/session-key.js';
import { submitClarifyChoiceFromChannel } from '@xopcai/xopc/gateway/clarify-runtime.js';

import { createLogger } from '@xopcai/xopc/utils/logger.js';
import { issuePairingChallenge, resolveStandardPairingPath } from '@xopcai/xopc/channels/pairing/index.js';
import { createStandardPairingAdapter } from '@xopcai/xopc/channels/pairing/pairing-store-adapter.js';
import { createTimeoutAbortSignal } from './timeout-abort.js';
import { createInboundDebouncer } from '@xopcai/xopc/infra/debounce.js';
import { getMimeType } from '@xopcai/xopc/channels/media.js';
import { isSTTAvailable } from '@xopcai/xopc/voice/stt/availability.js';
import type { STTConfig } from '@xopcai/xopc/voice/stt/types.js';

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
import type { ChannelCronDeliveryAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';
import { normalizeTelegramDeliveryChatId } from './delivery-chat-id.js';
import { telegramOnboardAdapter } from './adapters/onboard-cli.js';
import { telegramGatewaySetupActions } from './adapters/gateway-setup.js';
import { TelegramConfigSchema } from './config-schema.js';
import { normalizeTelegramApiRoot } from './api-root.js';
import { resolveTelegramBotToken } from './token-resolver.js';
import { formatTelegramStartupError, isTelegramUnauthorizedTokenError } from './startup-errors.js';
import { startTelegramPollingSession } from './polling-session.js';
import { createProxyFetch } from './proxy-fetch.js';
import { runTelegramDoctorChecks } from './doctor.js';
import { telegramReplyTracker } from './reply-params.js';
import { createTelegramInboundCoalescer } from './inbound-coalescer.js';
import { sendTelegramAckReaction, handleTelegramMessageReaction } from './reactions.js';
import { handleTelegramChannelAction, bindTelegramMessageActionAccountManager } from './actions/message-actions.js';
import { registerChannelExecApprovalHandler } from '@xopcai/xopc/channels/exec-approval-runtime.js';
import { createTelegramExecApprovalHandler } from './exec-approval-handler.js';
import { handleTelegramFocusCommand } from './focus-handler.js';
import { resolveTelegramApproval } from './approval-store.js';
import { isTelegramExecApprovalApprover } from './exec-approvals.js';

/** Bound initial `getMe` so a bad `apiRoot` or unreachable API cannot block gateway startup for minutes. */
const TELEGRAM_GETME_TIMEOUT_MS = 20_000;
/** grammY per-request ceiling; must exceed long-poll `getUpdates` (~30s) but avoid multi-minute hangs on bad hosts. */
const TELEGRAM_CLIENT_TIMEOUT_SECONDS = 75;

const log = createLogger('TelegramPlugin');

function contextWithMessage(ctx: Context, message: import('@grammyjs/types').Message): Context {
  if (ctx.message === message) return ctx;

  const clone = Object.create(Object.getPrototypeOf(ctx)) as Context;
  Object.defineProperties(clone, Object.getOwnPropertyDescriptors(ctx));
  Object.defineProperty(clone, 'message', {
    configurable: true,
    enumerable: true,
    value: message,
    writable: true,
  });
  return clone;
}

export type { TelegramResolvedAccount as TelegramAccount } from './channel.js';

export class TelegramChannelPlugin implements ChannelPlugin<TelegramResolvedAccount> {
  readonly id = 'telegram' as const;

  readonly reload: ChannelPluginReloadMeta = {
    configPrefixes: ['channels.telegram'],
  };

  readonly meta = {
    id: 'telegram',
    label: 'Telegram',
    selectionLabel: 'Telegram Bot',
    docsPath: '/channels/telegram',
    blurb: 'Telegram Bot API channel',
    order: 0,
    deferConnectUntilAfterListen: true,
  } as const;

  readonly capabilities = {
    chatTypes: ['direct', 'group', 'channel', 'thread'] as Array<'direct' | 'group' | 'channel' | 'thread'>,
    reactions: true,
    threads: true,
    media: true,
    polls: false,
    nativeCommands: true,
    blockStreaming: true,
  } as const;

  readonly defaults: ChannelPluginDefaults = {
    queue: { debounceMs: TELEGRAM_CHANNEL_DEFAULTS.queue.debounceMs },
    outbound: { textChunkLimit: TELEGRAM_CHANNEL_DEFAULTS.outbound.textChunkLimit },
  };

  readonly setupWizard = createTelegramSetupWizard();

  readonly configSchema = {
    schema: {},
    validate: (raw: unknown) => {
      const r = TelegramConfigSchema.safeParse(raw);
      return r.success ? { ok: true as const } : { ok: false as const, errors: [r.error.message] };
    },
  };

  readonly cronDelivery: ChannelCronDeliveryAdapter = {
    async normalizeDeliveryTarget(to) {
      return { chatId: normalizeTelegramDeliveryChatId(to) };
    },
  };

  readonly onboard = telegramOnboardAdapter;

  readonly runtimeActions = telegramGatewaySetupActions;

  readonly doctor = {
    check: (params: { cfg: Config }) => runTelegramDoctorChecks(params),
  };

  readonly pairing = createStandardPairingAdapter('telegram');

  private bus!: NonNullable<ChannelPluginInitOptions['bus']>;
  private cfg!: NonNullable<ChannelPluginInitOptions['config']>;
  private debouncer!: ReturnType<typeof createInboundDebouncer<TelegramMessageEvent>>;

  private accountManager!: TelegramAccountManager;
  private outboundSender!: ReturnType<typeof createOutboundSender>;
  private commandHandler!: ReturnType<typeof createTelegramCommandHandler>;
  private inboundProcessor!: ReturnType<typeof createInboundProcessor>;
  private sessionModelHooks?: ChannelPluginSessionModelHooks;
  /** Unregister fn for the workflow-progress capability registered against the global broker. */
  private workflowProgressUnregister: (() => void) | null = null;
  private inboundCoalescer = createTelegramInboundCoalescer();
  private execApprovalUnregister: (() => void) | null = null;

  readonly actions = {
    handleAction: handleTelegramChannelAction,
  };

  config!: import('@xopcai/xopc/channels/plugin-types.js').ChannelConfigAdapter<TelegramResolvedAccount>;
  security!: import('@xopcai/xopc/channels/plugin-types.js').ChannelSecurityAdapter<TelegramResolvedAccount>;
  status!: import('@xopcai/xopc/channels/plugin-types.js').ChannelStatusAdapter<TelegramResolvedAccount>;

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
    bindTelegramMessageActionAccountManager(this.accountManager);
    this.execApprovalUnregister?.();
    this.execApprovalUnregister = registerChannelExecApprovalHandler(
      'telegram',
      createTelegramExecApprovalHandler({
        accountManager: this.accountManager,
        getConfig: () => this.cfg,
      }),
    );

    await this.registerWorkflowProgressCapability();

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

    log.debug('Telegram plugin initialized');
  }

  private async registerWorkflowProgressCapability(): Promise<void> {
    // Lazy-load workflow progress so channel runtime startup does not pull the
    // whole workflow/agent/provider graph into Electron's dynamic extension path.
    const [{ getWorkflowProgressBroker }, { createTelegramWorkflowProgressCapability }] = await Promise.all([
      import('@xopcai/xopc/agent/workflow/progress-broker.js'),
      import('./workflow-progress.js'),
    ]);
    this.workflowProgressUnregister = getWorkflowProgressBroker().registerChannel(
      createTelegramWorkflowProgressCapability(this.accountManager),
    );
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
          // Lazy-load STT providers only when voice transcription is actually used.
          const { transcribe } = await import('@xopcai/xopc/voice/stt/transcribe-core.js');
          const result = await transcribe(buffer, config as STTConfig, options);
          return { text: result.text };
        },
        isSTTAvailable: (config) => isSTTAvailable(config as STTConfig | undefined),
      },
      mediaUtils: { getMimeType },
    });

    const sends = createTelegramOutboundSendMethods(
      (opts) => this.outboundSender.send(opts),
      this.accountManager,
    );
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
    const prevTg = this.cfg.channels?.telegram as unknown;
    const nextTg = cfg.channels?.telegram as { enabled?: boolean } | undefined;
    // Match Weixin: only `enabled === true` keeps inbound (polling). Stops immediately on disable / missing section.
    const channelOff = !nextTg || nextTg.enabled !== true;
    if (channelOff) {
      this.cfg = cfg;
      await this.stop();
      this.accountManager.reset();
      this.bindOutboundComponents();
      return;
    }

    if (isDeepStrictEqual(prevTg, nextTg)) {
      this.cfg = cfg;
      this.bindOutboundComponents();
      // Config unchanged but runners may be stopped (e.g. disable → enable with identical JSON shape after normalize).
      if (!this.channelIsRunning(cfg)) {
        await this.reapplyFromConfig(cfg);
      }
      return;
    }
    await this.reapplyFromConfig(cfg);
  }

  private async reapplyFromConfig(cfg: Config): Promise<void> {
    this.cfg = cfg;
    await this.stop();
    this.accountManager.reset();
    const telegramCfg = cfg.channels?.telegram as Record<string, unknown> | undefined;
    const channelOn = telegramCfg != null && telegramCfg.enabled === true;
    if (!channelOn) {
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
    if (telegramCfg.enabled !== true) {
      return;
    }

    const accounts = telegramCfg.accounts as Record<string, Record<string, unknown>> | undefined;
    if (!accounts || Object.keys(accounts).length === 0) return;

    const defaults =
      telegramCfg.defaults && typeof telegramCfg.defaults === 'object' && !Array.isArray(telegramCfg.defaults)
        ? telegramCfg.defaults as Record<string, unknown>
        : {};
    const defaultApiRoot =
      typeof defaults.apiRoot === 'string'
        ? normalizeTelegramApiRoot(defaults.apiRoot)
        : undefined;
    const defaultProxy =
      typeof defaults.proxy === 'string' && defaults.proxy.trim()
        ? defaults.proxy.trim()
        : undefined;

    const tokenOwners = new Map<string, string[]>();

    for (const [id, account] of Object.entries(accounts)) {
      const { token, source } = resolveTelegramBotToken({
        botToken: typeof account.botToken === 'string' ? account.botToken : undefined,
        tokenFile: typeof account.tokenFile === 'string' ? account.tokenFile : undefined,
      });
      if (token) {
        const owners = tokenOwners.get(token) ?? [];
        owners.push(id);
        tokenOwners.set(token, owners);
      }

      const accApiRoot =
        typeof account.apiRoot === 'string'
          ? normalizeTelegramApiRoot(account.apiRoot)
          : undefined;
      const accProxy =
        typeof account.proxy === 'string' && account.proxy.trim() ? account.proxy.trim() : undefined;

      this.accountManager.registerAccount({
        ...defaults,
        ...account,
        accountId: id,
        botToken: token,
        tokenFile: typeof account.tokenFile === 'string' ? account.tokenFile : undefined,
        tokenSource: source,
        ...(accApiRoot || defaultApiRoot ? { apiRoot: accApiRoot || defaultApiRoot } : {}),
        ...(accProxy || defaultProxy ? { proxy: accProxy || defaultProxy } : {}),
      } as import('@xopcai/xopc/channels/channel-domain.js').TelegramAccountConfig);
    }

    for (const [token, owners] of tokenOwners) {
      if (owners.length > 1) {
        log.error(
          { accountIds: owners, tokenPreview: `${token.slice(0, 8)}…` },
          `Duplicate Telegram bot token across accounts: ${owners.join(', ')}`,
        );
      }
    }
  }

  channelIsRunning(cfg: Config): boolean {
    return this.accountManager.getAllAccounts().some(
      (a) => a.enabled !== false && !!a.botToken && this.accountManager.isRunning(a.accountId),
    );
  }

  async start(options?: ChannelPluginStartOptions): Promise<void> {
    const section = this.cfg.channels?.telegram as { enabled?: boolean } | undefined;
    if (!section || section.enabled !== true) {
      return;
    }

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
    // Only unregister the broker capability on a full stop (no specific
    // account). A per-account stop still leaves other accounts capable of
    // sending progress through the same registered cap.
    if (!accountId) {
      this.workflowProgressUnregister?.();
      this.workflowProgressUnregister = null;
      this.execApprovalUnregister?.();
      this.execApprovalUnregister = null;
    }
  }

  private async startAccount(account: TelegramResolvedAccount): Promise<void> {
    if (this.accountManager.isRunning(account.accountId)) return;

    const resolved = resolveTelegramBotToken({
      botToken: account.botToken,
      tokenFile: account.tokenFile,
    });
    if (!resolved.token) return;

    const duplicateAccounts = this.accountManager
      .getAllAccounts()
      .filter((a) => {
        const t = resolveTelegramBotToken({
          botToken: a.botToken,
          tokenFile: a.tokenFile,
        }).token;
        return t === resolved.token && a.accountId !== account.accountId;
      })
      .map((a) => a.accountId);
    if (duplicateAccounts.length > 0) {
      const em = `Duplicate bot token shared with account(s): ${duplicateAccounts.join(', ')}`;
      log.error({ accountId: account.accountId, duplicateAccounts }, em);
      this.accountManager.updateStatus({
        accountId: account.accountId,
        running: false,
        mode: 'stopped',
        lastError: em,
      });
      return;
    }

    this.accountManager.markStarting(account.accountId);

    try {
      const client: {
        timeoutSeconds: number;
        apiRoot?: string;
        fetch?: typeof fetch;
      } = {
        timeoutSeconds: TELEGRAM_CLIENT_TIMEOUT_SECONDS,
        ...(account.apiRoot ? { apiRoot: account.apiRoot } : {}),
        ...(account.proxy ? { fetch: createProxyFetch(account.proxy) } : {}),
      };
      const bot = new Bot(resolved.token, { client });
      const getMeSignal = createTimeoutAbortSignal(TELEGRAM_GETME_TIMEOUT_MS);
      let me;
      try {
        me = await bot.api.getMe(getMeSignal.signal);
      } finally {
        getMeSignal.dispose();
      }

      this.accountManager.registerBot(account.accountId, bot);
      this.accountManager.setBotUsername(account.accountId, me.username);
      this.setupMessageHandler(account.accountId, bot);

      const session = startTelegramPollingSession({
        accountId: account.accountId,
        botToken: resolved.token,
        bot,
        stallThresholdMs: account.pollingStallThresholdMs,
        onExit: () => {
          void this.accountManager.stopRunner(account.accountId);
        },
      });
      this.accountManager.registerPollingSession(account.accountId, session);
      this.accountManager.updateStatus({
        accountId: account.accountId,
        running: true,
        mode: 'polling',
      });

      log.info({ accountId: account.accountId, username: me.username }, 'Telegram account started');
    } catch (err) {
      const em = formatTelegramStartupError(err);
      const level = isTelegramUnauthorizedTokenError(err) ? 'error' : 'warn';
      log[level](
        {
          accountId: account.accountId,
          apiRootConfigured: !!account.apiRoot,
          unauthorized: isTelegramUnauthorizedTokenError(err),
          errorMessage: em,
        },
        `Telegram account not started: ${em}`,
      );
      this.accountManager.updateStatus({
        accountId: account.accountId,
        running: false,
        mode: 'stopped',
        lastError: em.slice(0, 400),
      });
    } finally {
      this.accountManager.markStartComplete(account.accountId);
    }
  }

  private attachRunnerExitHandler(_accountId: string, _runner: unknown): void {
    // Polling exit is handled by startTelegramPollingSession.onExit.
  }

  private setupMessageHandler(accountId: string, bot: Bot): void {
    const account = this.config.resolveAccount(this.cfg, accountId);

    const handleInboundMessage = async (ctx: Context) => {
      const text = ctx.message?.text ?? ctx.message?.caption ?? ctx.channelPost?.text ?? ctx.channelPost?.caption ?? '';
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
      if (command === '/focus') {
        await handleTelegramFocusCommand({ ctx, accountId, config: this.cfg });
        return;
      }

      const message = ctx.message ?? ctx.channelPost;
      if (!message) return;

      await this.inboundCoalescer.enqueue({
        ctx,
        accountId,
        message,
        onReady: async (batch) => {
          for (const msg of batch.messages) {
            const batchCtx = batch.ctx;
            await this.debouncer.enqueue({
              ctx: contextWithMessage(batchCtx, msg),
              accountId: batch.accountId,
              message: msg,
            });
          }
        },
      });
    };

    bot.on('message', async (ctx) => {
      try {
        await handleInboundMessage(ctx);
      } catch (err) {
        log.error({ accountId, err }, 'Message handler error');
      }
    });

    bot.on('channel_post', async (ctx) => {
      try {
        await handleInboundMessage(ctx);
      } catch (err) {
        log.error({ accountId, err }, 'Channel post handler error');
      }
    });

    bot.on('message_reaction', async (ctx) => {
      try {
        await handleTelegramMessageReaction({
          ctx,
          accountId,
          bus: this.bus,
          mode: account.reactionNotifications as 'off' | 'own' | 'all' | undefined,
        });
      } catch (err) {
        log.error({ accountId, err }, 'Message reaction handler error');
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

    if (data.startsWith('clarify:')) {
      const rest = data.slice('clarify:'.length);
      const lastColon = rest.lastIndexOf(':');
      if (lastColon > 0) {
        const requestId = rest.slice(0, lastColon);
        const idx = Number.parseInt(rest.slice(lastColon + 1), 10);
        if (requestId && Number.isFinite(idx) && submitClarifyChoiceFromChannel(requestId, idx)) {
          await ctx.answerCallbackQuery();
          return;
        }
      }
      await ctx.answerCallbackQuery('No pending question');
      return;
    }

    if (data.startsWith('approval:approve:') || data.startsWith('approval:deny:')) {
      const approved = data.startsWith('approval:approve:');
      const approvalId = data.slice(approved ? 'approval:approve:'.length : 'approval:deny:'.length);
      const senderId = String(ctx.from?.id ?? '');
      if (
        !isTelegramExecApprovalApprover({
          cfg: this.cfg,
          accountId: _accountId,
          senderId,
        })
      ) {
        await ctx.answerCallbackQuery('Not authorized');
        return;
      }
      if (resolveTelegramApproval(approvalId, approved)) {
        await ctx.answerCallbackQuery(approved ? 'Approved' : 'Denied');
      } else {
        await ctx.answerCallbackQuery('Approval expired or already resolved');
      }
      return;
    }

    await ctx.answerCallbackQuery('Unknown action');
  }

  private async processMessages(items: TelegramMessageEvent[]): Promise<void> {
    if (items.length === 0) return;

    const tgSection = this.cfg.channels?.telegram as { enabled?: boolean } | undefined;
    if (!tgSection || tgSection.enabled !== true) {
      return;
    }

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
    telegramReplyTracker.reset(accountId, chatId);

    const securityCtx: ChannelSecurityContext = {
      accountId,
      chatId,
      senderId,
      senderName: senderUsername,
      isGroup,
    };

    const accessResult = this.security.checkAccess?.(securityCtx, account, this.cfg);

    if (!accessResult?.allowed) {
      if (!isGroup && accessResult?.reason === 'pairing-required') {
        const cid = ctx.chat?.id;
        const bot = cid != null ? this.accountManager.getBot(accountId) : undefined;
        if (bot && cid != null && senderId) {
          void issuePairingChallenge({
            channel: 'telegram',
            pairingFilePath: resolveStandardPairingPath('telegram', accountId),
            accountId,
            senderId,
            senderIdLine: `Your Telegram user id: ${senderId}`,
            sendPairingReply: async (text) => {
              await bot.api.sendMessage(cid, text);
            },
            onCreated: ({ code }) => {
              log.info({ accountId, senderId, code }, 'Telegram DM pairing code issued');
            },
            onReplyError: (err) => {
              log.warn({ err, accountId, chatId: String(cid) }, 'Telegram pairing reply failed');
            },
          });
        }
        return;
      }
      log.warn(
        {
          accountId,
          chatId,
          senderId,
          isGroup,
          reason: accessResult?.reason,
          dmPolicy: account.dmPolicy,
          groupPolicy: account.groupPolicy,
        },
        'Telegram: message dropped by channel security (check dmPolicy/groupPolicy and allowFrom)',
      );
      return;
    }

    const bot = this.accountManager.getBot(accountId);
    const messageId = ctx.message?.message_id;
    const reactionLevel = (account as { reactionLevel?: string }).reactionLevel ?? 'ack';
    const ackEmoji = (account as { ackReaction?: string }).ackReaction ?? '👀';
    if (
      bot &&
      messageId &&
      reactionLevel !== 'off' &&
      ctx.chat?.id != null &&
      !ctx.channelPost
    ) {
      void sendTelegramAckReaction({
        bot,
        chatId: ctx.chat.id,
        messageId,
        emoji: ackEmoji,
      });
    }

    await this.inboundProcessor(ctx, accountId);
  }
}

export const telegramPlugin = new TelegramChannelPlugin();

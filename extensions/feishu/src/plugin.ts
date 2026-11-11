/**
 * Feishu/Lark channel plugin (Socket Mode first).
 *
 * This is intentionally decomposed into small modules so we can grow toward
 * openclaw `extensions/feishu` parity without turning `plugin.ts` into a monolith.
 */

import { isDeepStrictEqual } from 'node:util';

import './pairing-config-resolver.js';

import type { Config } from '@xopcai/xopc/config/schema.js';
import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import type {
  ChannelCapabilities,
  ChannelDoctorAdapter,
  ChannelMessageActionAdapter,
  ChannelOutboundAdapter,
  ChannelPlugin,
  ChannelPluginDefaults,
  ChannelPluginInitOptions,
  ChannelPluginReloadMeta,
  ChannelPluginStartOptions,
  ChannelSecurityAdapter,
  ChannelSecurityContext,
  ChannelStatusAdapter,
  ChatType,
} from '@xopcai/xopc/channels/plugin-types.js';
import type {
  ChannelCliLoginAdapter,
  ChannelRuntimeActionAdapter,
  ChannelOnboardAdapter,
} from '@xopcai/xopc/channels/plugins/types.adapters.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import { evaluateAccess, resolveDmPolicy, resolveGroupPolicy } from '@xopcai/xopc/channels/security.js';
import { createStandardPairingAdapter } from '@xopcai/xopc/channels/pairing/pairing-store-adapter.js';

import { FeishuConfigSchema, type FeishuConfig } from './schema/config-schema.js';
import { listFeishuAccountIds, resolveFeishuAccount, type ResolvedFeishuAccount } from './state/accounts.js';
import { createFeishuOutboundAdapter } from './outbound/outbound-adapter.js';
import { createFeishuStatusAdapter } from './status/status-adapter.js';
import { createFeishuDoctorAdapter } from './status/doctor.js';
import { feishuConfigSurface } from './ui/config-surface.js';
import { createFeishuStreamingAdapter } from './streaming/streaming-adapter.js';
import { readFrameworkAllowFromList } from './auth/pairing.js';
import { feishuGatewaySetupActions } from './adapters/gateway-setup.js';
import { handleFeishuChannelMessageAction } from './actions/message-action-handler.js';
import { feishuInboundScope } from './transport/reliability/message-ingress.js';
import { createFeishuInboundPipeline, type FeishuInboundWork } from './transport/reliability/inbound-pipeline.js';

const log = createLogger('FeishuPlugin');

export class FeishuChannelPlugin implements ChannelPlugin<ResolvedFeishuAccount> {
  readonly id = 'feishu' as const;

  readonly reload: ChannelPluginReloadMeta = {
    configPrefixes: ['channels.feishu'],
  };

  readonly meta = {
    id: 'feishu',
    label: 'Feishu',
    selectionLabel: 'Feishu/Lark (飞书)',
    docsPath: '/channels/feishu',
    blurb: 'Feishu/Lark enterprise messaging (Socket Mode).',
    order: 4,
    deferConnectUntilAfterListen: true,
  } as const;

  readonly capabilities: ChannelCapabilities = {
    chatTypes: ['direct', 'channel'] as ChatType[],
    reactions: true,
    threads: true,
    media: true,
    polls: false,
    nativeCommands: false,
    blockStreaming: false,
    edit: true,
    reply: true,
  } as any;

  readonly defaults: ChannelPluginDefaults = {
    queue: { debounceMs: 350 },
    outbound: { textChunkLimit: 4000 },
    streaming: {
      blockStreamingCoalesce: {
        minChars: 200,
        idleMs: 2500,
      },
    },
  };

  readonly configSchema = {
    schema: {},
    validate: (raw: unknown) => {
      const r = FeishuConfigSchema.safeParse(raw);
      return r.success ? { ok: true as const } : { ok: false as const, errors: [r.error.message] };
    },
  };

  readonly configSurface = feishuConfigSurface;

  readonly pairing = createStandardPairingAdapter('feishu');

  onboard: ChannelOnboardAdapter = {
    isConfigured: config => {
      const account = resolveFeishuAccount(config);
      return account.enabled && account.configured;
    },
    configure: async (config) => {
      const { feishuOnboardAdapter } = await import('./adapters/onboard-cli.js');
      return feishuOnboardAdapter.configure(config);
    },
  };

  readonly cliLogin: ChannelCliLoginAdapter = {
    runLogin: async (params) => {
      const { feishuCliLoginAdapter } = await import('./adapters/cli-login.js');
      return feishuCliLoginAdapter.runLogin(params);
    },
  };

  readonly runtimeActions: ChannelRuntimeActionAdapter = feishuGatewaySetupActions;

  private bus!: MessageBus;
  private cfg!: Config;
  private abortControllers = new Map<string, AbortController>();
  private monitorTasks = new Map<string, Promise<void>>();
  private transportStates = new Map<string, 'connecting' | 'online' | 'error'>();
  private inboundPipeline?: ReturnType<typeof createFeishuInboundPipeline>;

  config = {
    listAccountIds: (cfg: Config) => listFeishuAccountIds(cfg),
    resolveAccount: (cfg: Config, accountId?: string | null) => resolveFeishuAccount(cfg, accountId),
    isConfigured: async (account: ResolvedFeishuAccount) => account.configured,
    describeAccount: (account: ResolvedFeishuAccount) => ({
      accountId: account.accountId,
      channelId: 'feishu',
      enabled: account.enabled,
      configured: account.configured,
      status: account.configured ? this.transportStates.get(account.accountId) : 'unconfigured',
    }),
  };

  security: ChannelSecurityAdapter<ResolvedFeishuAccount> = {
    resolveDmPolicy: ({ account }: { account: ResolvedFeishuAccount }) =>
      resolveDmPolicy(account.dmPolicy, 'open'),
    resolveGroupPolicy: ({ account }: { account: ResolvedFeishuAccount }) =>
      resolveGroupPolicy(account.groupPolicy, 'allowlist'),
    checkAccess: (ctx: ChannelSecurityContext, account: ResolvedFeishuAccount, _cfg: Config) => {
      const isDm = !ctx.isGroup;
      const frameworkAllowFrom = readFrameworkAllowFromList(account.accountId);
      const baseAllowFrom = isDm ? account.allowFrom : account.groupAllowFrom ?? account.allowFrom;
      const allowFrom = [...(baseAllowFrom ?? []), ...frameworkAllowFrom];
      if (isDm) {
        return evaluateAccess({
          context: {
            channel: 'feishu',
            accountId: account.accountId,
            chatId: ctx.chatId,
            senderId: ctx.senderId,
            senderName: ctx.senderName,
            isGroup: false,
            isDm: true,
          },
          dmPolicy: account.dmPolicy,
          allowFrom,
        });
      }
      return evaluateAccess({
        context: {
          channel: 'feishu',
          accountId: account.accountId,
          chatId: ctx.chatId,
          senderId: ctx.senderId,
          senderName: ctx.senderName,
          isGroup: true,
          isDm: false,
        },
        groupPolicy: account.groupPolicy,
        allowFrom,
      });
    },
  };

  outbound: ChannelOutboundAdapter = createFeishuOutboundAdapter();

  streaming = createFeishuStreamingAdapter(() => this.cfg);

  status: ChannelStatusAdapter<ResolvedFeishuAccount> = createFeishuStatusAdapter(accountId => this.transportStates.get(accountId));

  doctor: ChannelDoctorAdapter = createFeishuDoctorAdapter();

  directory = {
    resolveDisplayName: async (params) => {
      const { createFeishuDirectoryAdapter } = await import('./directory/directory-adapter.js');
      return createFeishuDirectoryAdapter().resolveDisplayName?.(params);
    },
  };

  actions: ChannelMessageActionAdapter = {
    handleAction: handleFeishuChannelMessageAction,
  };

  agentTools = [
    {
      name: 'feishu_read',
      description: 'Read a Feishu message by messageId (debug/utility).',
      execute: async (toolCtx, args) => {
        const messageId = typeof (args as any)?.messageId === 'string' ? (args as any).messageId : toolCtx.messageId;
        if (!messageId) throw new Error('feishu_read requires messageId');
        const { getMessageFeishu } = await import('./outbound/actions.js');
        return await getMessageFeishu({ cfg: this.cfg, accountId: toolCtx.accountId, messageId });
      },
    },
    {
      name: 'feishu_edit',
      description: 'Edit a Feishu message by messageId.',
      execute: async (toolCtx, args) => {
        const messageId = typeof (args as any)?.messageId === 'string' ? (args as any).messageId : toolCtx.messageId;
        const text = typeof (args as any)?.text === 'string' ? (args as any).text : '';
        if (!messageId) throw new Error('feishu_edit requires messageId');
        if (!text.trim()) throw new Error('feishu_edit requires text');
        const { editMessageFeishu } = await import('./outbound/actions.js');
        return await editMessageFeishu({ cfg: this.cfg, accountId: toolCtx.accountId, messageId, text });
      },
    },
    {
      name: 'feishu_scopes_probe',
      description: 'Probe Feishu credentials/scopes (placeholder for full docs/wiki/drive tools).',
      execute: async (toolCtx) => {
        const { feishuWhoAmI } = await import('./tools/tools.js');
        return await feishuWhoAmI({ cfg: this.cfg, accountId: toolCtx.accountId });
      },
    },
    {
      name: 'feishu_react',
      description: 'Add/remove/list reactions for a message.',
      execute: async (toolCtx, args) => {
        const a = args as any;
        const messageId = typeof a?.messageId === 'string' ? a.messageId : toolCtx.messageId;
        if (!messageId) throw new Error('feishu_react requires messageId');

        const account = resolveFeishuAccount(this.cfg, toolCtx.accountId ?? 'default');
        const enabled = (account.actions as any)?.reactions !== false;
        if (!enabled) {
          throw new Error('Feishu reactions are disabled via channels.feishu.actions.reactions');
        }

        if (a?.list === true) {
          const { listReactionsFeishu } = await import('./outbound/actions.js');
          return await listReactionsFeishu({
            cfg: this.cfg,
            accountId: toolCtx.accountId,
            messageId,
            emojiType: typeof a?.emojiType === 'string' ? a.emojiType : undefined,
          });
        }

        if (a?.remove === true) {
          const reactionId = typeof a?.reactionId === 'string' ? a.reactionId : '';
          if (!reactionId) throw new Error('feishu_react remove requires reactionId');
          const { removeReactionFeishu } = await import('./outbound/actions.js');
          return await removeReactionFeishu({ cfg: this.cfg, accountId: toolCtx.accountId, messageId, reactionId });
        }

        const emojiType = typeof a?.emojiType === 'string' ? a.emojiType : '';
        if (!emojiType) throw new Error('feishu_react requires emojiType');
        const { addReactionFeishu } = await import('./outbound/actions.js');
        return await addReactionFeishu({ cfg: this.cfg, accountId: toolCtx.accountId, messageId, emojiType });
      },
    },
    {
      name: 'feishu_pins',
      description: 'Pin/unpin/list pins for a chat.',
      execute: async (toolCtx, args) => {
        const a = args as any;
        const action = typeof a?.action === 'string' ? a.action : '';
        if (action === 'list') {
          const chatId = typeof a?.chatId === 'string' ? a.chatId : toolCtx.chatId;
          if (!chatId) throw new Error('feishu_pins list requires chatId');
          const { listPinsFeishu } = await import('./outbound/actions.js');
          return await listPinsFeishu({
            cfg: this.cfg,
            accountId: toolCtx.accountId,
            chatId,
            startTime: typeof a?.startTime === 'string' ? a.startTime : undefined,
            endTime: typeof a?.endTime === 'string' ? a.endTime : undefined,
            pageSize: typeof a?.pageSize === 'number' ? a.pageSize : undefined,
            pageToken: typeof a?.pageToken === 'string' ? a.pageToken : undefined,
          });
        }
        const messageId = typeof a?.messageId === 'string' ? a.messageId : toolCtx.messageId;
        if (!messageId) throw new Error('feishu_pins requires messageId');
        if (action === 'pin') {
          const { pinMessageFeishu } = await import('./outbound/actions.js');
          return await pinMessageFeishu({ cfg: this.cfg, accountId: toolCtx.accountId, messageId });
        }
        if (action === 'unpin') {
          const { unpinMessageFeishu } = await import('./outbound/actions.js');
          return await unpinMessageFeishu({ cfg: this.cfg, accountId: toolCtx.accountId, messageId });
        }
        throw new Error('feishu_pins requires action: pin | unpin | list');
      },
    },
  ];

  async init(options: ChannelPluginInitOptions): Promise<void> {
    this.bus = options.bus;
    this.cfg = options.config;
    const defaultDebounce = this.defaults.queue?.debounceMs ?? 350;
    this.inboundPipeline = createFeishuInboundPipeline({
      bus: this.bus,
      defaultDebounceMs: defaultDebounce,
      onError: (err, items) => {
        log.error({ err, count: items.length }, 'Feishu inbound pipeline flush failed');
      },
    });


    log.debug('Feishu plugin initialized');
  }

  async start(options?: ChannelPluginStartOptions): Promise<void> {
    const section = this.cfg.channels?.feishu as FeishuConfig | undefined;
    if (!section || section.enabled !== true) {
      return;
    }

    const ids = options?.accountId ? [options.accountId] : listFeishuAccountIds(this.cfg);
    for (const accountId of ids) {
      const account = resolveFeishuAccount(this.cfg, accountId);
      if (!account.enabled || !account.configured) continue;
      if (this.abortControllers.has(accountId)) continue;

      const ac = new AbortController();
      this.abortControllers.set(accountId, ac);

      const defaultDebounce = this.defaults.queue?.debounceMs ?? 350;
      const enqueueInbound = (work: FeishuInboundWork) => {
        const p = this.inboundPipeline;
        if (!p) {
          return this.bus.publishInbound(work.inbound, work.delivery);
        }
        return p.enqueue(work);
      };

      const monitorDeps = {
        account,
        config: this.cfg,
        enqueueInbound,
        inboundDebounceDefaultMs: defaultDebounce,
        abortSignal: ac.signal,
        onState: (state: 'connecting' | 'online' | 'error') => { if (!ac.signal.aborted) this.transportStates.set(accountId, state); },
        security: {
          checkAccess: (ctx: ChannelSecurityContext) => this.security.checkAccess?.(ctx, account, this.cfg),
        },
      };
      try {
        this.bus.restoreDurableInbound?.(this.id, feishuInboundScope(account));
        const runner = account.connectionMode === 'webhook'
          ? (await import('./transport/webhook/monitor.js')).createFeishuWebhookMonitor(monitorDeps)
          : (await import('./transport/socket-mode/monitor.js')).createFeishuSocketModeMonitor(monitorDeps);

        const task = runner.run().catch((err) => {
          if (ac.signal.aborted) return;
          this.transportStates.set(accountId, 'error');
          log.error({ err, accountId }, 'Feishu monitor exited with error');
        }).finally(() => {
          if (this.abortControllers.get(accountId) !== ac) return;
          this.abortControllers.delete(accountId);
          this.monitorTasks.delete(accountId);
          if (ac.signal.aborted) this.transportStates.delete(accountId);
        });
        this.monitorTasks.set(accountId, task);
        log.info({ accountId, mode: account.connectionMode }, 'Feishu monitor started');
      } catch (err) {
        this.abortControllers.delete(accountId);
        throw err;
      }
    }
  }

  async stop(accountId?: string): Promise<void> {
    try {
      await this.inboundPipeline?.flushAll();
    } catch (err) {
      log.warn({ err }, 'Feishu inbound pipeline flushAll failed');
    }
    const ids = accountId ? [accountId] : [...this.abortControllers.keys()];
    for (const id of ids) {
      const ac = this.abortControllers.get(id);
      if (ac) {
        ac.abort();
        await this.monitorTasks.get(id);
      }
    }
    // Only unregister the broker capability on a full stop. Per-account stops
    // still leave other accounts capable of delivering progress through the
    // same registered cap.
    if (!accountId) {
    }
  }

  channelIsRunning(cfg: Config): boolean {
    const ids = listFeishuAccountIds(cfg);
    return ids.some((id) => {
      const a = resolveFeishuAccount(cfg, id);
      return a.enabled !== false && a.configured && this.transportStates.get(id) === 'online';
    });
  }

  async onConfigUpdated(cfg: Config): Promise<void> {
    const prev = this.cfg.channels?.feishu as unknown;
    const next = cfg.channels?.feishu as { enabled?: boolean } | undefined;
    const channelOff = !next || next.enabled !== true;

    if (channelOff) {
      this.cfg = cfg;
      await this.stop();
      return;
    }

    this.cfg = cfg;

    if (isDeepStrictEqual(prev, next) && this.channelIsRunning(cfg)) {
      return;
    }

    await this.stop();
    await this.start();
  }
}

export const feishuPlugin = new FeishuChannelPlugin();

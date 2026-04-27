/**
 * Feishu/Lark channel plugin (Socket Mode first).
 *
 * This is intentionally decomposed into small modules so we can grow toward
 * openclaw `extensions/feishu` parity without turning `plugin.ts` into a monolith.
 */

import { isDeepStrictEqual } from 'node:util';

import type { Config } from '@xopcai/xopc/config/schema.js';
import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import type {
  ChannelCapabilities,
  ChannelDoctorAdapter,
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
import type { ChannelCliLoginAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import { evaluateAccess, resolveDmPolicy, resolveGroupPolicy } from '@xopcai/xopc/channels/security.js';

import { FeishuConfigSchema, type FeishuConfig } from './schema/config-schema.js';
import { listFeishuAccountIds, resolveFeishuAccount, type ResolvedFeishuAccount } from './state/accounts.js';
import { createFeishuSocketModeMonitor } from './transport/socket-mode/monitor.js';
import { createFeishuWebhookMonitor } from './transport/webhook/monitor.js';
import { createFeishuOutboundAdapter } from './outbound/outbound-adapter.js';
import { createFeishuStatusAdapter } from './status/status-adapter.js';
import { createFeishuDoctorAdapter } from './status/doctor.js';
import { feishuConfigSurface } from './ui/config-surface.js';
import { createFeishuStreamingAdapter } from './streaming/streaming-adapter.js';
import { readFrameworkAllowFromList } from './auth/pairing.js';
import {
  addReactionFeishu,
  editMessageFeishu,
  getMessageFeishu,
  listPinsFeishu,
  listReactionsFeishu,
  pinMessageFeishu,
  removeReactionFeishu,
  unpinMessageFeishu,
} from './outbound/actions.js';
import { createFeishuDirectoryAdapter } from './directory/directory-adapter.js';
import { feishuWhoAmI } from './tools/tools.js';
import { feishuCliLoginAdapter } from './adapters/cli-login.js';
import { feishuOnboardAdapter } from './adapters/onboard-cli.js';

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
    queue: { debounceMs: 0 },
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

  onboard = feishuOnboardAdapter;

  readonly cliLogin: ChannelCliLoginAdapter = feishuCliLoginAdapter;

  private bus!: MessageBus;
  private cfg!: Config;
  private abortControllers = new Map<string, AbortController>();

  config = {
    listAccountIds: (cfg: Config) => listFeishuAccountIds(cfg),
    resolveAccount: (cfg: Config, accountId?: string | null) => resolveFeishuAccount(cfg, accountId),
    isConfigured: async (account: ResolvedFeishuAccount) => account.configured,
    describeAccount: (account: ResolvedFeishuAccount) => ({
      accountId: account.accountId,
      channelId: 'feishu',
      enabled: account.enabled,
      configured: account.configured,
      status: account.configured ? undefined : 'unconfigured',
    }),
  };

  security: ChannelSecurityAdapter<ResolvedFeishuAccount> = {
    resolveDmPolicy: ({ account }: { account: ResolvedFeishuAccount }) =>
      resolveDmPolicy(account.dmPolicy, 'pairing'),
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

  status: ChannelStatusAdapter<ResolvedFeishuAccount> = createFeishuStatusAdapter();

  doctor: ChannelDoctorAdapter = createFeishuDoctorAdapter();

  directory = createFeishuDirectoryAdapter();

  actions = {
    async handleAction(_ctx: any): Promise<void> {
      // TODO: Wire interactive card actions (card.action.trigger) to this adapter.
    },
  };

  agentTools = [
    {
      name: 'feishu_read',
      description: 'Read a Feishu message by messageId (debug/utility).',
      execute: async (toolCtx, args) => {
        const messageId = typeof (args as any)?.messageId === 'string' ? (args as any).messageId : toolCtx.messageId;
        if (!messageId) throw new Error('feishu_read requires messageId');
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
        return await editMessageFeishu({ cfg: this.cfg, accountId: toolCtx.accountId, messageId, text });
      },
    },
    {
      name: 'feishu_scopes_probe',
      description: 'Probe Feishu credentials/scopes (placeholder for full docs/wiki/drive tools).',
      execute: async (toolCtx) => {
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
          return await removeReactionFeishu({ cfg: this.cfg, accountId: toolCtx.accountId, messageId, reactionId });
        }

        const emojiType = typeof a?.emojiType === 'string' ? a.emojiType : '';
        if (!emojiType) throw new Error('feishu_react requires emojiType');
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
          return await pinMessageFeishu({ cfg: this.cfg, accountId: toolCtx.accountId, messageId });
        }
        if (action === 'unpin') {
          return await unpinMessageFeishu({ cfg: this.cfg, accountId: toolCtx.accountId, messageId });
        }
        throw new Error('feishu_pins requires action: pin | unpin | list');
      },
    },
  ];

  async init(options: ChannelPluginInitOptions): Promise<void> {
    this.bus = options.bus;
    this.cfg = options.config;
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

      const monitor = createFeishuSocketModeMonitor({
        account,
        config: this.cfg,
        bus: this.bus,
        abortSignal: ac.signal,
        security: {
          checkAccess: (ctx: ChannelSecurityContext) => this.security.checkAccess?.(ctx, account, this.cfg),
        },
      });

      const runner =
        account.connectionMode === 'webhook'
          ? createFeishuWebhookMonitor({
              account,
              config: this.cfg,
              bus: this.bus,
              abortSignal: ac.signal,
              security: {
                checkAccess: (ctx: ChannelSecurityContext) =>
                  this.security.checkAccess?.(ctx, account, this.cfg),
              },
            })
          : monitor;

      void runner.run().catch((err) => {
        if ((err as { name?: string } | undefined)?.name === 'AbortError') {
          log.debug({ accountId }, 'Feishu monitor stopped');
          return;
        }
        log.error({ err, accountId }, 'Feishu monitor exited with error');
      });

      log.info({ accountId, mode: account.connectionMode }, 'Feishu monitor started');
    }
  }

  async stop(accountId?: string): Promise<void> {
    const ids = accountId ? [accountId] : [...this.abortControllers.keys()];
    for (const id of ids) {
      const ac = this.abortControllers.get(id);
      if (ac) {
        ac.abort();
        this.abortControllers.delete(id);
      }
    }
  }

  channelIsRunning(cfg: Config): boolean {
    const ids = listFeishuAccountIds(cfg);
    return ids.some((id) => {
      const a = resolveFeishuAccount(cfg, id);
      return a.enabled !== false && a.configured && this.abortControllers.has(id);
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


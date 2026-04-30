/**
 * Weixin (WeChat ilink) channel — long-poll getUpdates, QR login, direct messages only.
 */

import { isDeepStrictEqual } from 'node:util';

import type { Config } from '@xopcai/xopc/config/schema.js';
import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import type {
  ChannelCapabilities,
  ChannelPlugin,
  ChannelPluginDefaults,
  ChannelPluginInitOptions,
  ChannelPluginReloadMeta,
  ChannelPluginStartOptions,
  ChannelSecurityContext,
  ChannelStreamingAdapter,
  ChatType,
} from '@xopcai/xopc/channels/plugin-types.js';
import { evaluateAccess, resolveDmPolicy } from '@xopcai/xopc/channels/security.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import { restoreContextTokens } from './messaging/inbound.js';
import { monitorWeixinProvider } from './monitor/monitor.js';
import type { ChannelCliLoginAdapter, ChannelCronDeliveryAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';
import {
  listWeixinAccountIds,
  resolveWeixinAccount,
  type ResolvedWeixinAccount,
} from './auth/accounts.js';
import { readFrameworkAllowFromList } from './auth/pairing.js';
import { createWeixinOutboundHandlers, weixinTextChunker } from './outbound-send.js';
import { normalizeWeixinCronDeliveryToResolved } from './delivery-to.js';
import { weixinConfigSurface } from './config-surface.js';
import { WeixinConfigSchema } from './config-schema.js';
import { weixinOnboardAdapter } from './adapters/onboard-cli.js';

const log = createLogger('WeixinPlugin');

export class WeixinChannelPlugin implements ChannelPlugin<ResolvedWeixinAccount> {
  readonly id = 'weixin' as const;

  readonly reload: ChannelPluginReloadMeta = {
    configPrefixes: ['channels.weixin'],
  };

  readonly meta = {
    id: 'weixin',
    label: 'Weixin',
    selectionLabel: 'Weixin (ilink)',
    docsPath: '/channels/weixin',
    blurb: 'WeChat via Tencent ilink bot API (QR login, direct chat).',
    order: 3,
  } as const;

  readonly capabilities: ChannelCapabilities = {
    chatTypes: ['direct'] as ChatType[],
    reactions: false,
    threads: false,
    media: true,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  };

  readonly configSchema = {
    schema: {},
    validate: (raw: unknown) => {
      const r = WeixinConfigSchema.safeParse(raw);
      return r.success ? { ok: true as const } : { ok: false as const, errors: [r.error.message] };
    },
  };

  readonly cronDelivery: ChannelCronDeliveryAdapter = {
    async normalizeDeliveryTarget(to, sessionStore) {
      const { chatId, accountId } = await normalizeWeixinCronDeliveryToResolved(to, sessionStore);
      return { chatId, accountId };
    },
  };

  readonly onboard = weixinOnboardAdapter;

  readonly cliLogin: ChannelCliLoginAdapter = {
    async runLogin(params) {
      const { runWeixinQrLoginCli } = await import('./cli/qr-login.js');
      return runWeixinQrLoginCli({
        configPath: params.configPath,
        verbose: params.verbose,
        timeoutMs: params.timeoutMs,
        account: params.accountId,
        writeConfig: params.writeConfig,
      });
    },
  };

  readonly configSurface = weixinConfigSurface;

  readonly defaults: ChannelPluginDefaults = {
    queue: { debounceMs: 0 },
    outbound: { textChunkLimit: 4000 },
    streaming: {
      blockStreamingCoalesce: {
        minChars: 200,
        idleMs: 3000,
      },
    },
  };

  private bus!: ChannelPluginInitOptions['bus'];
  private cfg!: Config;
  private abortControllers = new Map<string, AbortController>();

  config = {
    listAccountIds: (cfg: Config) => listWeixinAccountIds(cfg),
    resolveAccount: (cfg: Config, accountId?: string | null) => resolveWeixinAccount(cfg, accountId),
    isConfigured: async (account: ResolvedWeixinAccount) => account.configured,
    describeAccount: (account: ResolvedWeixinAccount, _cfg: Config) => ({
      accountId: account.accountId,
      channelId: 'weixin',
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      status: undefined,
    }),
  };

  security = {
    resolveDmPolicy: ({ account }: { account: ResolvedWeixinAccount }) =>
      resolveDmPolicy(account.dmPolicy, 'pairing'),
    checkAccess: (ctx: ChannelSecurityContext, account: ResolvedWeixinAccount, _cfg: Config) => {
      const allowFrom = [...(account.allowFrom ?? []), ...readFrameworkAllowFromList(account.accountId)];
      return evaluateAccess({
        context: {
          channel: 'weixin',
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
    },
  };

  outbound = {
    deliveryMode: 'direct' as const,
    chunker: weixinTextChunker,
    chunkerMode: 'text' as const,
    textChunkLimit: 4000,
    ...createWeixinOutboundHandlers(),
  };

  streaming: ChannelStreamingAdapter = {
    startStream: () => null,
  };

  /** Channel plugin hints (cron targets, media paths). */
  agentPrompt = {
    augmentSystemPrompt: (): string =>
      [
        'Weixin (ilink): direct chat only. To send an image or file, use the message tool with action send and set media to a local absolute path or an HTTPS URL; relative paths may fail.',
        'For cron or scheduled delivery to a Weixin contact, set delivery.to to the user Weixin id (ending in @im.wechat) and delivery.accountId to the bot account id, or outbound may pick the wrong account.',
        'When using MEDIA: to attach a file, put the MEDIA: line alone on its own line, not inline with other text.',
      ].join('\n'),
  };

  async init(options: ChannelPluginInitOptions): Promise<void> {
    this.bus = options.bus;
    this.cfg = options.config;
    log.debug('Weixin plugin initialized');
  }

  async start(options?: ChannelPluginStartOptions): Promise<void> {
    const ids = options?.accountId
      ? [options.accountId]
      : listWeixinAccountIds(this.cfg);

    for (const accountId of ids) {
      const account = resolveWeixinAccount(this.cfg, accountId);
      if (!account.enabled || !account.configured || !account.token) continue;

      if (this.abortControllers.has(accountId)) continue;

      restoreContextTokens(account.accountId);

      const ac = new AbortController();
      this.abortControllers.set(accountId, ac);

      void monitorWeixinProvider({
        account,
        config: this.cfg,
        bus: this.bus,
        abortSignal: ac.signal,
      }).catch((err) => {
        if ((err as { name?: string; message?: string } | undefined)?.name === 'AbortError') {
          log.debug({ accountId }, 'Weixin monitor stopped');
          return;
        }
        log.error({ err, accountId }, 'Weixin monitor exited with error');
      });

      log.info({ accountId }, 'Weixin monitor started');
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
    return listWeixinAccountIds(cfg).some((id) => {
      const a = resolveWeixinAccount(cfg, id);
      return a.configured && a.enabled !== false && this.abortControllers.has(id);
    });
  }

  async onConfigUpdated(cfg: Config): Promise<void> {
    const prevWx = this.cfg.channels?.weixin as unknown;
    const nextWx = cfg.channels?.weixin as { enabled?: boolean } | undefined;
    const channelOff = !nextWx || nextWx.enabled !== true;

    if (channelOff) {
      this.cfg = cfg;
      await this.stop();
      return;
    }

    this.cfg = cfg;

    if (isDeepStrictEqual(prevWx, nextWx) && this.channelIsRunning(cfg)) {
      return;
    }

    await this.stop();
    await this.start();
  }

  /**
   * Restart long-poll monitors after credentials were written to disk without a `channels.weixin` JSON
   * delta (e.g. only token files / account index updated). Gateway calls this after QR login completes.
   *
   * Pass `bus` explicitly: if Weixin was disabled at gateway boot, `init()` was skipped and `this.bus` was never set.
   */
  async reloadMonitorsWithConfig(cfg: Config, bus: MessageBus): Promise<void> {
    this.bus = bus;
    this.cfg = cfg;
    await this.stop();
    await this.start();
  }
}

export const weixinPlugin = new WeixinChannelPlugin();

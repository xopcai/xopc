/**
 * Weixin (WeChat ilink) channel — long-poll getUpdates, QR login, direct messages only.
 */

import type { Config } from '@xopcai/xopcbot/config/schema.js';
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
} from '@xopcai/xopcbot/channels/plugin-types.js';
import { evaluateAccess, resolveDmPolicy } from '@xopcai/xopcbot/channels/security.js';
import { createLogger } from '@xopcai/xopcbot/utils/logger.js';

import { restoreContextTokens } from './messaging/inbound.js';
import { monitorWeixinProvider } from './monitor/monitor.js';
import {
  listWeixinAccountIds,
  resolveWeixinAccount,
  type ResolvedWeixinAccount,
} from './auth/accounts.js';
import { readFrameworkAllowFromList } from './auth/pairing.js';
import { createWeixinOutboundHandlers, weixinTextChunker } from './outbound-send.js';

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
    order: 5,
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

  async init(options: ChannelPluginInitOptions): Promise<void> {
    this.bus = options.bus;
    this.cfg = options.config;
    log.info('Weixin plugin initialized');
  }

  async start(options?: ChannelPluginStartOptions): Promise<void> {
    const ids = options?.accountId
      ? [options.accountId]
      : listWeixinAccountIds(this.cfg);

    for (const accountId of ids) {
      const account = resolveWeixinAccount(this.cfg, accountId);
      if (!account.enabled || !account.configured || !account.token) continue;

      if (this.abortControllers.has(accountId)) continue;

      restoreContextTokens(accountId);

      const ac = new AbortController();
      this.abortControllers.set(accountId, ac);

      void monitorWeixinProvider({
        account,
        config: this.cfg,
        bus: this.bus,
        abortSignal: ac.signal,
      }).catch((err) => {
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
    this.cfg = cfg;
    await this.stop();
    await this.start();
  }
}

export const weixinPlugin = new WeixinChannelPlugin();

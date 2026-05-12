/**
 * DingTalk channel plugin (Stream / robot inbound).
 * Device registration flow derived from dingtalk-openclaw-connector (MIT).
 */

import { isDeepStrictEqual } from 'node:util';

import type { Config } from '@xopcai/xopc/config/schema.js';
import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import type {
  ChannelCapabilities,
  ChannelDoctorAdapter,
  ChannelPlugin,
  ChannelPluginInitOptions,
  ChannelPluginReloadMeta,
  ChannelPluginStartOptions,
  ChannelSecurityAdapter,
  ChannelSecurityContext,
  ChatType,
} from '@xopcai/xopc/channels/plugin-types.js';
import type { ChannelMeta } from '@xopcai/xopc/channels/plugins/types.core.js';
import type { ChannelCliLoginAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';
import type { ChannelOnboardAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import { readAllowFromIdsSync, resolveStandardAllowFromPath } from '@xopcai/xopc/channels/pairing/index.js';
import { evaluateAccess, resolveDmPolicy, resolveGroupPolicy } from '@xopcai/xopc/channels/security.js';

import { DingtalkConfigSchema, type DingtalkConfig } from './config-schema.js';
import { listDingtalkAccountIds, resolveDingtalkAccount, type ResolvedDingtalkAccount } from './accounts.js';
import { runDingtalkStreamMonitor } from './stream-monitor.js';
import { createDingtalkOutboundAdapter } from './outbound-adapter.js';
import { dingtalkConfigSurface } from './ui/config-surface.js';
import { dingtalkCliLoginAdapter } from './adapters/cli-login.js';
import { dingtalkOnboardAdapter } from './adapters/onboard-cli.js';
import { createDingtalkDoctorAdapter } from './status/doctor.js';

const log = createLogger('DingTalkPlugin');

export class DingtalkChannelPlugin implements ChannelPlugin<ResolvedDingtalkAccount> {
  readonly id = 'dingtalk' as const;

  readonly reload: ChannelPluginReloadMeta = {
    configPrefixes: ['channels.dingtalk'],
  };

  readonly meta: ChannelMeta = {
    id: 'dingtalk',
    label: 'DingTalk',
    selectionLabel: 'DingTalk (钉钉)',
    docsPath: '/channels/dingtalk',
    blurb: 'DingTalk enterprise robot via Stream mode (QR app registration).',
    order: 35,
    aliases: ['dd', 'ding'],
    deferConnectUntilAfterListen: true,
  };

  readonly capabilities: ChannelCapabilities = {
    chatTypes: ['direct', 'group'] as ChatType[],
    reactions: false,
    threads: false,
    media: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  };

  readonly defaults = {
    outbound: { textChunkLimit: 4000 },
    queue: { debounceMs: 0 },
  };

  readonly configSchema = {
    schema: {},
    validate: (raw: unknown) => {
      const r = DingtalkConfigSchema.safeParse(raw);
      return r.success ? { ok: true as const } : { ok: false as const, errors: [r.error.message] };
    },
  };

  readonly configSurface = dingtalkConfigSurface;
  readonly onboard: ChannelOnboardAdapter = dingtalkOnboardAdapter;
  readonly cliLogin: ChannelCliLoginAdapter = dingtalkCliLoginAdapter;
  readonly outbound = createDingtalkOutboundAdapter();
  readonly doctor: ChannelDoctorAdapter = createDingtalkDoctorAdapter();

  private bus!: MessageBus;
  private cfg!: Config;
  private abortControllers = new Map<string, AbortController>();

  config = {
    listAccountIds: (cfg: Config) => listDingtalkAccountIds(cfg),
    resolveAccount: (cfg: Config, accountId?: string | null) => resolveDingtalkAccount(cfg, accountId),
    isConfigured: async (account: ResolvedDingtalkAccount) => account.configured,
    describeAccount: (account: ResolvedDingtalkAccount) => ({
      accountId: account.accountId,
      channelId: 'dingtalk',
      enabled: account.enabled,
      configured: account.configured,
      status: account.configured ? undefined : 'unconfigured',
    }),
    defaultAccountId: (cfg: Config) => listDingtalkAccountIds(cfg)[0] ?? 'default',
  };

  security: ChannelSecurityAdapter<ResolvedDingtalkAccount> = {
    resolveDmPolicy: ({ account }) => resolveDmPolicy(account.dmPolicy, 'open'),
    resolveGroupPolicy: ({ account }) => resolveGroupPolicy(account.groupPolicy, 'open'),
    checkAccess: (ctx: ChannelSecurityContext, account: ResolvedDingtalkAccount, _cfg: Config) => {
      const isDm = !ctx.isGroup;
      const storeAllow = isDm
        ? readAllowFromIdsSync(resolveStandardAllowFromPath('dingtalk', account.accountId))
        : [];
      const baseAllowFrom = isDm ? account.allowFrom : account.groupAllowFrom ?? account.allowFrom;
      const allowFrom = [...(baseAllowFrom ?? []), ...storeAllow];
      if (isDm) {
        return evaluateAccess({
          context: {
            channel: 'dingtalk',
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
          channel: 'dingtalk',
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

  async init(options: ChannelPluginInitOptions): Promise<void> {
    this.bus = options.bus;
    this.cfg = options.config;
    log.debug('DingTalk plugin initialized');
  }

  async start(options?: ChannelPluginStartOptions): Promise<void> {
    const section = this.cfg.channels?.dingtalk as DingtalkConfig | undefined;
    if (!section || section.enabled !== true) {
      return;
    }

    const ids = options?.accountId ? [options.accountId] : listDingtalkAccountIds(this.cfg);
    for (const accountId of ids) {
      const account = resolveDingtalkAccount(this.cfg, accountId);
      if (!account.enabled || !account.configured) continue;
      if (this.abortControllers.has(accountId)) continue;

      const ac = new AbortController();
      this.abortControllers.set(accountId, ac);

      void runDingtalkStreamMonitor({
        account,
        bus: this.bus,
        abortSignal: ac.signal,
        security: {
          checkAccess: (ctx: ChannelSecurityContext) =>
            this.security.checkAccess?.(ctx, account, this.cfg) ?? { allowed: true },
        },
      }).catch((err) => {
        if ((err as { name?: string } | undefined)?.name === 'AbortError') {
          log.debug({ accountId }, 'DingTalk monitor stopped');
          return;
        }
        log.error({ err, accountId }, 'DingTalk monitor exited with error');
      });

      log.info({ accountId }, 'DingTalk Stream monitor started');
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
    const ids = listDingtalkAccountIds(cfg);
    return ids.some((id) => {
      const a = resolveDingtalkAccount(cfg, id);
      return a.enabled && a.configured && this.abortControllers.has(id);
    });
  }

  async onConfigUpdated(cfg: Config): Promise<void> {
    const prev = this.cfg.channels?.dingtalk as unknown;
    const next = cfg.channels?.dingtalk as { enabled?: boolean } | undefined;
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

export const dingtalkPlugin = new DingtalkChannelPlugin();

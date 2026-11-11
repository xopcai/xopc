/**
 * Weixin (WeChat ilink) channel — long-poll getUpdates, QR login, direct messages only.
 */

import { isDeepStrictEqual } from 'node:util';

import './pairing-config-resolver.js';

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
import { createStandardPairingAdapter } from '@xopcai/xopc/channels/pairing/pairing-store-adapter.js';
import { cancelChannelConnectionProbe, getChannelConnectionProbe, startChannelConnectionProbe } from '@xopcai/xopc/channels/connection-probe.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import { restoreContextTokens } from './messaging/inbound.js';
import { monitorWeixinProvider, type WeixinMonitorState } from './monitor/monitor.js';
import type {
  ChannelCliLoginAdapter,
  ChannelCronDeliveryAdapter,
  ChannelRuntimeActionAdapter,
} from '@xopcai/xopc/channels/plugins/types.adapters.js';
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
    deferConnectUntilAfterListen: true,
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

  readonly runtimeActions: ChannelRuntimeActionAdapter = {
    runAction: async ({ cfg, actionId, accountId, input, locale }) => {
      const zh = locale?.toLowerCase().startsWith('zh') === true;
      const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
      const conversationId = typeof raw.conversationId === 'string' ? raw.conversationId : '';
      if (actionId === 'setup.verify.status') {
        return { ok: true, payload: getChannelConnectionProbe(this.id, accountId ?? '', conversationId, zh) };
      }
      if (actionId === 'setup.verify.cancel') {
        cancelChannelConnectionProbe(this.id, accountId ?? '', conversationId);
        return { ok: true, payload: { type: 'ok' } };
      }
      if (actionId === 'login.start') {
        const { startWeixinGatewayQrLogin, cancelWeixinGatewayQrLogin } = await import('./cli/gateway-qr-login.js');
        const start = await startWeixinGatewayQrLogin({
          account: accountId, timeoutMs: 300_000, initialConfig: cfg, deferPersistence: true,
        });
        if (start.ok === false) return { ok: false, message: start.message };
        const key = accountId ?? '';
        const previous = this.setupSessions.get(key);
        if (previous) cancelWeixinGatewayQrLogin(previous.id);
        const session = { id: start.conversationId, section: structuredClone(cfg.channels?.weixin), expiresAt: Date.now() + 300_000 };
        this.setupSessions.set(key, session);
        setTimeout(() => {
          if (this.setupSessions.get(key) === session) {
            cancelWeixinGatewayQrLogin(session.id);
            this.setupSessions.delete(key);
          }
        }, 300_000).unref();
        return {
          ok: true,
          payload: {
            type: 'qr', conversationId: start.conversationId, accountId,
            qrcodeUrl: start.qrcodeUrl, statusAction: 'login.status', cancelAction: 'login.cancel', pollIntervalMs: 2000,
            message: zh ? '请使用微信扫描二维码。' : 'Scan the QR code with WeChat.',
          },
        };
      }

      if (actionId === 'login.status' || actionId === 'login.cancel' || actionId === 'login.verify-code') {
        const key = accountId ?? '';
        const session = this.setupSessions.get(key);
        if (!session || session.id !== conversationId || session.expiresAt <= Date.now()) {
          return { ok: true, payload: { type: 'poll', phase: 'unknown', ok: false, message: zh ? '二维码已过期，请重新连接。' : 'The QR code expired. Connect again.' } };
        }
        const { cancelWeixinGatewayQrLogin, getDeferredWeixinLogin, getWeixinGatewayQrLoginStatus } = await import('./cli/gateway-qr-login.js');
        if (actionId === 'login.cancel') {
          cancelWeixinGatewayQrLogin(conversationId);
          this.setupSessions.delete(key);
          return { ok: true, payload: { type: 'ok' } };
        }
        if (actionId === 'login.verify-code') {
          const { submitWeixinQrVerificationCode } = await import('./auth/login-qr.js');
          const accepted = typeof raw.code === 'string' && submitWeixinQrVerificationCode(conversationId, raw.code.trim());
          if (!accepted) return { ok: false, message: zh ? '请输入微信显示的验证码。' : 'Enter the verification code shown by WeChat.' };
        }
        if (!isDeepStrictEqual(session.section, cfg.channels?.weixin)) {
          cancelWeixinGatewayQrLogin(conversationId);
          this.setupSessions.delete(key);
          return { ok: true, payload: { type: 'poll', phase: 'done', ok: false, message: zh ? '微信设置已变更，请重新连接。' : 'WeChat settings changed. Connect again.' } };
        }
        const status = getWeixinGatewayQrLoginStatus(conversationId);
        if (status.phase === 'polling') {
          const pin = status.qrStatus?.includes('need_verifycode');
          return { ok: true, payload: {
            type: 'poll', phase: 'pending', qrcodeUrl: status.qrcodeUrl, qrStatus: status.qrStatus,
            ...(pin ? { pinAction: 'login.verify-code' } : {}),
            message: pin
              ? (zh ? '输入微信中显示的验证码。' : 'Enter the code shown in WeChat.')
              : (status.qrStatus === 'scaned' || status.qrStatus === 'scaned_but_redirect')
                ? (zh ? '已扫码，请在微信中确认。' : 'Scanned. Confirm in WeChat.')
                : (zh ? '等待微信扫码。' : 'Waiting for WeChat authorization.'),
          } };
        }
        const credentials = getDeferredWeixinLogin(conversationId);
        if (status.phase === 'done' && status.ok && credentials) {
          const { mergeWeixinConfigAfterLogin } = await import('./cli/qr-login.js');
          const nextConfig = mergeWeixinConfigAfterLogin(cfg, credentials.accountId, credentials.ownerId);
          return {
            ok: true,
            nextConfig,
            beforeConfigSaved: () => {
              if (this.setupSessions.get(key) !== session) throw new Error('Weixin setup session is no longer active');
              credentials.persist();
            },
            onConfigSaved: async () => {
              credentials.cleanup();
              cancelWeixinGatewayQrLogin(conversationId);
              this.setupSessions.delete(key);
              const verification = startChannelConnectionProbe({
                channel: this.id, accountId: credentials.accountId, ownerId: credentials.ownerId, zh, configChanged: true,
              });
              // The token may have changed without an account configuration change.
              if (this.abortControllers.has(credentials.accountId)) {
                this.cfg = nextConfig;
                await this.stop(credentials.accountId);
                await this.start({ accountId: credentials.accountId });
              }
              return verification;
            },
          };
        }
        return { ok: true, payload: {
          type: 'poll', phase: 'done', ok: false,
          message: 'message' in status ? status.message : (zh ? '微信授权未完成。' : 'WeChat authorization did not finish.'),
        } };
      }

      return { ok: false, message: `Unsupported Weixin action: ${actionId}` };
    },
  };

  readonly configSurface = weixinConfigSurface;

  readonly pairing = createStandardPairingAdapter('weixin');

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
  private monitorTasks = new Map<string, Promise<void>>();
  private setupSessions = new Map<string, { id: string; section: NonNullable<Config['channels']>['weixin']; expiresAt: number }>();
  private monitorStates = new Map<string, WeixinMonitorState>();

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
      status: this.monitorStates.get(account.accountId),
    }),
  };

  security = {
    resolveDmPolicy: ({ account }: { account: ResolvedWeixinAccount }) =>
      resolveDmPolicy(account.dmPolicy, 'open'),
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

      const task = monitorWeixinProvider({
        account,
        config: this.cfg,
        bus: this.bus,
        abortSignal: ac.signal,
        onState: state => { if (!ac.signal.aborted) this.monitorStates.set(accountId, state); },
      }).catch((err) => {
        if ((err as { name?: string; message?: string } | undefined)?.name === 'AbortError') {
          log.debug({ accountId }, 'Weixin monitor stopped');
          return;
        }
        log.error({ err, accountId }, 'Weixin monitor exited with error');
      }).finally(() => {
        if (this.abortControllers.get(accountId) !== ac) return;
        this.abortControllers.delete(accountId);
        this.monitorStates.delete(accountId);
        this.monitorTasks.delete(accountId);
      });
      this.monitorTasks.set(accountId, task);

      log.info({ accountId }, 'Weixin monitor started');
    }
  }

  async stop(accountId?: string): Promise<void> {
    const ids = accountId ? [accountId] : [...this.abortControllers.keys()];
    for (const id of ids) {
      const ac = this.abortControllers.get(id);
      if (ac) {
        ac.abort();
        await this.monitorTasks.get(id);
      }
    }
    // Only unregister the broker capability on a full stop. Per-account stops
    // still leave the cap usable for other accounts.
    if (!accountId) {
    }
  }

  channelIsRunning(cfg: Config): boolean {
    return listWeixinAccountIds(cfg).some((id) => {
      const a = resolveWeixinAccount(cfg, id);
      return a.configured && a.enabled !== false && this.monitorStates.get(id) === 'polling';
    });
  }

  async onConfigUpdated(cfg: Config): Promise<void> {
    const routingConfigChanged = !isDeepStrictEqual(
      this.cfg.session,
      cfg.session,
    );
    const prevWx = this.cfg.channels?.weixin as unknown;
    const nextWx = cfg.channels?.weixin as { enabled?: boolean } | undefined;
    const channelOff = !nextWx || nextWx.enabled !== true;

    if (channelOff) {
      this.cfg = cfg;
      await this.stop();
      return;
    }

    this.cfg = cfg;

    if (!routingConfigChanged && isDeepStrictEqual(prevWx, nextWx) && this.channelIsRunning(cfg)) {
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

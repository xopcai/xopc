import crypto from 'crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AgentService } from '../agent/service.js';
import { ChannelManager } from '../channels/manager.js';
import { CHAT_CHANNEL_ORDER, getChatChannelMeta } from '../channels/registry.js';
import { setPairingBroadcastSink } from '../channels/pairing/pairing-events.js';
import { MessageBus, MessageBusShutdownError } from '../infra/bus/index.js';
import type { Config as SurfaceConfig } from '../config/config-surface.js';
import { loadConfig, saveConfig as writeConfigToDisk } from '../config/index.js';
import { getWorkspacePath } from '../config/schema.js';
import { CronService } from '../cron/index.js';
import { computeBundledExtensionExtensionsPatch } from '../extensions/bundled-extension-activation.js';
import { ExtensionLoader, areExtensionsGloballyDisabled, buildExtensionMetadataSnapshot } from '../extensions/index.js';
import { installExtensionFromStoreZip, peekExtensionIdFromStoreZip } from '../extensions/install.js';
import { getExtensionLockfileManager } from '../extensions/lockfile.js';
import { HeartbeatService, heartbeatRunnerConfigFromConfig } from './heartbeat/index.js';
import { ConfigHotReloader } from '../config/reload.js';
import { SessionIndex } from '../session/index.js';
import type { Config } from '../config/schema.js';
import type { SessionListQuery, ExportFormat } from '../session/types.js';
import type { SessionPatchBody } from '../session/patch-metadata.js';
import type { CompactionResult } from '../agent/memory/compaction.js';
import { wireTunnelEventsToGateway } from '../tunnel/gateway-lifecycle.js';
import {
  stopTailscaleExposure,
} from './tailscale-lifecycle.js';
import { getExposureManager } from '../remote-access/exposure-manager.js';
import { sanitizeTunnelConfig } from '../tunnel/tunnel-config.js';
import { resolveGatewayAuth, assertGatewayAuthConfigured, validateToken, extractToken, type ResolvedGatewayAuth } from './auth.js';
import { assertGatewayAuthNotKnownWeak } from './security/known-weak-secrets.js';
import { auditGatewayConfig } from './security/audit.js';
import { assertGatewayRuntimeConfig } from './runtime-config.js';
import { resolveEffectiveGatewayPort } from './host.js';
import { isGatewayStrictSecurityEnabled } from './auth-rate-limit.js';
import { getModelRegistry, prewarmModelRegistry } from '../providers/index.js';
import { createLogger, getLogDir, getLogStats } from '../utils/logger.js';
import {
  resolveConfigPath,
  resolveCronJobsPath,
  resolveStateDir,
  resolveAgentDir,
  resolveExtensionsDir,
} from '../config/paths.js';
import { AgentRunRelay, type RelayEvent } from './agent-run-relay.js';
import { ClarifyBridge, type ClarifyBridgeRequest } from './clarify-bridge.js';
import { registerClarifyBridge } from './clarify-runtime.js';
import {
  deleteManagedSkill as deleteManagedSkillDir,
  installSkillFromZip,
  listManagedSkillDirs,
} from '../agent/skills/managed-store.js';
import {
  downloadFromMarketplace,
  getMarketplacePackageDetail,
  getMarketplaceProviderDisplayName,
  listMarketplaceCategories,
  listMarketplacePackages,
  listRegisteredProviders,
  resolveSkillsMarketplaceProvider,
  type MarketplaceCategoryOption,
  type SkillsStoreListParams,
  type UnifiedMarketplaceListResponse,
  type UnifiedMarketplacePackageDetail,
} from '../agent/skills/skills-marketplace.js';
import {
  downloadExtensionStoreZipBuffer,
  fetchMarketplacePackageDetail,
  resolveExtensionZipDownloadUrl,
  resolveExtensionsStoreBaseUrl,
  type MarketplacePackageDetail,
} from '../agent/skills/marketplace/adapters/store/store-api-client.js';
import { createSkillConfigManager } from '../agent/skills/config.js';
import { removeSkillsLockEntry } from '../agent/skills/hub-lock.js';
import type { SkillCatalogEntry } from '../agent/agent-manager.js';
import type { SkillMarkdownPreviewPayload } from '../agent/skills/types.js';
import type { ManagedSkillListItem } from '../agent/skills/managed-store.js';
import { PACKAGE_VERSION } from '../package-version.js';

import {
  disposeAllSessionMcpRuntimes,
  retireSessionMcpRuntimeForSessionKey,
} from '../agent/mcp/bundle-mcp-tools.js';
import { buildSessionKey, parseSessionKey } from '../routing/session-key.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';
import { scheduleGatewayUpdateCheck } from '../infra/update-startup.js';
import { resolveChannelConnectDeferSet } from './resolve-channel-connect-defer.js';
import { restartGatewayProcessWithFreshPid } from './respawn.js';
import { getDistinctSessionChatIds } from './service/session-chat-ids.js';
import { runGatewayAgent } from './service/run-gateway-agent.js';
import { GatewaySseHub } from './service/sse-hub.js';
import type {
  GatewayChannelStartupPhase1Metrics,
  GatewayChannelStartupPhase2Metrics,
  GatewayServiceConfig,
  ServiceEvent,
} from './service/types.js';
import {
  GatewayReadiness,
  type GatewayReadinessSnapshot,
} from './startup-readiness.js';
import { createGatewayStartupTrace, type GatewayStartupTrace } from './startup-trace.js';

export type {
  GatewayChannelStartupPhase1Metrics,
  GatewayChannelStartupPhase2Metrics,
  GatewayServiceConfig,
  ServiceEvent,
} from './service/types.js';

const log = createLogger('GatewayService');

export class GatewayService {
  private bus: MessageBus;
  private config: Config;
  private configPath: string;
  private _agentService: AgentService | null = null;
  private channelManager: ChannelManager;
  private cronService: CronService;
  private extensionLoader: ExtensionLoader | null = null;
  private extensionMetadataSnapshot: import('../extensions/extension-metadata-snapshot.js').ExtensionMetadataSnapshot | null = null;
  private browserExtensionProvider: import('../browser/providers/extension.js').ExtensionBrowserProvider | null = null;
  private browserExtensionRelease: (() => Promise<void>) | null = null;
  /** `${host}:${port}` when the gateway holds the extension bridge listener. */
  private browserExtensionBindKey: string | null = null;
  private heartbeatService: HeartbeatService | null = null;
  private sessionIndex: SessionIndex;
  private running = false;
  private configReloader: ConfigHotReloader | null = null;
  /** In-flight coalesced apply after PATCH/save (Telegram `getMe` must not block HTTP). */
  private channelReloadFlushPromise: Promise<void> | null = null;
  private channelReloadPending = false;
  private startTime = Date.now();
  private workspacePath: string;

  // Authentication
  private auth: ResolvedGatewayAuth;

  private readonly sse = new GatewaySseHub();

  // Agent run relay for resuming SSE streams
  public readonly runRelay = new AgentRunRelay();

  /** Per-run abort for webchat (POST /api/agent/abort or client disconnect). */
  private runAbortControllers = new Map<string, AbortController>();

  private stopGatewayUpdateCheck: (() => void) | null = null;

  /** When set (e.g. by `GatewayServer`), `triggerGatewayProcessRestart` can stop HTTP then exit. */
  private gatewayShutdownForRestart: (() => Promise<void>) | null = null;

  /** Snapshot for phase-2 metrics / logs (ids deferred at phase-1 `start()`). */
  private lastDeferredChannelConnectIds: string[] = [];
  private lastChannelConnectDeferMode: 'auto' | 'off' | 'explicit' = 'auto';
  private lastChannelConnectDeferSource: 'off' | 'explicit' | 'meta' = 'off';

  private readonly readiness = new GatewayReadiness();
  private startupTrace: GatewayStartupTrace | null = null;

  private readonly clarifyBridge = new ClarifyBridge();

  /** Maps webchat session key → active `runId` for `clarify` tool routing. */
  private activeWebchatRunBySession = new Map<string, string>();

  constructor(private serviceConfig: GatewayServiceConfig = {}) {
    this.bus = new MessageBus();
    this.configPath = serviceConfig.configPath || resolveConfigPath();
    this.config = loadConfig(this.configPath);
    if (sanitizeTunnelConfig(this.config)) {
      void writeConfigToDisk(this.config, this.configPath).catch((err) => {
        const em = err instanceof Error ? err.message : String(err);
        log.warn({ err, phase: 'tunnel_sanitize', errorMessage: em }, `Tunnel config sanitize persist failed: ${em}`);
      });
    }

    // Initialize authentication
    this.auth = resolveGatewayAuth({
      authConfig: this.config.gateway?.auth,
    });

    // Validate auth configuration
    assertGatewayAuthConfigured(this.auth);

    // Reject known weak / placeholder credentials at startup
    assertGatewayAuthNotKnownWeak(this.auth);

    const gatewayPort = this.getEffectiveListenPort();
    const runtimeConfig = assertGatewayRuntimeConfig({
      cfg: this.config,
      auth: this.auth,
      bindOverride: serviceConfig.listenBind,
      port: gatewayPort,
    });

    // Security audit: non-blocking warnings for remaining risk signals
    auditGatewayConfig({
      auth: this.auth,
      bindHost: runtimeConfig.bindHost,
      corsOrigins: runtimeConfig.corsOrigins,
      rateLimitEnabled: runtimeConfig.rateLimitEnabled,
      tlsEnabled: runtimeConfig.tlsEnabled,
      trustedProxies: this.config.gateway?.trustedProxies,
      allowRealIpFallback: this.config.gateway?.allowRealIpFallback === true,
      dangerouslyAllowHostHeaderOriginFallback: runtimeConfig.dangerouslyAllowHostHeaderOriginFallback,
      strictSecurityEnabled: isGatewayStrictSecurityEnabled(this.config),
      rateLimitConfigured: this.config.gateway?.auth?.rateLimit !== undefined,
    });

    // Log token info (not the token itself)
    if (this.auth.mode === 'token') {
      const tokenPreview = this.auth.token ? `${this.auth.token.slice(0, 4)}***` : 'none';
      log.info({ mode: this.auth.mode, token: tokenPreview }, 'Authentication configured');
    } else if (this.auth.mode === 'trusted-proxy') {
      log.info(
        {
          mode: this.auth.mode,
          userHeader: this.auth.trustedProxy?.userHeader,
          trustedProxyCount: this.config.gateway?.trustedProxies?.length ?? 0,
        },
        'Trusted-proxy authentication configured',
      );
    } else {
      log.info({ mode: this.auth.mode }, 'Authentication configured');
    }

    // Initialize channel manager
    this.channelManager = new ChannelManager(this.config, this.bus);

    // Initialize extension loader (manifest snapshot only — code load in start()).
    this.workspacePath = getWorkspacePath(this.config) || './workspace';
    this.initializeExtensionLoader();

    // Session index + files shared with AgentService (webchat `/goal` metadata must match GET /api/goals/webchat).
    this.sessionIndex = new SessionIndex({
      config: this.config,
    });

    this.cronService = new CronService({
      filePath: resolveCronJobsPath(),
    });
  }

  /** Lazy AgentService — constructed on first use or during `start()`. */
  get agentService(): AgentService {
    return this.ensureAgentService();
  }

  private ensureAgentService(): AgentService {
    if (this._agentService) {
      return this._agentService;
    }

    const modelConfig = this.config.agents?.defaults?.model;
    const cronRef: { service?: CronService } = { service: this.cronService };
    this._agentService = new AgentService(this.bus, {
      workspace: this.workspacePath,
      model: typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary,
      config: this.config,
      sessionStore: this.sessionIndex.getStore(),
      onSessionMetadataUpdated: (sessionKey) => {
        this.sessionIndex.emit('sessionUpdated', { key: sessionKey });
      },
      onSessionTranscriptUpdated: (sessionKey) => {
        this.emit('session.transcript_updated', { key: sessionKey });
      },
      extensionRegistry: this.extensionLoader?.getRegistry(),
      getCronService: () => cronRef.service,
      gatewayClarify: {
        requestClarification: (sessionKey, request) => {
          const runId = this.activeWebchatRunBySession.get(sessionKey);
          const publishSse = runId
            ? (e: RelayEvent) => {
                this._agentService!.enqueueWebchatSseEvent(sessionKey, e);
              }
            : undefined;
          const parsed = parseSessionKey(sessionKey);
          const deliver =
            parsed?.source === 'telegram'
              ? async (ctx: { sessionKey: string; requestId: string; request: ClarifyBridgeRequest }) => {
                  await this.deliverTelegramClarify(ctx);
                }
              : undefined;
          if (!runId && !deliver) {
            return Promise.reject(
              new Error('Clarify is not available for this session (use webchat, Telegram, or CLI)'),
            );
          }
          return this.clarifyBridge.startRequest({
            sessionKey,
            runId,
            relay: this.runRelay,
            publishSse,
            request,
            deliver,
          });
        },
      },
    });

    this._agentService.setChannelManager(this.channelManager);
    this.channelManager.setSessionModelHooks({
      getModelForSession: (sk) => this._agentService!.getModelForSession(sk),
      switchModelForSession: (sk, id) => this._agentService!.switchModelForSession(sk, id),
    });

    this.cronService.setDeps({
      agentService: this._agentService,
      messageBus: this.bus,
      heartbeatService: this.ensureHeartbeatService(),
      sessionStore: this.sessionIndex.getStore(),
      getDefaultCronAgentId: () => getDefaultAgentId(this.config),
    });
    cronRef.service = this.cronService;

    this._agentService.setPersistentGoalWebchatContinuationScheduler((sessionKey, message) => {
      const scheduleWhenIdle = () => {
        if (this._agentService!.getInboundTurnDepth(sessionKey) > 0) {
          setTimeout(scheduleWhenIdle, 50);
          return;
        }
        if (this.activeWebchatRunBySession.has(sessionKey)) {
          setTimeout(scheduleWhenIdle, 50);
          return;
        }
        void this.drainScheduledWebchatContinuation(sessionKey, message);
      };
      queueMicrotask(scheduleWhenIdle);
    });

    return this._agentService;
  }

  private ensureHeartbeatService(): HeartbeatService {
    if (this.heartbeatService) {
      return this.heartbeatService;
    }
    this.heartbeatService = new HeartbeatService({
      agentService: this.ensureAgentService(),
      messageBus: this.bus,
      cronService: this.cronService,
      sessionStore: this.sessionIndex.getStore(),
      getConfig: () => this.config,
    });
    return this.heartbeatService;
  }

  /** Hermes-style: after HTTP sets a goal, enqueue the goal text as the next user turn. */
  enqueueWebchatPersistentGoalKickoff(sessionKey: string, goalText: string): void {
    queueMicrotask(() => {
      void this.drainScheduledWebchatContinuation(sessionKey, goalText);
    });
  }

  private initializeExtensionLoader(): void {
    try {
      if (areExtensionsGloballyDisabled(this.config)) {
        log.info('Extensions globally disabled — skipping loader initialization');
        return;
      }

      const loaderOptions = {
        workspaceDir: this.workspacePath,
        extensionsDir: resolveExtensionsDir(),
      };
      this.extensionMetadataSnapshot = buildExtensionMetadataSnapshot(loaderOptions, this.config);
      this.extensionLoader = new ExtensionLoader(loaderOptions);
      this.extensionLoader.setManifestSnapshot(this.extensionMetadataSnapshot);
      this.extensionLoader.setConfig(this.config as Parameters<ExtensionLoader['setConfig']>[0]);
    } catch (error) {
      log.warn({ error }, 'Failed to initialize extension loader');
    }
  }

  private registerExtensionChannelPlugins(): void {
    if (!this.extensionLoader) {
      return;
    }
    const reg = this.extensionLoader.getRegistry();
    for (const plugin of reg.channelPlugins) {
      this.channelManager.registerPlugin(plugin);
    }
  }

  /**
   * Load extensions and register SDK / full ChannelPlugin instances with ChannelManager.
   */
  private async loadExtensionsAndRegisterChannels(): Promise<void> {
    if (!this.extensionLoader) {
      return;
    }
    try {
      await this.extensionLoader.loadByActivationPlan({ phase: 'startup' });
      this.registerExtensionChannelPlugins();
      const reg = this.extensionLoader.getRegistry();
      log.debug(
        {
          extensionRecords: reg.extensions.size,
          channelPlugins: reg.channelPlugins.length,
        },
        'Startup-phase extensions loaded and channel plugins registered',
      );
    } catch (err) {
      log.warn({ err }, 'Failed to load startup-phase extensions');
    }
  }

  private async loadDeferredExtensions(): Promise<void> {
    if (!this.extensionLoader) {
      return;
    }
    try {
      await this.extensionLoader.loadByActivationPlan({ phase: 'deferred' });
      this.registerExtensionChannelPlugins();
      log.debug('Deferred-phase extensions loaded');
    } catch (err) {
      log.warn({ err }, 'Failed to load deferred extensions');
    }
  }

  private schedulePostReadySidecars(): void {
    queueMicrotask(() => {
      void this.runPostReadySidecars();
    });
  }

  private async runPostReadySidecars(): Promise<void> {
    const trace = this.startupTrace;
    try {
      if (trace) {
        await trace.measure('sidecars.model-prewarm', () => prewarmModelRegistry());
      } else {
        await prewarmModelRegistry();
      }
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em, phase: 'sidecars.model_prewarm' }, `Model registry prewarm failed: ${em}`);
    }

    if (!this.extensionLoader || areExtensionsGloballyDisabled(this.config)) {
      return;
    }

    try {
      if (trace) {
        await trace.measure('extensions.deferred-load', () => this.loadDeferredExtensions());
      } else {
        await this.loadDeferredExtensions();
      }
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em, phase: 'extensions.deferred_load' }, `Deferred extension load failed: ${em}`);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;

    setPairingBroadcastSink((type, payload) => {
      this.emit(type, payload);
    });

    log.debug('Starting gateway service...');
    this.startTime = Date.now();
    this.running = true;
    this.startupTrace = createGatewayStartupTrace();
    this.readiness.markStarting(this.startTime);
    const trace = this.startupTrace;

    registerClarifyBridge(this.clarifyBridge);

    this.ensureAgentService();

    this.channelManager.setOutboundHooks({
      runMessageSending: (to, content, channel) =>
        this.agentService.invokeOutboundMessageSending(to, content, channel),
      runMessageSent: (to, content, success, error, channel) =>
        this.agentService.invokeOutboundMessageSent(to, content, success, error, channel),
    });
    this.channelManager.enableOutboundPersistence(resolveAgentDir(this.config, getDefaultAgentId(this.config)));

    if (this.extensionLoader) {
      this.extensionLoader.setRuntimeContext({
        bus: this.bus,
        sessionManager: this.sessionIndex,
        scheduleWebchatContinuation: (sessionKey: string, continuationMessage: string) => {
          queueMicrotask(() => {
            void this.drainScheduledWebchatContinuation(sessionKey, continuationMessage);
          });
        },
      });
    }

    await trace.measure('extensions.load', () => this.loadExtensionsAndRegisterChannels());

    const skipChannels =
      process.env.XOPC_SKIP_CHANNELS === '1' ||
      process.env.XOPC_SKIP_CHANNELS === 'true' ||
      process.env.XOPC_SKIP_PROVIDERS === '1' ||
      process.env.XOPC_SKIP_PROVIDERS === 'true';

    // Start channels: init all; optional defer for meta.deferConnectUntilAfterListen (GatewayServer)
    const phase1StartedAt = performance.now();
    let channelInitMs = 0;
    let deferPlanMs = 0;
    let channelPhase1StartMs = 0;
    let replayOutboundMs: number | null = null;
    let deferConnect = new Set<string>();

    if (skipChannels) {
      log.info('Skipping channel startup (XOPC_SKIP_CHANNELS or XOPC_SKIP_PROVIDERS)');
    } else {
      const t0 = performance.now();
      await trace.measure('channels.initialize', () => this.channelManager.initialize());
      channelInitMs = performance.now() - t0;

      const t1 = performance.now();
      const deferResolution = resolveChannelConnectDeferSet({
        config: this.config,
        channelManager: this.channelManager,
        deferChannelConnectUntilAfterHttp: this.serviceConfig.deferChannelConnectUntilAfterHttp === true,
      });
      deferConnect = deferResolution.deferPluginIds;
      deferPlanMs = performance.now() - t1;
      this.lastDeferredChannelConnectIds = [...deferConnect];
      this.lastChannelConnectDeferMode = deferResolution.mode;
      this.lastChannelConnectDeferSource = deferResolution.source;

      if (deferConnect.size > 0) {
        log.info({ channels: [...deferConnect] }, 'Deferring channel outbound connect until HTTP listen');
      }

      const t2 = performance.now();
      await trace.measure('channels.start', () =>
        this.channelManager.start(
          deferConnect.size > 0 ? { deferConnectPluginIds: deferConnect } : undefined,
        ),
      );
      channelPhase1StartMs = performance.now() - t2;

      if (this.serviceConfig.deferChannelConnectUntilAfterHttp !== true) {
        const tr = performance.now();
        await trace.measure('channels.replay-outbound', () =>
          this.channelManager.replayPendingOutboundMessages(),
        );
        replayOutboundMs = performance.now() - tr;
      }
    }

    const channelStartupPhase1TotalMs = performance.now() - phase1StartedAt;
    const gwDeferMode = this.config.gateway?.channelConnectDeferMode ?? 'auto';
    const phase1Metrics: GatewayChannelStartupPhase1Metrics = {
      deferChannelConnectUntilAfterHttp: this.serviceConfig.deferChannelConnectUntilAfterHttp === true,
      channelConnectDeferMode: this.serviceConfig.deferChannelConnectUntilAfterHttp
        ? this.lastChannelConnectDeferMode
        : gwDeferMode,
      channelConnectDeferSource: this.lastChannelConnectDeferSource,
      deferredChannelIds: this.lastDeferredChannelConnectIds,
      deferredChannelCount: this.lastDeferredChannelConnectIds.length,
      channelInitMs: Math.round(channelInitMs),
      deferPlanMs: Math.round(deferPlanMs),
      channelPhase1StartMs: Math.round(channelPhase1StartMs),
      replayOutboundMs: replayOutboundMs === null ? null : Math.round(replayOutboundMs),
      channelStartupPhase1TotalMs: Math.round(channelStartupPhase1TotalMs),
    };
    log.info(
      { phase: 'gateway.channel_startup', stage: 'phase1', ...phase1Metrics },
      'Gateway channel startup phase-1 complete',
    );

    // Initialize session manager
    await trace.measure('sessions.initialize', () => this.sessionIndex.initialize());
    log.debug('Session manager initialized');

    this.cronService.setDeps({
      agentService: this.agentService,
      messageBus: this.bus,
      heartbeatService: this.ensureHeartbeatService(),
      sessionStore: this.sessionIndex.getStore(),
      getDefaultCronAgentId: () => getDefaultAgentId(this.config),
    });

    this.sessionIndex.on('sessionUpdated', (data: { key: string; name?: string; tags?: string[] }) => {
      this.emit('session.updated', { key: data.key, name: data.name, tags: data.tags });
    });

    // Start cron service
    if (this.config.cron?.enabled !== false) {
      await trace.measure('cron.initialize', () => this.cronService.initialize());
    }

    this.ensureHeartbeatService().start(heartbeatRunnerConfigFromConfig(this.config));

    void import('../browser/providers/browser-ext-install.js')
      .then(({ ensureBrowserExtensionOnStartup }) => ensureBrowserExtensionOnStartup(this.config))
      .catch((err) => log.warn({ err }, 'Browser extension artifact ensure failed'));

    // Start browser extension WS server if configured
    await trace.measure('browser-extension.start', () => this.startBrowserExtensionServerIfNeeded());

    // Start agent service (runs in background)
    this.agentService.start().catch((err) => {
      log.error({ err }, 'Agent service error');
    });

    // Outbound drain: after deferred channel connects when using HTTP lifecycle (avoid racing Telegram).
    if (this.serviceConfig.deferChannelConnectUntilAfterHttp !== true) {
      this.startOutboundProcessor().catch((err) => {
        log.error({ err }, 'Outbound processor error');
      });
    }

    // Setup config hot reload
    if (this.serviceConfig.enableHotReload !== false) {
      this.setupConfigReloader();
    }

    this.stopGatewayUpdateCheck = scheduleGatewayUpdateCheck({
      config: this.config,
      onUpdateAvailableChange: (update) => {
        this.emit('update.available', update);
      },
    });

    wireTunnelEventsToGateway(this);

    if (this.serviceConfig.deferChannelConnectUntilAfterHttp !== true) {
      this.markGatewayReady();
    } else {
      trace.mark('service.started-awaiting-http');
    }

    log.debug('Gateway service started');
  }

  /** Called when the HTTP listener is bound (before deferred channel work). */
  markHttpListening(): void {
    this.readiness.markHttpListening();
    this.startupTrace?.mark('http.listening');
  }

  isGatewayReady(): boolean {
    return this.readiness.isReady();
  }

  getGatewayReadiness(): GatewayReadinessSnapshot {
    return this.readiness.getSnapshot();
  }

  private async applyStartupReadyDelayForTesting(): Promise<void> {
    const raw = process.env.XOPC_GATEWAY_STARTUP_SLOW_MS?.trim();
    if (!raw) {
      return;
    }
    const delayMs = Number.parseInt(raw, 10);
    if (!Number.isFinite(delayMs) || delayMs <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private markGatewayReady(): void {
    this.readiness.markReady();
    this.startupTrace?.mark('ready');
    this.schedulePostReadySidecars();
  }

  /** After HTTP is listening: exposure auto-start (Tailscale, then FRP tunnel). */
  private async runExposureAutoStartIfConfigured(): Promise<void> {
    const port = this.getEffectiveListenPort();
    await getExposureManager().autoStart(this.config, port, this.getAuthToken());
  }

  /**
   * Called by `GatewayServer` when the HTTP listener is bound. Starts channels that
   * opted into `meta.deferConnectUntilAfterListen`, then replays outbound queue.
   */
  async onHttpListening(): Promise<void> {
    await this.runExposureAutoStartIfConfigured();

    if (this.serviceConfig.deferChannelConnectUntilAfterHttp !== true) {
      return;
    }
    const listenStartedAt = performance.now();
    const trace = this.startupTrace;
    try {
      await this.applyStartupReadyDelayForTesting();

      const tDef = performance.now();
      if (trace) {
        await trace.measure('channels.deferred-connect', () => this.channelManager.startDeferredConnects());
      } else {
        await this.channelManager.startDeferredConnects();
      }
      const channelPhase2DeferredMs = performance.now() - tDef;

      const tr = performance.now();
      if (trace) {
        await trace.measure('channels.replay-outbound', () =>
          this.channelManager.replayPendingOutboundMessages(),
        );
      } else {
        await this.channelManager.replayPendingOutboundMessages();
      }
      const replayOutboundMs = performance.now() - tr;

      this.startOutboundProcessor().catch((err) => {
        log.error({ err }, 'Outbound processor error');
      });
      this.emit('channels.status', { channels: this.getChannelsStatus() });

      const onHttpListeningTotalMs = performance.now() - listenStartedAt;
      const phase2Metrics: GatewayChannelStartupPhase2Metrics = {
        channelConnectDeferMode: this.lastChannelConnectDeferMode,
        channelConnectDeferSource: this.lastChannelConnectDeferSource,
        deferredChannelIds: this.lastDeferredChannelConnectIds,
        channelPhase2DeferredMs: Math.round(channelPhase2DeferredMs),
        replayOutboundMs: Math.round(replayOutboundMs),
        onHttpListeningTotalMs: Math.round(onHttpListeningTotalMs),
      };
      log.info(
        { phase: 'gateway.channel_startup', stage: 'phase2', ...phase2Metrics },
        'Gateway channel startup phase-2 complete (HTTP listening)',
      );
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.error(
        {
          err,
          errorMessage: em,
          phase: 'gateway.channel_startup',
          stage: 'phase2',
          deferredChannelIds: this.lastDeferredChannelConnectIds,
          elapsedMs: Math.round(performance.now() - listenStartedAt),
        },
        `Deferred channel startup after HTTP listen failed: ${em}`,
      );
    } finally {
      this.markGatewayReady();
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    setPairingBroadcastSink(null);

    log.debug('Stopping gateway service...');
    this.readiness.markStarting();

    await stopTailscaleExposure().catch((err) => {
      log.warn({ err }, 'Tailscale exposure shutdown failed');
    });

    if (this.stopGatewayUpdateCheck) {
      this.stopGatewayUpdateCheck();
      this.stopGatewayUpdateCheck = null;
    }

    // Stop config reloader
    if (this.configReloader) {
      await this.configReloader.stop();
      this.configReloader = null;
    }

    if (this.channelReloadFlushPromise) {
      await this.channelReloadFlushPromise.catch(() => {});
      this.channelReloadFlushPromise = null;
    }

    // Stop heartbeat service
    this.heartbeatService?.stop();

    // Stop browser extension WS server (shared acquire/release with BrowserManager)
    if (this.browserExtensionRelease) {
      await this.browserExtensionRelease();
      this.browserExtensionRelease = null;
    }
    this.browserExtensionProvider = null;
    this.browserExtensionBindKey = null;

    registerClarifyBridge(null);
    this.clarifyBridge.dispose();
    await disposeAllSessionMcpRuntimes().catch((err) => {
      log.warn({ err }, 'MCP runtime shutdown failed');
    });
    this._agentService?.stop();

    // Unblock `consumeOutbound()` / `consumeInbound()` waiters before stopping channels (CLI agent does the same).
    this.running = false;
    this.bus.shutdown();

    this.lastDeferredChannelConnectIds = [];
    this.lastChannelConnectDeferMode = 'auto';
    this.lastChannelConnectDeferSource = 'off';

    await this.channelManager.stop();

    // Stop cron service
    await this.cronService.stop();

    log.debug('Gateway service stopped');
  }

  /** Start the browser extension WS server when backend is 'extension'. */
  private async startBrowserExtensionServerIfNeeded(): Promise<void> {
    await this.reconcileBrowserExtensionServer();
  }

  /**
   * Start/stop/rebind the Chrome extension bridge when `agents.defaults.browser` changes.
   * PATCH saves update config in memory without re-running gateway startup, so this must run on save too.
   */
  async reconcileBrowserExtensionServer(): Promise<void> {
    const browser = (this.config.agents?.defaults as Record<string, unknown> | undefined)?.browser as
      | Record<string, unknown>
      | undefined;
    const wantsExtension = browser?.backend === 'extension';

    if (!wantsExtension) {
      if (this.browserExtensionRelease) {
        await this.browserExtensionRelease();
        this.browserExtensionRelease = null;
        this.browserExtensionProvider = null;
        this.browserExtensionBindKey = null;
        log.debug('Browser extension WS server stopped (backend is not extension)');
      }
      return;
    }

    const ext = browser.extension as Record<string, unknown> | undefined;
    const port = typeof ext?.port === 'number' ? ext.port : 19820;
    const host = typeof ext?.host === 'string' && ext.host ? ext.host : '127.0.0.1';
    const bindKey = `${host}:${port}`;

    if (this.browserExtensionRelease && this.browserExtensionBindKey === bindKey) {
      return;
    }

    if (this.browserExtensionRelease) {
      await this.browserExtensionRelease();
      this.browserExtensionRelease = null;
      this.browserExtensionProvider = null;
      this.browserExtensionBindKey = null;
    }

    try {
      const { acquireExtensionBrowserServer } = await import('../browser/providers/extension-ws-acquire.js');
      const { provider, release } = await acquireExtensionBrowserServer({ port, host });
      this.browserExtensionProvider = provider;
      this.browserExtensionRelease = release;
      this.browserExtensionBindKey = bindKey;
      log.info({ port, host }, 'Browser extension WS server started');
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code: unknown }).code : undefined;
      log.error(
        {
          err,
          phase: 'browser_extension_ws',
          ...(code === 'EADDRINUSE'
            ? {
                bindPort: port,
                bindHost: host,
                hint: 'Another process holds this port (default 19820). Stop it or set agents.defaults.browser.extension.port.',
              }
            : {}),
        },
        `Failed to start browser extension WS server: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Start processing outbound messages and send through channels
   */
  private async startOutboundProcessor(): Promise<void> {
    log.debug('Starting outbound message processor');
    while (this.running) {
      try {
        const msg = await this.bus.consumeOutbound();
        await this.channelManager.send(msg);
      } catch (error) {
        if (error instanceof MessageBusShutdownError) {
          break;
        }
        const em = error instanceof Error ? error.message : String(error);
        log.error(
          { err: error, errorMessage: em, phase: 'outbound_consume' },
          `Outbound pipeline failed (will retry in 1s): ${em}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Setup config hot reload using ConfigHotReloader
   */
  private setupConfigReloader(): void {
    this.configReloader = new ConfigHotReloader(
      this.configPath,
      this.config,
      {
        onModelsReload: (newConfig) => this.handleModelsReload(newConfig),
        onAgentDefaultsReload: (newConfig) => this.handleAgentDefaultsReload(newConfig),
        onChannelsReload: (newConfig) => this.handleChannelsReload(newConfig),
        onCronReload: (newConfig) => this.handleCronReload(newConfig),
        onHeartbeatReload: (newConfig) => this.handleHeartbeatReload(newConfig),
        onToolsReload: (newConfig) => this.handleToolsReload(newConfig),
        onMcpReload: (newConfig) => this.handleMcpReload(newConfig),
        onExtensionsReload: async (newConfig, changedPaths) => {
          await this.handleExtensionsReload(newConfig, changedPaths);
        },
        onFullRestart: (newConfig) => {
          log.warn(
            { requiresProcessRestart: true, hint: 'Restart the gateway process (hot reload cannot apply this change).' },
            'Config reload: full gateway restart required — see prior "restartPaths" info log',
          );
          this.config = newConfig;
          this.emit('config.reload', { section: 'full', requiresRestart: true });
        },
      },
      {
        debounceMs: 300,
        enabled: this.serviceConfig.enableHotReload !== false,
      }
    );
    this.configReloader.start();
  }

  /**
   * Handle models config hot reload
   */
  private handleModelsReload(newConfig: Config): void {
    log.debug('Reloading models config...');
    this.config = newConfig;
    getModelRegistry().refresh();
    this.emit('config.reload', { section: 'models' });
    log.debug('Models config reloaded');
  }

  /**
   * Handle agent defaults config hot reload
   */
  private handleAgentDefaultsReload(newConfig: Config): void {
    log.debug('Reloading agent defaults...');
    this.config = newConfig;
    this.agentService.applyAgentDefaultsFromConfig(newConfig);
    void this.reconcileBrowserExtensionServer();
    this.emit('config.reload', { section: 'agents' });
    log.debug('Agent defaults reloaded');
  }

  /**
   * Apply `latest.channels` to every registered channel plugin (Telegram, Weixin, extensions).
   * Single runtime path for: file watcher hot reload, API saves, and Weixin QR follow-up.
   */
  private async handleChannelsReload(newConfig: Config): Promise<void> {
    log.debug('Reloading channels config...');
    this.config = newConfig;
    await this.channelManager.updateConfig(newConfig);
    this.emit('config.reload', { section: 'channels' });
    this.emit('channels.status', { channels: this.getChannelsStatus() });
    log.debug('Channels config reloaded');
  }

  /**
   * Apply channel plugins for the latest persisted `this.config` without blocking `saveConfig` HTTP handlers.
   * Coalesces rapid saves so Telegram/Weixin do not stop/start repeatedly.
   */
  private scheduleChannelPluginsAfterPersist(): void {
    this.channelReloadPending = true;
    if (this.channelReloadFlushPromise) return;
    this.channelReloadFlushPromise = (async () => {
      try {
        while (this.channelReloadPending) {
          this.channelReloadPending = false;
          await this.handleChannelsReload(this.config);
        }
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        log.error({ err, errorMessage: em }, `Channel reload after persist failed: ${em}`);
      } finally {
        this.channelReloadFlushPromise = null;
        if (this.channelReloadPending) {
          this.scheduleChannelPluginsAfterPersist();
        }
      }
    })();
  }

  /**
   * Handle cron config hot reload
   */
  private handleCronReload(newConfig: Config): void {
    log.debug('Reloading cron config...');
    this.config = newConfig;
    this.cronService.updateConfig(newConfig);
    this.emit('config.reload', { section: 'cron' });
    log.debug('Cron config reloaded');
  }

  /**
   * Handle heartbeat config hot reload
   */
  private handleHeartbeatReload(newConfig: Config): void {
    log.debug('Reloading heartbeat config...');
    this.config = newConfig;
    this.heartbeatService?.updateConfig(newConfig);
    this.emit('config.reload', { section: 'heartbeat' });
    log.debug('Heartbeat config reloaded');
  }

  /**
   * Apply `gateway.heartbeat` from current config after PATCH /api/config (and when hot reload is off).
   * File watcher uses `handleHeartbeatReload` with the same effect when paths match.
   */
  reloadHeartbeatFromCurrentConfig(): void {
    this.handleHeartbeatReload(this.config);
  }

  /**
   * Handle tools config hot reload
   */
  private handleToolsReload(newConfig: Config): void {
    log.debug('Reloading tools config...');
    this.config = newConfig;
    this.emit('config.reload', { section: 'tools' });
    log.debug('Tools config reloaded');
  }

  private handleMcpReload(newConfig: Config): void {
    log.debug('Reloading MCP config...');
    this.config = newConfig;
    void disposeAllSessionMcpRuntimes().catch((err) => {
      log.warn({ err }, 'MCP runtime dispose on config reload failed');
    });
    this.emit('config.reload', { section: 'mcp' });
    log.debug('MCP config reloaded');
  }

  /**
   * Dispatch config hot reload to extensions that registered `registerReload`, matching changed paths.
   */
  private async handleExtensionsReload(
    newConfig: Config,
    changedPaths: string[],
  ): Promise<void> {
    this.config = newConfig;
    this.extensionLoader?.setConfig(this.config as unknown as SurfaceConfig);

    if (!this.extensionLoader) {
      this.emit('config.reload', {
        section: 'extensions',
        source: 'extension-reload',
        changedPaths,
      });
      return;
    }

    const registry = this.extensionLoader.getRegistry();
    const matchingRegs = registry.getMatchingReloadRegistrations(changedPaths);

    if (matchingRegs.length === 0) {
      log.debug({ changedPaths }, 'No extension reload handlers matched');
      this.emit('config.reload', {
        section: 'extensions',
        source: 'extension-reload',
        changedPaths,
      });
      return;
    }

    for (const reg of matchingRegs) {
      const relevantPaths = changedPaths.filter(
        (p) =>
          reg.configPrefixes.length === 0 ||
          reg.configPrefixes.some(
            (prefix) => p === prefix || p.startsWith(`${prefix}.`),
          ),
      );

      log.info(
        { extensionId: reg.extensionId, relevantPaths },
        'Calling extension reload handler',
      );

      try {
        const result = await reg.handler(newConfig, relevantPaths);
        if (result.success) {
          log.info({ extensionId: reg.extensionId }, 'Extension reload succeeded');
        } else {
          log.warn(
            { extensionId: reg.extensionId, error: result.error },
            `Extension reload reported failure: ${result.error ?? 'unknown'}`,
          );
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.error(
          { err, extensionId: reg.extensionId, errorMessage },
          `Extension reload handler threw: ${errorMessage}`,
        );
      }
    }

    this.emit('config.reload', {
      section: 'extensions',
      source: 'extension-reload',
      changedPaths,
    });
  }

  /**
   * Reload configuration from disk (manual trigger)
   */
  async reloadConfig(): Promise<{ reloaded: boolean; error?: string }> {
    if (!this.configReloader) {
      return { reloaded: false, error: 'Config reloader not initialized' };
    }
    const result = await this.configReloader.triggerReload();
    return { reloaded: result.success, error: result.error };
  }

  /**
   * After Weixin QR login: token files may change without a `channels.weixin` JSON diff, so run the same
   * channel apply as an API save, then force Weixin long-poll restart (see `reloadMonitorsWithConfig`).
   */
  async afterWeixinCredentialsPersisted(): Promise<void> {
    const next = loadConfig(this.configPath);
    this.config = next;
    this.agentService.applyAgentDefaultsFromConfig(next);
    this.configReloader?.syncCurrentConfig(next);
    await this.handleChannelsReload(next);
    const { weixinPlugin } = await import('../channels/weixin/index.js');
    await weixinPlugin.reloadMonitorsWithConfig(this.config, this.bus);
    log.info('Weixin monitors restarted after credential login');
  }

  /**
   * After Feishu WebUI QR setup: `channels.feishu` was written directly to disk; reload into memory
   * and apply channel plugins (same baseline as PATCH /api/config).
   */
  async afterFeishuCredentialsPersisted(): Promise<void> {
    const next = loadConfig(this.configPath);
    this.config = next;
    this.agentService.applyAgentDefaultsFromConfig(next);
    this.configReloader?.syncCurrentConfig(next);
    await this.handleChannelsReload(next);
    log.info('Feishu config applied after QR setup');
  }

  /**
   * Persist and replace `this.config` with the validated file contents so runtime matches disk
   * (PATCH merge objects can drift from Zod-normalized output).
   */
  private async writeConfigAndReloadFromDisk(configToWrite: Config): Promise<void> {
    await writeConfigToDisk(configToWrite, this.configPath);
    this.config = loadConfig(this.configPath);
    if (sanitizeTunnelConfig(this.config)) {
      await writeConfigToDisk(this.config, this.configPath);
    }
    this.agentService.applyAgentDefaultsFromConfig(this.config);
    await this.reconcileBrowserExtensionServer();
    // Hot-apply: reconcile managed dreaming cron jobs immediately after config persists.
    await this.agentService.reconcileDreamingNow().catch((err) => {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em }, `Dreaming cron reconcile after save failed: ${em}`);
    });
    // Align watcher baseline before channel hooks run so fs `change` does not re-apply the same diff concurrently.
    this.configReloader?.syncCurrentConfig(this.config);
  }

  async saveConfig(config: Config): Promise<{ saved: boolean; error?: string }> {
    try {
      await this.writeConfigAndReloadFromDisk(config);
      this.scheduleChannelPluginsAfterPersist();
      return { saved: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ error }, 'Failed to save config');
      return { saved: false, error };
    }
  }

  /**
   * App store (phase 1): persist `extensions.enabled` / `extensions.disabled` for a bundled extension.
   * Marketplace-only extensions hot-load on enable; disable still needs a gateway restart to unload.
   */
  async setBundledExtensionActivationTarget(
    extensionId: string,
    wanted: boolean,
  ): Promise<{ ok: boolean; error?: string; requiresGatewayRestart: boolean }> {
    const loader = this.extensionLoader;
    if (!loader) {
      return { ok: false, error: 'Extension loader unavailable', requiresGatewayRestart: false };
    }
    const id = extensionId.trim();
    if (!id) {
      return { ok: false, error: 'Invalid extension id', requiresGatewayRestart: false };
    }
    const patch = computeBundledExtensionExtensionsPatch(loader, this.config, id, wanted);
    if (patch.ok === false) {
      return { ok: false, error: patch.error, requiresGatewayRestart: false };
    }
    const newConfig = { ...this.config, extensions: patch.extensions } as Config;
    const saved = await this.saveConfig(newConfig);
    if (!saved.saved) {
      return { ok: false, error: saved.error ?? 'Failed to save config', requiresGatewayRestart: false };
    }
    loader.setConfig(this.config as unknown as SurfaceConfig);

    let requiresGatewayRestart = true;
    if (wanted) {
      try {
        loader.invalidateManifestCache();
        await loader.loadByActivationPlan();
        requiresGatewayRestart = false;
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, extensionId: id, errorMessage: em },
          `Extension hot-load after bundled activation failed: ${em}`,
        );
        requiresGatewayRestart = true;
      }
    }

    this.emit('config.reload', { section: 'extensions', source: 'bundled-activation' });
    return { ok: true, requiresGatewayRestart };
  }

  /**
   * Update configuration and persist to disk
   */
  async updateConfig(updates: Partial<Config>): Promise<{ updated: boolean; error?: string }> {
    try {
      log.debug('Updating configuration...');
      
      // Merge updates
      this.config = { ...this.config, ...updates };

      await this.writeConfigAndReloadFromDisk(this.config);
      this.scheduleChannelPluginsAfterPersist();

      log.debug('Configuration updated successfully');
      return { updated: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ error }, 'Failed to update config');
      return { updated: false, error };
    }
  }

  /**
   * Run agent with a message and stream events.
   * `runOptions.signal` — When set (e.g. client disconnect), aborts in-flight generation and persists partial output.
   */
  async *runAgent(
    message: string,
    channel: string,
    chatId: string,
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
    }>,
    thinking?: string,
    runOptions?: { signal?: AbortSignal; clientCreatedAtMs?: number },
  ): AsyncGenerator<{ type: string; content?: string; status?: string; runId?: string }, { status: string; summary: string }, unknown> {
    const iter = runGatewayAgent(
      {
        config: this.config,
        agentService: this.agentService,
        bus: this.bus,
        runRelay: this.runRelay,
        runAbortControllers: this.runAbortControllers,
        activeWebchatRunBySession: this.activeWebchatRunBySession,
        sessionIndex: this.sessionIndex,
        emit: (type, payload) => this.sse.emit(type, payload),
      },
      message,
      channel,
      chatId,
      attachments,
      thinking,
      runOptions,
    );

    let step = await iter.next();
    while (!step.done) {
      yield step.value as { type: string; content?: string; status?: string; runId?: string };
      step = await iter.next();
    }
    return step.value;
  }

  /** Abort an in-flight webchat agent run (matches `runId` from SSE `status`). */
  abortAgentRun(runId: string): boolean {
    this.clarifyBridge.cancelForRun(runId);
    const keysToMark: string[] = [];
    for (const [sk, id] of this.activeWebchatRunBySession) {
      if (id === runId) {
        keysToMark.push(sk);
      }
    }
    for (const sk of keysToMark) {
      this.activeWebchatRunBySession.delete(sk);
    }
    const relaySk = this.runRelay.getSessionKey(runId);
    if (relaySk && !keysToMark.includes(relaySk)) {
      keysToMark.push(relaySk);
    }
    const c = this.runAbortControllers.get(runId);
    if (!c) {
      return false;
    }
    const cutoffTs = Date.now();
    for (const sk of keysToMark) {
      void this.sessionIndex
        .updateSessionMetadata(sk, { abortCutoffTimestamp: cutoffTs })
        .catch(() => {});
      void this.sessionIndex
        .appendTranscriptContextEntry(sk, {
          text: 'Webchat agent run aborted',
          data: { runId, abortCutoffTimestamp: cutoffTs },
        })
        .catch(() => {});
    }
    c.abort();
    for (const sk of keysToMark) {
      void import('../agent/embedded/runs.js').then(({ abortEmbeddedRun }) => abortEmbeddedRun(sk));
    }
    return true;
  }

  /** Background drain for extension-initiated webchat turns (`scheduleWebchatContinuation`). */
  private async drainScheduledWebchatContinuation(sessionKey: string, message: string): Promise<void> {
    try {
      const gen = this.runAgent(message, 'webchat', sessionKey, undefined, undefined, {
        clientCreatedAtMs: Date.now(),
      });
      for await (const _ of gen) {
        // Relay + `agent.stream` broadcast; UI attaches via pending runId + resume.
      }
    } catch (err) {
      log.warn({ err, sessionKey }, 'Scheduled webchat continuation failed');
    }
  }

  /**
   * Queue steering text for an active webchat run (`Agent.steer` / tool-boundary injection).
   * `chatId` is the same as `POST /api/agent` body (`sessionKey` or legacy peer id).
   */
  async steerWebchatAgent(
    chatId: string,
    message: string,
  ): Promise<{ ok: true } | { ok: false; code: 'BAD_REQUEST' | 'NO_ACTIVE_RUN' | 'STEER_FAILED' }> {
    const trimmed = message.trim();
    if (!trimmed) {
      return { ok: false, code: 'BAD_REQUEST' };
    }
    const parsedKey = parseSessionKey(chatId);
    const sessionKey = parsedKey
      ? chatId
      : buildSessionKey({
          agentId: getDefaultAgentId(this.config),
          source: 'webchat',
          accountId: 'default',
          peerKind: 'direct',
          peerId: chatId,
        });
    if (!this.activeWebchatRunBySession.has(sessionKey)) {
      return { ok: false, code: 'NO_ACTIVE_RUN' };
    }
    const steered = await this.agentService.steerWebchatSession(sessionKey, trimmed);
    if (!steered) {
      return { ok: false, code: 'STEER_FAILED' };
    }
    return { ok: true };
  }

  private async deliverTelegramClarify(ctx: {
    sessionKey: string;
    requestId: string;
    request: ClarifyBridgeRequest;
  }): Promise<void> {
    const parsed = parseSessionKey(ctx.sessionKey);
    if (!parsed || parsed.source !== 'telegram') {
      return;
    }

    let body = ctx.request.question;
    if (ctx.request.default) {
      body += `\n\nDefault if unsure: ${ctx.request.default}`;
    }

    const choices = ctx.request.choices;
    const buttonRows =
      choices && choices.length >= 2
        ? choices.map((c, i) => [
            {
              text: c.length > 64 ? `${c.slice(0, 61)}…` : c,
              callback_data: `clarify:${ctx.requestId}:${i}`,
            },
          ])
        : undefined;

    if (!buttonRows) {
      body += '\n\nReply with your answer in this chat.';
    }

    await this.channelManager.send({
      channel: 'telegram',
      chat_id: parsed.peerId,
      content: body,
      metadata: {
        accountId: parsed.accountId,
        ...(parsed.threadId ? { threadId: parsed.threadId } : {}),
      },
      buttons: buttonRows,
    });
  }

  /** Deliver a user's answer to a pending `clarify` tool call. */
  submitClarifyResponse(requestId: string, answer: string): boolean {
    return this.clarifyBridge.handleResponse(requestId, answer);
  }

  /**
   * Send message through a channel
   */
  async sendMessage(
    channel: string,
    chatId: string,
    content: string
  ): Promise<{ sent: boolean; messageId?: string }> {
    try {
      await this.channelManager.send({
        channel,
        chat_id: chatId,
        content,
      });
      const messageId = `msg_${Date.now()}`;
      this.emit('message.sent', { channel, chatId, messageId });
      return { sent: true, messageId };
    } catch (error) {
      log.error({ channel, chatId, error }, 'Failed to send message');
      throw error;
    }
  }

  /**
   * Get channel statuses
   */
  getChannelsStatus(): Array<{
    name: string;
    enabled: boolean;
    connected: boolean;
  }> {
    const runningChannels = new Set(this.channelManager.getRunningChannels());
    const channels = this.config.channels as Record<string, { enabled?: boolean } | undefined> | undefined;
    const builtinOrder = CHAT_CHANNEL_ORDER as readonly string[];

    const rows: Array<{ name: string; enabled: boolean; connected: boolean }> = CHAT_CHANNEL_ORDER.map(
      (name) => ({
        name,
        enabled: !!channels?.[name]?.enabled,
        connected: runningChannels.has(name),
      }),
    );

    const extReg = this.extensionLoader?.getRegistry();
    const extraIds = extReg?.channelPlugins.map((p) => p.id).filter((id) => !builtinOrder.includes(id)) ?? [];
    if (extraIds.length === 0) {
      return rows;
    }

    const seen = new Set(builtinOrder);
    for (const name of extraIds) {
      if (seen.has(name)) continue;
      seen.add(name);
      rows.push({
        name,
        enabled: channels?.[name]?.enabled !== false,
        connected: runningChannels.has(name),
      });
    }

    return rows;
  }

  /**
   * Hub metadata for gateway console (built-in registry + registered channel plugins).
   */
  getChannelsHubMeta(): Array<{
    id: string;
    label: string;
    description: string;
    manageable: boolean;
    order: number;
  }> {
    const manageableIds = new Set<string>(['telegram', 'weixin', 'feishu']);
    const byId = new Map<
      string,
      { id: string; label: string; description: string; manageable: boolean; order: number }
    >();

    for (const plugin of this.channelManager.getAllPlugins()) {
      byId.set(plugin.id, {
        id: plugin.id,
        label: plugin.meta.label,
        description: plugin.meta.blurb,
        manageable: manageableIds.has(plugin.id),
        order: plugin.meta.order ?? 999,
      });
    }

    CHAT_CHANNEL_ORDER.forEach((id, index) => {
      if (byId.has(id)) return;
      const meta = getChatChannelMeta(id);
      byId.set(id, {
        id,
        label: meta.label,
        description: meta.description,
        manageable: true,
        order: index,
      });
    });

    return Array.from(byId.values()).toSorted((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.id.localeCompare(b.id);
    });
  }

  /**
   * Request an immediate heartbeat run (coalesced like interval/cron wakes).
   */
  requestHeartbeatNow(opts?: { reason?: string }): void {
    this.heartbeatService?.requestNow({ reason: opts?.reason ?? 'manual' });
  }

  /**
   * Register graceful shutdown used after spawning a replacement gateway process (foreground CLI server).
   */
  registerGatewayShutdownForRestart(handler: () => Promise<void>): void {
    this.gatewayShutdownForRestart = handler;
  }

  /**
   * Respawn the gateway process when supported (spawn + exit, supervisor exit, or disabled when XOPC_NO_RESPAWN).
   */
  triggerGatewayProcessRestart(): { ok: boolean; mode: string; message?: string } {
    const result = restartGatewayProcessWithFreshPid();
    if (result.mode === 'failed') {
      return { ok: false, mode: result.mode, message: result.detail ?? 'spawn failed' };
    }
    if (result.mode === 'disabled') {
      return {
        ok: false,
        mode: 'disabled',
        message:
          'Process respawn is disabled (XOPC_NO_RESPAWN). Restart the gateway manually (e.g. xopc gateway restart).',
      };
    }
    const shutdown = this.gatewayShutdownForRestart;
    if (!shutdown) {
      return {
        ok: false,
        mode: result.mode,
        message: 'Gateway restart is not available in this process.',
      };
    }
    setImmediate(() => {
      void shutdown().finally(() => {
        process.exit(0);
      });
    });
    return { ok: true, mode: result.mode };
  }

  /**
   * Get health status
   */
  getHealth(): {
    status: string;
    service: string;
    version: string;
    uptime: number;
    ready: boolean;
    httpListening: boolean;
    startupDurationMs: number | null;
    channels: { running: number; total: number };
    configPath: string;
    logs?: {
      dir: string;
      errors24h: number;
      stats: Record<string, number>;
    };
  } {
    const runningChannels = this.channelManager.getRunningChannels();
    const allChannels = this.channelManager.getAllChannels();
    const logStats = getLogStats();
    const readiness = this.readiness.getSnapshot();

    return {
      status: 'ok',
      service: 'xopc-gateway',
      version: PACKAGE_VERSION,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      ready: readiness.ready,
      httpListening: readiness.httpListening,
      startupDurationMs: readiness.startupDurationMs,
      channels: {
        running: runningChannels.length,
        total: allChannels.length,
      },
      configPath: this.configPath,
      logs: {
        dir: getLogDir(),
        errors24h: logStats.errorsLast24h,
        stats: logStats.byLevel,
      },
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Get extension registry for external access (HTTP routes, gateway methods)
   */
  getExtensionRegistry() {
    return this.extensionLoader?.getRegistry();
  }

  /** Extension loader for discovery and frontend asset APIs (may be null if extensions failed to init). */
  getExtensionLoader(): ExtensionLoader | null {
    return this.extensionLoader;
  }

  /**
   * Get model registry for external access (HTTP routes)
   */
  getModelRegistry() {
    const { getModelRegistry } = require('../providers/index.js');
    return getModelRegistry();
  }

  /**
   * Invoke a gateway method registered by extensions
   */
  async invokeGatewayMethod(method: string, params: Record<string, unknown>): Promise<unknown> {
    const registry = this.getExtensionRegistry();
    if (!registry) {
      throw new Error('Extension registry not available');
    }

    const handler = registry.getGatewayMethod(method);
    if (!handler) {
      throw new Error(`Gateway method not found: ${method}`);
    }

    return await handler(params);
  }

  get currentConfig(): Config {
    return this.config;
  }

  /** Effective HTTP listen port (CLI `--port` override or config default). */
  getEffectiveListenPort(): number {
    return resolveEffectiveGatewayPort(this.config, this.serviceConfig.listenPort);
  }


  get cronServiceInstance(): CronService {
    return this.cronService;
  }

  getSkillsApi(lang?: string): { catalog: SkillCatalogEntry[]; managed: ManagedSkillListItem[] } {
    return {
      catalog: this.agentService.getSkillCatalog(lang),
      managed: listManagedSkillDirs(),
    };
  }

  getSkillMarkdownSource(skillName: string, lang?: string): SkillMarkdownPreviewPayload | null {
    return this.agentService.getSkillMarkdownSource(skillName, lang);
  }

  deleteManagedSkill(skillId: string): void {
    removeSkillsLockEntry(skillId);
    deleteManagedSkillDir(skillId);
    this.agentService.refreshSkillsAfterDiskChange();
  }

  installManagedSkillZip(
    buffer: Buffer,
    opts: { skillId?: string; overwrite?: boolean },
  ): { skillId: string; path: string } {
    const result = installSkillFromZip(buffer, opts);
    removeSkillsLockEntry(result.skillId);
    this.agentService.refreshSkillsAfterDiskChange();
    return result;
  }

  async fetchSkillsMarketplaceCatalog(
    params: SkillsStoreListParams,
    provider?: string,
  ): Promise<UnifiedMarketplaceListResponse> {
    return listMarketplacePackages(this.config, params, provider);
  }

  async fetchSkillsMarketplaceCategories(
    provider?: string,
  ): Promise<{ items: MarketplaceCategoryOption[] }> {
    return listMarketplaceCategories(this.config, provider);
  }

  async fetchSkillsMarketplacePackageDetail(
    packageName: string,
    provider?: string,
  ): Promise<UnifiedMarketplacePackageDetail> {
    return getMarketplacePackageDetail(this.config, packageName, provider);
  }

  async installSkillFromMarketplace(opts: {
    name: string;
    version?: string;
    overwrite?: boolean;
    provider?: string;
  }): Promise<{ skillId: string; path: string }> {
    const { buffer, skillId } = await downloadFromMarketplace(
      this.config,
      opts.name,
      opts.version,
      opts.provider,
    );
    return this.installManagedSkillZip(buffer, { skillId, overwrite: opts.overwrite ?? false });
  }

  /**
   * xopc-store extension package preview (type must be `extension`).
   */
  async fetchExtensionMarketplacePackageDetail(packageName: string): Promise<MarketplacePackageDetail> {
    const base = resolveExtensionsStoreBaseUrl(this.config);
    const detail = await fetchMarketplacePackageDetail(base, packageName.trim());
    if (detail.type !== 'extension') {
      throw new Error(
        `Package "${packageName}" is not an extension (store type: ${detail.type}).`,
      );
    }
    return detail;
  }

  private mergeExtensionEnabledIntoConfig(extensionId: string): Config {
    const id = extensionId.trim();
    const prevExt = this.config.extensions;
    const baseExt =
      prevExt && typeof prevExt === 'object' && !Array.isArray(prevExt)
        ? { ...(prevExt as Record<string, unknown>) }
        : {};
    const enabledRaw = baseExt.enabled;
    const enabled = Array.isArray(enabledRaw)
      ? [...enabledRaw.filter((x): x is string => typeof x === 'string')]
      : [];
    if (!enabled.includes(id)) enabled.push(id);

    const disabledRaw = baseExt.disabled;
    const nextExt: Record<string, unknown> = { ...baseExt, enabled };
    if (Array.isArray(disabledRaw)) {
      const next = disabledRaw.filter((x): x is string => typeof x === 'string' && x !== id);
      if (next.length > 0) nextExt.disabled = next;
      else delete nextExt.disabled;
    }

    return {
      ...this.config,
      extensions: nextExt,
    } as Config;
  }

  private mergeExtensionRemovedFromEnabledConfig(extensionId: string): Config {
    const id = extensionId.trim();
    const prevExt = this.config.extensions;
    const baseExt =
      prevExt && typeof prevExt === 'object' && !Array.isArray(prevExt)
        ? { ...(prevExt as Record<string, unknown>) }
        : {};
    const enabledRaw = baseExt.enabled;
    const enabled = Array.isArray(enabledRaw)
      ? enabledRaw.filter((x): x is string => typeof x === 'string' && x !== id)
      : [];
    return {
      ...this.config,
      extensions: { ...baseExt, enabled },
    } as Config;
  }

  /**
   * Install an extension from xopc-store into the global extensions directory (`~/.xopc/extensions`),
   * append its id to `extensions.enabled`, refresh the loader, and emit `config.reload`.
   */
  async installExtensionFromMarketplace(opts: {
    name: string;
    version?: string;
    overwrite?: boolean;
  }): Promise<{ extensionId: string; version: string; requiresGatewayRestart: boolean }> {
    const packageName = opts.name.trim();
    if (!packageName) {
      throw new Error('Package name is required');
    }
    const storeBase = resolveExtensionsStoreBaseUrl(this.config);
    const targetDir = resolveExtensionsDir();
    mkdirSync(targetDir, { recursive: true });

    const { downloadUrl, version } = await resolveExtensionZipDownloadUrl(
      storeBase,
      packageName,
      opts.version,
    );
    const buf = await downloadExtensionStoreZipBuffer(storeBase, downloadUrl);

    if (opts.overwrite) {
      const peekId = peekExtensionIdFromStoreZip(buf);
      if (peekId && existsSync(join(targetDir, peekId))) {
        rmSync(join(targetDir, peekId), { recursive: true, force: true });
      }
    }

    const result = await installExtensionFromStoreZip(buf, targetDir);
    if (!result.ok || !result.extensionId) {
      throw new Error(result.error ?? 'Extension install failed');
    }

    const lock = getExtensionLockfileManager();
    await lock.upsert(result.extensionId, {
      name: result.extensionId,
      version,
      resolved: packageName,
      source: 'store',
    });

    const nextConfig = this.mergeExtensionEnabledIntoConfig(result.extensionId);
    const saved = await this.saveConfig(nextConfig);
    if (!saved.saved) {
      throw new Error(saved.error ?? 'Failed to save config after extension install');
    }

    const channelIdsBefore = new Set(this.channelManager.getAllPlugins().map((p) => p.id));
    let requiresGatewayRestart = false;
    try {
      if (this.extensionLoader) {
        this.extensionLoader.invalidateManifestCache();
        await this.extensionLoader.loadByActivationPlan();
        const reg = this.extensionLoader.getRegistry();
        for (const p of reg.channelPlugins) {
          if (!channelIdsBefore.has(p.id)) {
            requiresGatewayRestart = true;
            break;
          }
        }
      }
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em }, `Extension loader refresh after marketplace install failed: ${em}`);
      requiresGatewayRestart = true;
    }

    this.emit('config.reload', { section: 'extensions', source: 'marketplace-install' });
    return { extensionId: result.extensionId, version, requiresGatewayRestart };
  }

  /**
   * Remove a user-installed (global or per-agent extensions dir) extension from disk and config.
   */
  async uninstallUserExtension(extensionId: string): Promise<{ requiresGatewayRestart: boolean }> {
    const id = extensionId.trim();
    if (!id) {
      throw new Error('extensionId is required');
    }
    const loader = this.extensionLoader;
    if (!loader) {
      throw new Error('Extensions unavailable');
    }
    const discovered = loader.discoverExtensions();
    const ext = discovered.find((e) => e.id === id);
    if (!ext) {
      throw new Error(`Extension not found: ${id}`);
    }
    if (ext.source === 'bundled') {
      throw new Error('Built-in extensions cannot be uninstalled from the marketplace UI');
    }
    if (existsSync(ext.path)) {
      rmSync(ext.path, { recursive: true, force: true });
    }
    await getExtensionLockfileManager().remove(id);
    const nextConfig = this.mergeExtensionRemovedFromEnabledConfig(id);
    const saved = await this.saveConfig(nextConfig);
    if (!saved.saved) {
      throw new Error(saved.error ?? 'Failed to save config after extension uninstall');
    }
    try {
      loader.invalidateManifestCache();
      await loader.loadByActivationPlan();
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em }, `Extension loader refresh after uninstall failed: ${em}`);
    }
    this.emit('config.reload', { section: 'extensions', source: 'marketplace-uninstall' });
    return { requiresGatewayRestart: true };
  }

  getSkillsMarketplaceProvider(): { provider: string; displayName: string } {
    const provider = resolveSkillsMarketplaceProvider(this.config);
    return {
      provider,
      displayName: getMarketplaceProviderDisplayName(provider),
    };
  }

  /** All registered marketplace providers (built-in + extension-contributed). */
  getSkillsMarketplaceProviders(): Array<{ id: string; displayName: string }> {
    return listRegisteredProviders();
  }

  reloadSkillsFromDisk(): void {
    this.agentService.refreshSkillsAfterDiskChange();
  }

  patchSkillEnabled(skillName: string, enabled: boolean): void {
    createSkillConfigManager(resolveStateDir()).setSkillEnabled(skillName, enabled);
    this.agentService.refreshSkillsAfterSkillConfigChange();
  }

  get sessionIndexInstance(): SessionIndex {
    return this.sessionIndex;
  }

  /** @deprecated Use {@link sessionIndexInstance}. */
  get sessionManagerInstance(): SessionIndex {
    return this.sessionIndex;
  }

  async getSessionAgentConfig(sessionKey: string) {
    return this.agentService.getSessionAgentConfig(sessionKey);
  }

  /** Resolved markdown workspace for a session (after hydration / mkdir). Used by workspace file API when `sessionKey` is passed. */
  async getEffectiveWorkspacePathForSession(sessionKey: string): Promise<string> {
    return this.agentService.getEffectiveWorkspacePathForSession(sessionKey);
  }

  async patchSessionAgentConfig(sessionKey: string, body: {
    thinkingLevel?: string;
    model?: string | null;
    reasoningLevel?: string;
    workingDirectory?: string;
  }) {
    return this.agentService.patchSessionAgentConfig(sessionKey, body);
  }

  /**
   * Process a message directly through the agent (for CLI mode)
   */
  async processDirect(content: string, sessionKey = 'cli:direct'): Promise<string> {
    return this.agentService.processDirect(content, sessionKey);
  }

  // ========== SSE Event System ==========

  /**
   * Subscribe to server-pushed events.
   * Returns a cleanup function to unsubscribe.
   */
  subscribe(sessionId: string, listener: (event: ServiceEvent) => Promise<void> | void): () => void {
    return this.sse.subscribe(sessionId, listener);
  }

  /**
   * Emit an event to all subscribers.
   */
  emit(type: string, payload: unknown): void {
    this.sse.emit(type, payload);
  }

  /**
   * Get events since a given event id (for Last-Event-ID reconnection).
   */
  getEventsSince(sessionId: string, lastEventId: string): ServiceEvent[] {
    return this.sse.getEventsSince(sessionId, lastEventId);
  }

  // ========== Session Management API ==========

  /**
   * List sessions with query filters
   */
  async listSessions(query?: SessionListQuery) {
    return this.sessionIndex.listSessions(query);
  }

  /**
   * List all subagent sessions.
   * Subagent sessions have keys starting with 'subagent:'.
   */
  async listSubagents(query?: SessionListQuery) {
    return this.sessionIndex.listSubagents(query);
  }

  /**
   * Get a single session by key
   */
  async getSession(
    key: string,
    options?: { includeTranscriptSummary?: boolean; includeTranscriptRows?: boolean },
  ) {
    return this.sessionIndex.getSession(key, options);
  }

  async getSessionMessagePage(
    key: string,
    options?: {
      offset?: number;
      limit?: number;
      before?: string;
      includeTranscriptSummary?: boolean;
      includeTranscriptRows?: boolean;
    },
  ) {
    return this.sessionIndex.getSessionMessagePage(key, options);
  }

  /**
   * Partial session metadata update (OpenClaw-style sessions.patch subset).
   */
  async patchSession(
    key: string,
    body: SessionPatchBody,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.sessionIndex.patchSession(key, body);
  }

  async listSessionCompactionCheckpoints(key: string) {
    return this.sessionIndex.listCompactionCheckpoints(key);
  }

  async getSessionCompactionCheckpoint(key: string, checkpointId: string) {
    return this.sessionIndex.getCompactionCheckpointDetail(key, checkpointId);
  }

  async restoreSessionCompactionCheckpoint(key: string, checkpointId: string): Promise<void> {
    await this.sessionIndex.restoreCompactionCheckpoint(key, checkpointId);
    this.agentService.evictSessionAgent(key);
  }

  async runSessionCompaction(
    key: string,
    options?: { instructions?: string; force?: boolean },
  ): Promise<CompactionResult> {
    const result = await this.agentService.compactSession(key, options);
    if (result.compacted) {
      void this.sessionIndex
        .appendTranscriptContextEntry(key, {
          text: 'Session transcript compacted',
          data: {
            firstKeptIndex: result.firstKeptIndex,
            tokensBefore: result.tokensBefore,
            tokensAfter: result.tokensAfter,
            summaryPreview: result.summary.slice(0, 500),
          },
        })
        .catch(() => {});
    }
    return result;
  }

  /**
   * Delete a session
   */
  async deleteSession(key: string): Promise<{ deleted: boolean }> {
    const result = await this.sessionIndex.deleteSession(key);
    if (result) {
      this.agentService.evictSessionAgent(key);
      await retireSessionMcpRuntimeForSessionKey({ sessionKey: key, reason: 'session-delete' });
    }
    return { deleted: result };
  }

  /**
   * Delete multiple sessions
   */
  async deleteSessions(keys: string[]): Promise<{ success: string[]; failed: string[] }> {
    return this.sessionIndex.deleteSessions(keys);
  }

  /**
   * Rename a session
   */
  async renameSession(key: string, name: string): Promise<{ renamed: boolean }> {
    await this.sessionIndex.renameSession(key, name);
    return { renamed: true };
  }

  /**
   * Tag a session
   */
  async tagSession(key: string, tags: string[]): Promise<{ tagged: boolean }> {
    await this.sessionIndex.tagSession(key, tags);
    return { tagged: true };
  }

  /**
   * Remove tags from a session
   */
  async untagSession(key: string, tags: string[]): Promise<{ untagged: boolean }> {
    await this.sessionIndex.untagSession(key, tags);
    return { untagged: true };
  }

  /**
   * Archive a session
   */
  async archiveSession(key: string): Promise<{ archived: boolean }> {
    await this.sessionIndex.archiveSession(key);
    return { archived: true };
  }

  /**
   * Unarchive a session
   */
  async unarchiveSession(key: string): Promise<{ unarchived: boolean }> {
    await this.sessionIndex.unarchiveSession(key);
    return { unarchived: true };
  }

  /**
   * Pin a session
   */
  async pinSession(key: string): Promise<{ pinned: boolean }> {
    await this.sessionIndex.pinSession(key);
    return { pinned: true };
  }

  /**
   * Unpin a session
   */
  async unpinSession(key: string): Promise<{ unpinned: boolean }> {
    await this.sessionIndex.unpinSession(key);
    return { unpinned: true };
  }

  /**
   * Search sessions
   */
  async searchSessions(query: string) {
    return this.sessionIndex.searchSessions(query);
  }

  /**
   * Search within a session
   */
  async searchInSession(key: string, keyword: string) {
    return this.sessionIndex.searchInSession(key, keyword);
  }

  /**
   * Export a session
   */
  async exportSession(key: string, format: ExportFormat): Promise<{ content: string }> {
    const content = await this.sessionIndex.exportSession(key, format);
    return { content };
  }

  /**
   * Get session statistics
   */
  async getSessionStats() {
    return this.sessionIndex.getStats();
  }

  /**
   * Get unique chat IDs from sessions, grouped by channel
   * Returns a list of channel/chatId pairs for cron job configuration.
   * `chatId` is the session-store routing suffix (unique per bot account + peer).
   * When `routing` exists, `peerId` is the platform id (e.g. Telegram numeric chat id).
   */
  async getSessionChatIds(channel?: string): Promise<
    Array<{
      channel: string;
      chatId: string;
      lastActive: string;
      accountId?: string;
      peerKind?: string;
      peerId?: string;
    }>
  > {
    return getDistinctSessionChatIds(this.sessionIndex, channel);
  }

  /**
   * Validate authentication token from request headers.
   * Returns true if auth is disabled (mode: 'none') or token is valid.
   */
  validateAuth(headers?: Record<string, string | string[] | undefined>): boolean {
    const token = extractToken(headers);
    return validateToken(this.auth, token);
  }

  /**
   * Get current auth mode.
   */
  getAuthMode(): 'none' | 'token' | 'password' | 'trusted-proxy' {
    return this.auth.mode;
  }

  /** Resolved gateway auth (mode, credentials, trusted-proxy config). */
  getResolvedAuth(): ResolvedGatewayAuth {
    return this.auth;
  }

  /**
   * Get current auth token (for CLI server integration).
   * Returns undefined if mode is not token.
   */
  getAuthToken(): string | undefined {
    return this.auth.mode === 'token' ? this.auth.token : undefined;
  }

  /**
   * Refresh (regenerate) the gateway auth token.
   * Returns the new token.
   */
  async refreshAuthToken(): Promise<string> {
    if (this.auth.mode !== 'token') {
      throw new Error('Cannot refresh token: auth mode is not token');
    }

    // Generate new token
    const newToken = crypto.randomBytes(24).toString('hex');
    
    // Update in-memory auth
    this.auth.token = newToken;
    
    // Update config
    this.config = {
      ...this.config,
      gateway: {
        ...this.config.gateway,
        auth: {
          ...this.config.gateway?.auth,
          mode: 'token',
          token: newToken,
        },
      },
    };
    
    await this.writeConfigAndReloadFromDisk(this.config);

    log.info({ tokenPreview: `${newToken.slice(0, 8)}...` }, 'Gateway token refreshed');
    
    return newToken;
  }
}

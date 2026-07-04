import crypto from 'crypto';
import { listAgentEntries, normalizeAgentId, resolveDefaultAgentId } from '../agent/agent-scope.js';
import { AgentService } from '../agent/service.js';
import { ensureStarterAgentsInitialized } from '../agent/starter-agents.js';
import { ChannelManager } from '../channels/manager.js';
import {
  buildChannelCatalogForConfig,
  buildChannelCatalogFromSnapshot,
} from '../channels/catalog/channel-catalog-service.js';
import { setPairingBroadcastSink } from '../channels/pairing/pairing-events.js';
import { MessageBus, MessageBusShutdownError } from '../infra/bus/index.js';
import { loadConfig, saveConfig as writeConfigToDisk } from '../config/index.js';
import { getWorkspacePath } from '../config/workspace-path-helpers.js';
import { AutomationService } from '../automations/index.js';
import { onAutomationProductEvent, publishAutomationProductEvent } from '../automations/product-events.js';
import { buildNoteAgentContext, NotesService, NotesStore } from '../notes/index.js';
import { buildWorkflowChildTools } from '../agent/workflow/workflow-child-tools.js';
import { WorkflowRunService } from '../workflows/service/workflow-run-service.js';
import { WorkflowSessionBridge } from '../workflows/service/workflow-session-bridge.js';
import { ExtensionLoader, areExtensionsGloballyDisabled, buildExtensionMetadataSnapshot } from '../extensions/index.js';
import type { ManifestRegistryEntry } from '../extensions/manifest-registry.js';
import type { ResolvedExtensionConfig } from '../extensions/types/index.js';
import { HeartbeatService, heartbeatRunnerConfigFromConfig } from './heartbeat/index.js';
import { SessionIndex } from '../session/index.js';
import { onSessionTranscriptUpdate } from '../session/transcript-events.js';
import type { Config } from '../config/schema.js';
import { getAgentDefaultModelRef } from '../config/schema.js';
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
import { buckets, isGatewayStrictSecurityEnabled } from './rate-limit/index.js';
import { prewarmModelRegistry } from '../providers/index.js';
import { createLogger, getLogDir, getRuntimeLogStats } from '../utils/logger.js';
import {
  resolveConfigPath,
  resolveAgentDir,
  resolveExtensionsDir,
} from '../config/paths.js';
import { AgentRunRelay, type RelayEvent } from './agent-run-relay.js';
import { registerClarifyBridge } from './clarify-runtime.js';
import { PACKAGE_VERSION } from '../package-version.js';
import { GoalNotificationService, GoalRunner, type EnqueueGoalRunOptions } from '../goals/index.js';

import { disposeAllSessionMcpRuntimes } from '../agent/mcp/bundle-mcp-tools.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';
import { buildSessionKey, sanitizeSegment } from '../routing/session-key.js';
import { scheduleGatewayUpdateCheck } from '../infra/update-startup.js';
import { resolveChannelConnectDeferSet } from './resolve-channel-connect-defer.js';
import { restartGatewayProcessWithFreshPid } from './respawn.js';
import { GatewaySessionsApi } from './service/sessions-api.js';
import { GatewayMarketplaceService } from './service/marketplace-service.js';
import { GatewayConfigCoordinator } from './service/config-coordinator.js';
import { GatewayAgentRunner } from './service/agent-runner.js';
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
import { closeXopcDatabase, openXopcDatabase } from '../storage/sqlite/index.js';
import { startConnectorSupervisor, type ConnectorSupervisor } from '../connectors/supervisor.js';

export type {
  GatewayChannelStartupPhase1Metrics,
  GatewayChannelStartupPhase2Metrics,
  GatewayServiceConfig,
  ServiceEvent,
} from './service/types.js';

const log = createLogger('Gateway:Service');

export class GatewayService {
  private bus: MessageBus;
  private config: Config;
  private configPath: string;
  private _agentService: AgentService | null = null;
  private channelManager: ChannelManager;
  private automationService: AutomationService;
  private notesService: NotesService;
  private extensionLoader: ExtensionLoader | null = null;
  private extensionMetadataSnapshot: import('../extensions/extension-metadata-snapshot.js').ExtensionMetadataSnapshot | null = null;
  private browserExtensionProvider: import('../browser/providers/extension.js').ExtensionBrowserProvider | null = null;
  private browserExtensionRelease: (() => Promise<void>) | null = null;
  /** `${host}:${port}` when the gateway holds the extension bridge listener. */
  private browserExtensionBindKey: string | null = null;
  private heartbeatService: HeartbeatService | null = null;
  private sessionIndex: SessionIndex;
  private running = false;
  private startTime = Date.now();
  private workspacePath: string;
  private readonly configCoordinator: GatewayConfigCoordinator;

  // Authentication
  private auth: ResolvedGatewayAuth;

  private readonly sse = new GatewaySseHub();

  getConfig(): Config {
    return this.config;
  }

  private stopGatewayUpdateCheck: (() => void) | null = null;

  /** When set (e.g. by `GatewayServer`), `triggerGatewayProcessRestart` can stop HTTP then exit. */
  private gatewayShutdownForRestart: (() => Promise<void>) | null = null;

  /** Snapshot for phase-2 metrics / logs (ids deferred at phase-1 `start()`). */
  private lastDeferredChannelConnectIds: string[] = [];
  private lastChannelConnectDeferMode: 'auto' | 'off' | 'explicit' = 'auto';
  private lastChannelConnectDeferSource: 'off' | 'explicit' | 'meta' = 'off';

  private readonly readiness = new GatewayReadiness();
  private startupTrace: GatewayStartupTrace | null = null;
  private workflowSessionBridge: WorkflowSessionBridge | null = null;
  private workflowRunServiceInstance: WorkflowRunService | null = null;
  private goalRunner: GoalRunner | null = null;
  private goalNotifications: GoalNotificationService | null = null;
  private connectorSupervisor: ConnectorSupervisor | null = null;
  private stopAutomationProductEventBridge: (() => void) | null = null;
  private stopSessionTranscriptAutomationEvents: (() => void) | null = null;

  /**
   * Webchat agent invocation surface (`runAgent`, `abortAgentRun`, `steer*`,
   * `submitClarifyResponse`, clarify-bridge dispatch). Owns the
   * `activeWebchatRunBySession` + `runAbortControllers` maps.
   */
  readonly agentRunner: GatewayAgentRunner;

  /** Read-only alias re-exported from `agentRunner.runRelay` for legacy callers. */
  get runRelay(): AgentRunRelay { return this.agentRunner.runRelay; }

  /**
   * Session CRUD / search / compaction / tag-archive-pin / stats — the gateway
   * REST surface for sessions. Routes should depend on this narrow service
   * rather than the full GatewayService composition root.
   */
  readonly sessions: GatewaySessionsApi;

  /**
   * Skills + extensions marketplace surface (browse / install / uninstall) plus
   * local-only managed-skill ops. Routes depend on this narrow service.
   */
  readonly marketplace: GatewayMarketplaceService;

  constructor(private serviceConfig: GatewayServiceConfig = {}) {
    this.bus = new MessageBus();
    this.configPath = serviceConfig.configPath || resolveConfigPath();
    this.config = loadConfig(this.configPath);
    const starterResult = ensureStarterAgentsInitialized(this.config);
    if (starterResult.changed) {
      this.config = starterResult.config;
      void writeConfigToDisk(this.config, this.configPath).catch((err) => {
        const em = err instanceof Error ? err.message : String(err);
        log.warn({ err, phase: 'starter_agents_init', errorMessage: em }, `Starter agents init persist failed: ${em}`);
      });
    }
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

    // Session index + files shared with AgentService for chat transcript and goal execution context.
    this.sessionIndex = new SessionIndex({
      config: this.config,
    });

    this.automationService = new AutomationService();

    this.notesService = new NotesService(new NotesStore());

    this.agentRunner = new GatewayAgentRunner({
      bus: this.bus,
      sessionIndex: this.sessionIndex,
      getAgentService: () => this.ensureAgentService(),
      getChannelManager: () => this.channelManager,
      getConfig: () => this.config,
      emit: (type, payload) => this.sse.emit(type, payload),
    });

    this.sessions = new GatewaySessionsApi({
      sessionIndex: this.sessionIndex,
      getAgentService: () => this.ensureAgentService(),
      getActiveWebchatRunId: (sk) => this.agentRunner.getActiveRunId(sk),
    });

    this.marketplace = new GatewayMarketplaceService({
      getConfig: () => this.config,
      getAgentService: () => this.ensureAgentService(),
      getExtensionLoader: () => this.extensionLoader,
      getChannelManager: () => this.channelManager,
      saveConfig: (cfg) => this.saveConfig(cfg),
      emit: (type, payload) => this.emit(type, payload),
    });

    this.configCoordinator = new GatewayConfigCoordinator({
      configPath: this.configPath,
      bus: this.bus,
      enableHotReload: this.serviceConfig.enableHotReload !== false,
      getConfig: () => this.config,
      setConfig: (next) => { this.config = next; },
      getAgentService: () => this.ensureAgentService(),
      getChannelManager: () => this.channelManager,
      getHeartbeatService: () => this.heartbeatService,
      getExtensionLoader: () => this.extensionLoader,
      reconcileBrowserExtensionServer: () => this.reconcileBrowserExtensionServer(),
      getChannelsStatus: () => this.getChannelsStatus(),
      emit: (type, payload) => this.emit(type, payload),
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

    this._agentService = new AgentService(this.bus, {
      workspace: this.workspacePath,
      model: getAgentDefaultModelRef(this.config),
      config: this.config,
      sessionStore: this.sessionIndex.getStore(),
      onSessionMetadataUpdated: (sessionKey, patch) => {
        this.sessionIndex.emit('sessionUpdated', { key: sessionKey, name: patch?.name });
        this.emit('session.updated', { key: sessionKey, name: patch?.name });
      },
      onSessionTranscriptUpdated: (sessionKey) => {
        this.emit('session.transcript_updated', { key: sessionKey });
      },
      onGoalStatusUpdated: (payload) => {
        this.emit('goal.status.updated', payload);
      },
      onSkillsUpdated: (payload) => {
        this.emit('config.reload', {
          section: 'skills',
          source: payload.reason === 'disk' ? 'skills-filesystem' : 'skills-config',
        });
      },
      extensionRegistry: this.extensionLoader?.getRegistry(),
      getAutomationService: () => this.automationService,
      getWorkflowRunService: () => this.createWorkflowRunService(),
      sourceContextResolver: async (binding) => {
        if (binding.kind !== 'note') return null;
        const note = await this.notesService.getNote(binding.sourceId);
        if (!note) return null;
        return buildNoteAgentContext({
          note,
          notesService: this.notesService,
          config: this.config,
        });
      },
      gatewayClarify: {
        requestClarification: (sessionKey, request) =>
          this.agentRunner.requestClarification({
            sessionKey,
            request,
            publishSseFor: (_runId) => (e: RelayEvent) => {
              this._agentService!.turnDispatcher.enqueueWebchatSseEvent(sessionKey, e);
            },
          }),
      },
    });

    this._agentService.setChannelManager(this.channelManager);
    this.channelManager.setSessionModelHooks({
      getModelForSession: (sk) => this._agentService!.getModelForSession(sk),
      switchModelForSession: (sk, id) => this._agentService!.switchModelForSession(sk, id),
    });

    this.automationService.setDeps({
      agentService: this._agentService,
      getDefaultAgentId: () => getDefaultAgentId(this.config),
      workflowRunService: this.createWorkflowRunService(),
    });

    this._agentService.persistentGoals.setWebchatContinuationScheduler((sessionKey, message) => {
      const scheduleWhenIdle = () => {
        if (this._agentService!.getInboundTurnDepth(sessionKey) > 0) {
          setTimeout(scheduleWhenIdle, 50);
          return;
        }
        if (this.agentRunner.hasActiveRun(sessionKey)) {
          setTimeout(scheduleWhenIdle, 50);
          return;
        }
        void this.agentRunner.drainScheduledWebchatContinuation(sessionKey, message);
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
      sessionStore: this.sessionIndex.getStore(),
      getConfig: () => this.config,
    });
    return this.heartbeatService;
  }

  // ── Webchat agent runner (delegated to GatewayAgentRunner) ────────────

  private createGoalRunner(): GoalRunner {
    if (!this.goalRunner) {
      this.goalRunner = new GoalRunner({
        maxConcurrent: 1,
        defaultMaxRetries: 2,
        ensureSession: async (goal) => {
          const existing = goal.activeSessionKey?.trim();
          if (existing) return existing;
          const agentId = goal.agentId || getDefaultAgentId(this.config);
          const peerId = `goal-${sanitizeSegment(goal.id) || Date.now()}`;
          const sessionKey = buildSessionKey({
            agentId,
            source: 'webchat',
            accountId: 'default',
            peerKind: 'direct',
            peerId,
          });
          await this.sessionIndex.saveMessages(sessionKey, [], {
            metadata: {
              sourceChannel: 'webchat',
              sourceChatId: `default:direct:${peerId}`,
              sessionType: 'chat',
              routing: {
                agentId,
                source: 'webchat',
                accountId: 'default',
                peerKind: 'direct',
                peerId,
              },
            },
          });
          const { GoalService } = await import('../goals/index.js');
          new GoalService().attachSession(goal.id, sessionKey);
          return sessionKey;
        },
        hasActiveRun: (sessionKey) => this.agentRunner.hasActiveRun(sessionKey),
        runTurn: (sessionKey, userTurn) =>
          this.agentRunner.runScheduledWebchatTurn(sessionKey, userTurn),
        emit: (type, payload) => this.emit(type, payload),
      });
    }
    return this.goalRunner;
  }

  private createGoalNotificationService(): GoalNotificationService {
    if (!this.goalNotifications) {
      this.goalNotifications = new GoalNotificationService({
        getConfig: () => this.config,
        getSessionMetadata: (sessionKey) => this.sessionIndex.getSessionMetadata(sessionKey),
        send: async (target) => {
          await this.channelManager.send({
            channel: target.channel,
            chat_id: target.chatId,
            content: target.text,
            type: 'message',
            silent: target.silent,
            metadata: {
              accountId: target.accountId,
              threadId: target.threadId,
              source: 'goal-notification',
            },
          });
        },
      });
    }
    return this.goalNotifications;
  }

  enqueueGoalRun(goalId: string, options?: EnqueueGoalRunOptions) {
    return this.createGoalRunner().enqueue(goalId, options);
  }

  getGoalQueueSnapshot() {
    return this.createGoalRunner().snapshot();
  }

  runAgent(
    ...args: Parameters<GatewayAgentRunner['runAgent']>
  ): ReturnType<GatewayAgentRunner['runAgent']> {
    return this.agentRunner.runAgent(...args);
  }

  abortAgentRun(runId: string): boolean {
    return this.agentRunner.abortAgentRun(runId);
  }

  getActiveWebchatRunId(sessionKey: string): string | undefined {
    return this.agentRunner.getActiveRunId(sessionKey);
  }

  steerWebchatAgent(
    sessionKey: string,
    message: string,
  ): ReturnType<GatewayAgentRunner['steerWebchatAgent']> {
    return this.agentRunner.steerWebchatAgent(sessionKey, message);
  }

  submitClarifyResponse(requestId: string, answer: string): boolean {
    return this.agentRunner.submitClarifyResponse(requestId, answer);
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

  private findChannelContributionExtension(channelId: string): ManifestRegistryEntry | undefined {
    const normalized = channelId.trim().toLowerCase();
    const registry = this.extensionLoader?.getManifestRegistry();
    if (!registry) return undefined;
    return registry
      .getAllEntries()
      .find((entry) => Object.keys(entry.manifest.channelContributions ?? {}).some((id) => id.toLowerCase() === normalized));
  }

  async ensureChannelRuntimePlugin(channelId: string) {
    const existing = this.channelManager.getPlugin(channelId);
    if (existing) {
      await this.channelManager.initializeChannel(channelId);
      return this.channelManager.getPlugin(channelId);
    }

    if (!this.extensionLoader || areExtensionsGloballyDisabled(this.config)) {
      return undefined;
    }

    const entry = this.findChannelContributionExtension(channelId);
    if (!entry) {
      return undefined;
    }

    const extensionConfig: ResolvedExtensionConfig = {
      id: entry.id,
      name: entry.manifest.name || entry.id,
      source: entry.source,
      path: entry.path,
      enabled: true,
      config: {},
    };
    await this.extensionLoader.loadExtension(extensionConfig);
    this.registerExtensionChannelPlugins();
    const plugin = this.channelManager.getPlugin(channelId);
    if (!plugin) {
      return undefined;
    }
    await this.channelManager.initializeChannel(channelId);
    return this.channelManager.getPlugin(channelId);
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
    openXopcDatabase();
    this.startTime = Date.now();
    this.running = true;
    this.startupTrace = createGatewayStartupTrace();
    this.readiness.markStarting(this.startTime);
    const trace = this.startupTrace;

    registerClarifyBridge(this.agentRunner.getClarifyBridge());

    this.ensureAgentService();

    this.channelManager.setOutboundHooks({
      runMessageSending: (to, content, channel) =>
        this.agentService.outboundCoordinator.invokeOutboundMessageSending(to, content, channel),
      runMessageSent: (to, content, success, error, channel) =>
        this.agentService.outboundCoordinator.invokeOutboundMessageSent(to, content, success, error, channel),
    });
    this.channelManager.enableOutboundPersistence(resolveAgentDir(this.config, getDefaultAgentId(this.config)));

    if (this.extensionLoader) {
      this.extensionLoader.setRuntimeContext({
        bus: this.bus,
        sessionManager: this.sessionIndex,
        scheduleWebchatContinuation: (sessionKey: string, continuationMessage: string) => {
          queueMicrotask(() => {
            void this.agentRunner.drainScheduledWebchatContinuation(sessionKey, continuationMessage);
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

    this.automationService.setDeps({
      agentService: this.agentService,
      getDefaultAgentId: () => getDefaultAgentId(this.config),
      workflowRunService: this.createWorkflowRunService(),
    });
    this.startAutomationProductEventBridge();

    await trace.measure('workflows.reconcile', () => this.reconcileInterruptedWorkflowRuns());

    this.sessionIndex.on('sessionUpdated', (data: { key: string; name?: string; tags?: string[] }) => {
      this.emit('session.updated', { key: data.key, name: data.name, tags: data.tags });
    });

    await trace.measure('automations.initialize', () => this.automationService.initialize());

    await this.notesService.initialize();

    this.ensureHeartbeatService().start(heartbeatRunnerConfigFromConfig(this.config));

    this.connectorSupervisor = startConnectorSupervisor({
      getConfig: () => this.config,
      saveConfig: (cfg) => this.saveConfig(cfg),
    });

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
      this.configCoordinator.startHotReloader();
    }

    this.stopGatewayUpdateCheck = scheduleGatewayUpdateCheck({
      config: this.config,
      onUpdateAvailableChange: (update) => {
        this.emit('update.available', update);
      },
      triggerInProcessRestart: () => this.triggerGatewayProcessRestart(),
    });

    wireTunnelEventsToGateway(this);

    // Drop orphan single-HTML site-share staging dirs left behind by a
    // process death between create and cleanup. Re-registers live ones into
    // the in-process map so post-restart revoke/expire still cleans them.
    void import('../share/share-auto.js')
      .then(({ runStagingSweep }) => runStagingSweep())
      .catch((err) => log.warn({ err }, 'Share staging sweep failed'));

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
    if (this.readiness.isReady()) {
      return;
    }
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
    await this.applyStartupReadyDelayForTesting();
    this.markGatewayReady();

    await this.runExposureAutoStartIfConfigured();

    if (this.serviceConfig.deferChannelConnectUntilAfterHttp !== true) {
      return;
    }
    const listenStartedAt = performance.now();
    const trace = this.startupTrace;
    try {
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

    await this.configCoordinator.stopHotReloader();

    // Stop heartbeat service
    this.heartbeatService?.stop();
    this.connectorSupervisor?.stop();
    this.connectorSupervisor = null;

    // Stop browser extension WS server (shared acquire/release with BrowserManager)
    if (this.browserExtensionRelease) {
      await this.browserExtensionRelease();
      this.browserExtensionRelease = null;
    }
    this.browserExtensionProvider = null;
    this.browserExtensionBindKey = null;

    registerClarifyBridge(null);
    this.agentRunner.disposeClarifyBridge();
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

    await this.automationService.stop();
    this.stopAutomationProductEventBridge?.();
    this.stopAutomationProductEventBridge = null;
    this.stopSessionTranscriptAutomationEvents?.();
    this.stopSessionTranscriptAutomationEvents = null;

    // Flush notes to disk
    await this.notesService.flush();

    // Tear down rate-limit cleanup timers so the process can exit cleanly.
    buckets.destroyAll();

    closeXopcDatabase();

    log.debug('Gateway service stopped');
  }

  /** Start the browser extension WS server when backend is 'extension'. */
  private async startBrowserExtensionServerIfNeeded(): Promise<void> {
    await this.reconcileBrowserExtensionServer();
  }

  /** Release the gateway's hold on the shared extension bridge (does not restart). */
  async releaseBrowserExtensionBridge(): Promise<void> {
    if (!this.browserExtensionRelease) return;
    await this.browserExtensionRelease();
    this.browserExtensionRelease = null;
    this.browserExtensionProvider = null;
    this.browserExtensionBindKey = null;
    log.debug('Browser extension WS server released');
  }

  /**
   * Start/stop/rebind the Chrome extension bridge.
   * PATCH saves update config in memory without re-running gateway startup, so this must run on save too.
   */
  async reconcileBrowserExtensionServer(): Promise<void> {
    const { shouldRunExtensionBridgeServer } = await import('../browser/backend-from-config.js');
    const wantsExtension = shouldRunExtensionBridgeServer(this.config);

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

    const port = 19820;
    const host = '127.0.0.1';
    const connectionTimeout = undefined;
    const commandTimeout = undefined;
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
      const { provider, release } = await acquireExtensionBrowserServer({
        port,
        host,
        connectionTimeout,
        commandTimeout,
      });
      this.browserExtensionProvider = provider;
      this.browserExtensionRelease = release;
      this.browserExtensionBindKey = bindKey;
      log.info({ port, host }, 'Browser extension WS server started');
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code: unknown }).code : undefined;
      if (code === 'EADDRINUSE') {
        log.warn(
          {
            err,
            phase: 'browser_extension_ws',
            bindPort: port,
            bindHost: host,
            hint: 'Another process holds the browser extension bridge port 19820. Stop it before starting xopc.',
          },
          `Browser extension WS server port is already in use: ${host}:${port}`,
        );
        return;
      }

      log.error(
        { err, phase: 'browser_extension_ws' },
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

  // ── Config persistence / hot reload (delegated to GatewayConfigCoordinator) ──

  reloadHeartbeatFromCurrentConfig(): void {
    this.configCoordinator.reloadHeartbeatFromCurrentConfig();
  }

  reloadConfig(): Promise<{ reloaded: boolean; error?: string }> {
    return this.configCoordinator.reloadConfig();
  }

  afterWeixinCredentialsPersisted(): Promise<void> {
    return this.configCoordinator.afterWeixinCredentialsPersisted();
  }

  afterFeishuCredentialsPersisted(): Promise<void> {
    return this.configCoordinator.afterFeishuCredentialsPersisted();
  }

  saveConfig(config: Config): Promise<{ saved: boolean; error?: string }> {
    return this.configCoordinator.saveConfig(config);
  }

  setBundledExtensionActivationTarget(
    extensionId: string,
    wanted: boolean,
  ): Promise<{ ok: boolean; error?: string; requiresGatewayRestart: boolean }> {
    return this.configCoordinator.setBundledExtensionActivationTarget(extensionId, wanted);
  }

  updateConfig(updates: Partial<Config>): Promise<{ updated: boolean; error?: string }> {
    return this.configCoordinator.updateConfig(updates);
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
    const catalog = this.extensionMetadataSnapshot
      ? buildChannelCatalogFromSnapshot(this.extensionMetadataSnapshot)
      : buildChannelCatalogForConfig(this.config);

    return catalog.entries.map((entry) => ({
      name: entry.id,
      enabled: channels?.[entry.id]?.enabled === true,
      connected: runningChannels.has(entry.id),
    }));
  }

  getRunningChannelIds(): string[] {
    return this.channelManager.getRunningChannels();
  }

  getChannelRuntimePlugin(channelId: string) {
    return this.channelManager.getPlugin(channelId);
  }

  async restartChannel(channelId: string): Promise<void> {
    await this.channelManager.stopChannel(channelId);
    await this.channelManager.startChannel(channelId);
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
    const catalog = this.extensionMetadataSnapshot
      ? buildChannelCatalogFromSnapshot(this.extensionMetadataSnapshot)
      : buildChannelCatalogForConfig(this.config);

    return catalog.entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: entry.description ?? '',
      manageable: true,
      order: entry.order,
    })).toSorted((a, b) => {
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
    const logStats = getRuntimeLogStats();
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

  get currentWorkspacePath(): string {
    return this.workspacePath;
  }

  get messageBusInstance(): MessageBus {
    return this.bus;
  }

  /** Effective HTTP listen port (CLI `--port` override or config default). */
  getEffectiveListenPort(): number {
    return resolveEffectiveGatewayPort(this.config, this.serviceConfig.listenPort);
  }

  get automationServiceInstance(): AutomationService {
    return this.automationService;
  }

  get notesServiceInstance(): NotesService {
    return this.notesService;
  }

  get sessionIndexInstance(): SessionIndex {
    return this.sessionIndex;
  }

  /** Shared workflow run orchestrator + session bridge (one instance per gateway). */
  createWorkflowRunService(): WorkflowRunService {
    if (!this.workflowRunServiceInstance) {
      this.workflowSessionBridge = new WorkflowSessionBridge(this);
      this.workflowRunServiceInstance = new WorkflowRunService({
        service: this,
        sessionBridge: this.workflowSessionBridge,
        buildChildTools: buildWorkflowChildTools,
      });
    }
    return this.workflowRunServiceInstance;
  }

  private async reconcileInterruptedWorkflowRuns(): Promise<void> {
    const workflowService = this.createWorkflowRunService();
    const agentIds = this.collectWorkflowAgentIds();
    let total = 0;
    for (const agentId of agentIds) {
      try {
        total += await workflowService.reconcileInterruptedRuns(agentId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, agentId, errorMessage: msg },
          `Workflow run reconcile failed for agent ${agentId}: ${msg}`,
        );
      }
    }
    if (total > 0) {
      log.info({ count: total, agentIds }, 'Reconciled interrupted workflow runs');
    }
  }

  private collectWorkflowAgentIds(): string[] {
    const ids = new Set<string>();
    ids.add(resolveDefaultAgentId(this.config));
    for (const entry of listAgentEntries(this.config)) {
      if (entry.enabled === false) continue;
      ids.add(normalizeAgentId(entry.id));
    }
    return [...ids];
  }

  /** Process a message directly through the agent (for CLI mode). */
  async processDirect(content: string, sessionKey = 'agent:main:main'): Promise<string> {
    return this.agentService.turnDispatcher.processDirect(content, sessionKey);
  }

  // ========== SSE Event System ==========

  subscribe(
    sessionId: string,
    listener: (event: ServiceEvent) => Promise<void> | void,
  ): () => void {
    return this.sse.subscribe(sessionId, listener);
  }

  emit(type: string, payload: unknown): void {
    this.sse.emit(type, payload);
    this.createGoalNotificationService().handleGatewayEvent(type, payload);
  }

  private startAutomationProductEventBridge(): void {
    this.stopAutomationProductEventBridge?.();
    this.stopSessionTranscriptAutomationEvents?.();
    this.stopAutomationProductEventBridge = onAutomationProductEvent((event) => {
      void this.automationService.triggerEvent(event).catch((err) => {
        const em = err instanceof Error ? err.message : String(err);
        log.warn({ err, eventType: event.type, source: event.source }, `Automation product event failed: ${em}`);
      });
    });
    this.stopSessionTranscriptAutomationEvents = onSessionTranscriptUpdate((update) => {
      if (!update.sessionKey || update.sessionKey.includes(':automation:')) return;
      publishAutomationProductEvent({
        type: 'session.transcript.updated',
        source: 'sessions',
        payload: {
          sessionKey: update.sessionKey,
          messageId: update.messageId,
          hasMessage: update.message !== undefined,
        },
      });
    });
  }

  /** Replay events since `lastEventId` for SSE reconnection. */
  getEventsSince(sessionId: string, lastEventId: string): ServiceEvent[] {
    return this.sse.getEventsSince(sessionId, lastEventId);
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
    
    await this.saveConfig(this.config);

    log.info({ tokenPreview: `${newToken.slice(0, 8)}...` }, 'Gateway token refreshed');
    
    return newToken;
  }
}

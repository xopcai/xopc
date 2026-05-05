import crypto from 'crypto';
import { AgentService } from '../agent/service.js';
import { ChannelManager } from '../channels/manager.js';
import { CHAT_CHANNEL_ORDER } from '../channels/registry.js';
import { MessageBus, MessageBusShutdownError } from '../infra/bus/index.js';
import type { Config as SurfaceConfig } from '../config/config-surface.js';
import { loadConfig, saveConfig as writeConfigToDisk } from '../config/index.js';
import { getWorkspacePath } from '../config/schema.js';
import { CronService } from '../cron/index.js';
import { computeBundledExtensionExtensionsPatch } from '../extensions/bundled-extension-activation.js';
import { ExtensionLoader } from '../extensions/index.js';
import { HeartbeatService, heartbeatRunnerConfigFromConfig } from './heartbeat/index.js';
import { ConfigHotReloader } from '../config/reload.js';
import { SessionManager } from '../session/index.js';
import type { Config } from '../config/schema.js';
import type { SessionListQuery, ExportFormat } from '../session/types.js';
import { resolveGatewayAuth, assertGatewayAuthConfigured, validateToken, extractToken, type ResolvedGatewayAuth } from './auth.js';
import { assertGatewayAuthNotKnownWeak } from './security/known-weak-secrets.js';
import { auditGatewayConfig } from './security/audit.js';
import { getModelRegistry } from '../providers/index.js';
import { createLogger, getLogDir, getLogStats } from '../utils/logger.js';
import {
  resolveConfigPath,
  resolveCronJobsPath,
  resolveStateDir,
  resolveAgentDir,
  resolveWorkspaceExtensionsDir,
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
  resolveSkillsMarketplaceProvider,
  type MarketplaceCategoryOption,
  type MarketplacePackageDetail,
  type SkillsStoreListParams,
  type UnifiedMarketplaceListResponse,
  type UnifiedMarketplacePackageDetail,
} from '../agent/skills/skills-marketplace.js';
import { createSkillConfigManager } from '../agent/skills/config.js';
import { removeSkillsLockEntry } from '../agent/skills/hub-lock.js';
import type { SkillCatalogEntry } from '../agent/agent-manager.js';
import type { SkillMarkdownPreviewPayload } from '../agent/skills/types.js';
import type { ManagedSkillListItem } from '../agent/skills/managed-store.js';

import { PACKAGE_VERSION } from '../package-version.js';
import { buildSessionKey, parseSessionKey } from '../routing/session-key.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';
import { scheduleGatewayUpdateCheck } from '../infra/update-startup.js';
import { restartGatewayProcessWithFreshPid } from './respawn.js';
import { getDistinctSessionChatIds } from './service/session-chat-ids.js';
import { runGatewayAgent } from './service/run-gateway-agent.js';
import { GatewaySseHub } from './service/sse-hub.js';
import type { GatewayServiceConfig, ServiceEvent } from './service/types.js';

export type { GatewayServiceConfig, ServiceEvent } from './service/types.js';

const log = createLogger('GatewayService');

export class GatewayService {
  private bus: MessageBus;
  private config: Config;
  private configPath: string;
  private agentService: AgentService;
  private channelManager: ChannelManager;
  private cronService: CronService;
  private extensionLoader: ExtensionLoader | null = null;
  private heartbeatService: HeartbeatService;
  private sessionManager: SessionManager;
  private running = false;
  private configReloader: ConfigHotReloader | null = null;
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

  private readonly clarifyBridge = new ClarifyBridge();

  /** Maps webchat session key → active `runId` for `clarify` tool routing. */
  private activeWebchatRunBySession = new Map<string, string>();

  constructor(private serviceConfig: GatewayServiceConfig = {}) {
    this.bus = new MessageBus();
    this.configPath = serviceConfig.configPath || resolveConfigPath();
    this.config = loadConfig(this.configPath);

    // Initialize authentication
    this.auth = resolveGatewayAuth({
      authConfig: this.config.gateway?.auth,
    });

    // Validate auth configuration
    assertGatewayAuthConfigured(this.auth);

    // Reject known weak / placeholder credentials at startup
    assertGatewayAuthNotKnownWeak(this.auth);

    // Security audit: detect dangerous configuration combinations early
    auditGatewayConfig({
      auth: this.auth,
      host: this.config.gateway?.host,
      corsOrigins: this.config.gateway?.corsOrigins,
    });

    // Log token info (not the token itself)
    if (this.auth.mode === 'token') {
      const tokenPreview = this.auth.token ? `${this.auth.token.slice(0, 4)}***` : 'none';
      log.info({ mode: this.auth.mode, token: tokenPreview }, 'Authentication configured');
    } else {
      log.info({ mode: this.auth.mode }, 'Authentication disabled');
    }

    // Initialize channel manager
    this.channelManager = new ChannelManager(this.config, this.bus);

    // Initialize extension loader
    this.workspacePath = getWorkspacePath(this.config) || './workspace';
    this.initializeExtensionLoader();

    // Initialize ModelRegistry (loads from models.json)
    const registry = getModelRegistry();
    log.debug({ 
      modelCount: registry.getAll().length, 
      error: registry.getError() || 'none' 
    }, 'ModelRegistry initialized');

    // Initialize agent service with extension registry
    const modelConfig = this.config.agents?.defaults?.model;
    const cronRef: { service?: CronService } = {};
    this.agentService = new AgentService(this.bus, {
      workspace: this.workspacePath,
      model: typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary,
      config: this.config,
      extensionRegistry: this.extensionLoader?.getRegistry(),
      getCronService: () => cronRef.service,
      gatewayClarify: {
        requestClarification: (sessionKey, request) => {
          const runId = this.activeWebchatRunBySession.get(sessionKey);
          const publishSse = runId
            ? (e: RelayEvent) => {
                this.agentService.enqueueWebchatSseEvent(sessionKey, e);
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


    // Set channel manager reference for model switching
    this.agentService.setChannelManager(this.channelManager);
    this.channelManager.setSessionModelHooks({
      getModelForSession: (sk) => this.agentService.getModelForSession(sk),
      switchModelForSession: (sk, id) => this.agentService.switchModelForSession(sk, id),
    });

    // Initialize cron service
    this.cronService = new CronService({
      filePath: resolveCronJobsPath(),
      agentService: this.agentService,
      messageBus: this.bus,
    });
    cronRef.service = this.cronService;

    // Initialize session manager
    this.sessionManager = new SessionManager({
      config: this.config,
    });

    this.heartbeatService = new HeartbeatService({
      agentService: this.agentService,
      messageBus: this.bus,
      cronService: this.cronService,
      sessionStore: this.sessionManager.getStore(),
      getConfig: () => this.config,
    });

    this.cronService.setDeps({
      agentService: this.agentService,
      messageBus: this.bus,
      heartbeatService: this.heartbeatService,
      getDefaultCronAgentId: () => getDefaultAgentId(this.config),
    });
  }

  /**
   * Create extension loader and resolve configs (load runs in start() before channels).
   */
  private initializeExtensionLoader(): void {
    try {
      const aid = getDefaultAgentId(this.config);
      this.extensionLoader = new ExtensionLoader({
        workspaceDir: this.workspacePath,
        extensionsDir: resolveWorkspaceExtensionsDir(this.config, aid),
      });
      this.extensionLoader.setConfig(this.config as Parameters<ExtensionLoader['setConfig']>[0]);
    } catch (error) {
      log.warn({ error }, 'Failed to initialize extension loader');
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
      await this.extensionLoader.loadByActivationPlan();
      const reg = this.extensionLoader.getRegistry();
      for (const plugin of reg.channelPlugins) {
        this.channelManager.registerPlugin(plugin);
      }
      log.debug(
        {
          extensionRecords: reg.extensions.size,
          channelPlugins: reg.channelPlugins.length,
        },
        'Extensions loaded and channel plugins registered',
      );
    } catch (err) {
      log.warn({ err }, 'Failed to load extensions');
    }
  }

  async start(): Promise<void> {
    if (this.running) return;

    log.debug('Starting gateway service...');
    this.startTime = Date.now();
    this.running = true;

    registerClarifyBridge(this.clarifyBridge);

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
        sessionManager: this.sessionManager,
        scheduleWebchatContinuation: (sessionKey: string, continuationMessage: string) => {
          queueMicrotask(() => {
            void this.drainScheduledWebchatContinuation(sessionKey, continuationMessage);
          });
        },
      });
    }

    await this.loadExtensionsAndRegisterChannels();

    // Start channels (initialize first, then start)
    await this.channelManager.initialize();
    await this.channelManager.start();
    await this.channelManager.replayPendingOutboundMessages();

    // Initialize session manager
    await this.sessionManager.initialize();
    log.debug('Session manager initialized');

    this.cronService.setDeps({
      agentService: this.agentService,
      messageBus: this.bus,
      heartbeatService: this.heartbeatService,
      sessionStore: this.sessionManager.getStore(),
      getDefaultCronAgentId: () => getDefaultAgentId(this.config),
    });

    this.sessionManager.on('sessionUpdated', (data: { key: string; name?: string; tags?: string[] }) => {
      this.emit('session.updated', { key: data.key, name: data.name, tags: data.tags });
    });

    // Start cron service
    if (this.config.cron?.enabled !== false) {
      await this.cronService.initialize();
    }

    this.heartbeatService.start(heartbeatRunnerConfigFromConfig(this.config));

    // Start agent service (runs in background)
    this.agentService.start().catch((err) => {
      log.error({ err }, 'Agent service error');
    });

    // Start outbound message processor
    this.startOutboundProcessor().catch((err) => {
      log.error({ err }, 'Outbound processor error');
    });

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

    log.debug('Gateway service started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    log.debug('Stopping gateway service...');

    if (this.stopGatewayUpdateCheck) {
      this.stopGatewayUpdateCheck();
      this.stopGatewayUpdateCheck = null;
    }

    // Stop config reloader
    if (this.configReloader) {
      await this.configReloader.stop();
      this.configReloader = null;
    }

    // Stop heartbeat service
    this.heartbeatService.stop();

    registerClarifyBridge(null);
    this.clarifyBridge.dispose();
    this.agentService.stop();

    // Unblock `consumeOutbound()` / `consumeInbound()` waiters before stopping channels (CLI agent does the same).
    this.running = false;
    this.bus.shutdown();

    await this.channelManager.stop();

    // Stop cron service
    await this.cronService.stop();

    log.debug('Gateway service stopped');
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

  /** After persisting config to disk: align plugins + debounced reload baseline (watchers skip duplicate diffs). */
  private async syncChannelPluginsAfterPersist(): Promise<void> {
    await this.handleChannelsReload(this.config);
    this.configReloader?.syncCurrentConfig(this.config);
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
    this.heartbeatService.updateConfig(newConfig);
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
   * Save current config to disk
   */
  /**
   * Persist and replace `this.config` with the validated file contents so runtime matches disk
   * (PATCH merge objects can drift from Zod-normalized output).
   */
  private async writeConfigAndReloadFromDisk(configToWrite: Config): Promise<void> {
    await writeConfigToDisk(configToWrite, this.configPath);
    this.config = loadConfig(this.configPath);
    this.agentService.applyAgentDefaultsFromConfig(this.config);
    // Hot-apply: reconcile managed dreaming cron jobs immediately after config persists.
    await this.agentService.reconcileDreamingNow().catch((err) => {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em }, `Dreaming cron reconcile after save failed: ${em}`);
    });
  }

  async saveConfig(config: Config): Promise<{ saved: boolean; error?: string }> {
    try {
      await this.writeConfigAndReloadFromDisk(config);
      await this.syncChannelPluginsAfterPersist();
      return { saved: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ error }, 'Failed to save config');
      return { saved: false, error };
    }
  }

  /**
   * App store (phase 1): persist `extensions.enabled` / `extensions.disabled` for a bundled extension.
   * Extension modules are loaded at gateway startup; restart the gateway process to fully apply load/unload.
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
    return { ok: true, requiresGatewayRestart: true };
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
      await this.syncChannelPluginsAfterPersist();

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
    runOptions?: { signal?: AbortSignal },
  ): AsyncGenerator<{ type: string; content?: string; status?: string; runId?: string }, { status: string; summary: string }, unknown> {
    const iter = runGatewayAgent(
      {
        config: this.config,
        agentService: this.agentService,
        bus: this.bus,
        runRelay: this.runRelay,
        runAbortControllers: this.runAbortControllers,
        activeWebchatRunBySession: this.activeWebchatRunBySession,
        sessionManager: this.sessionManager,
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
    for (const [sk, id] of this.activeWebchatRunBySession) {
      if (id === runId) {
        this.activeWebchatRunBySession.delete(sk);
      }
    }
    const c = this.runAbortControllers.get(runId);
    if (!c) {
      return false;
    }
    c.abort();
    return true;
  }

  /** Background drain for extension-initiated webchat turns (`scheduleWebchatContinuation`). */
  private async drainScheduledWebchatContinuation(sessionKey: string, message: string): Promise<void> {
    try {
      const gen = this.runAgent(message, 'webchat', sessionKey, undefined, undefined, undefined);
      for await (const _ of gen) {
        // Relay + persistence; no HTTP client attached.
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
   * Request an immediate heartbeat run (coalesced like interval/cron wakes).
   */
  requestHeartbeatNow(opts?: { reason?: string }): void {
    this.heartbeatService.requestNow({ reason: opts?.reason ?? 'manual' });
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

    return {
      status: 'ok',
      service: 'xopc-gateway',
      version: PACKAGE_VERSION,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
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

  async fetchSkillsMarketplaceCatalog(params: SkillsStoreListParams): Promise<UnifiedMarketplaceListResponse> {
    return listMarketplacePackages(this.config, params);
  }

  async fetchSkillsMarketplaceCategories(): Promise<{ items: MarketplaceCategoryOption[] }> {
    return listMarketplaceCategories(this.config);
  }

  async fetchSkillsMarketplacePackageDetail(packageName: string): Promise<UnifiedMarketplacePackageDetail> {
    return getMarketplacePackageDetail(this.config, packageName);
  }

  async installSkillFromMarketplace(opts: {
    name: string;
    version?: string;
    overwrite?: boolean;
  }): Promise<{ skillId: string; path: string }> {
    const { buffer, skillId } = await downloadFromMarketplace(this.config, opts.name, opts.version);
    return this.installManagedSkillZip(buffer, { skillId, overwrite: opts.overwrite ?? false });
  }

  getSkillsMarketplaceProvider(): { provider: string; displayName: string } {
    const provider = resolveSkillsMarketplaceProvider(this.config);
    return {
      provider,
      displayName: getMarketplaceProviderDisplayName(provider),
    };
  }

  reloadSkillsFromDisk(): void {
    this.agentService.refreshSkillsAfterDiskChange();
  }

  patchSkillEnabled(skillName: string, enabled: boolean): void {
    createSkillConfigManager(resolveStateDir()).setSkillEnabled(skillName, enabled);
    this.agentService.refreshSkillsAfterSkillConfigChange();
  }

  get sessionManagerInstance(): SessionManager {
    return this.sessionManager;
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
    return this.sessionManager.listSessions(query);
  }

  /**
   * List all subagent sessions.
   * Subagent sessions have keys starting with 'subagent:'.
   */
  async listSubagents(query?: SessionListQuery) {
    return this.sessionManager.listSubagents(query);
  }

  /**
   * Get a single session by key
   */
  async getSession(key: string) {
    return this.sessionManager.getSession(key);
  }

  /**
   * Delete a session
   */
  async deleteSession(key: string): Promise<{ deleted: boolean }> {
    const result = await this.sessionManager.deleteSession(key);
    return { deleted: result };
  }

  /**
   * Delete multiple sessions
   */
  async deleteSessions(keys: string[]): Promise<{ success: string[]; failed: string[] }> {
    return this.sessionManager.deleteSessions(keys);
  }

  /**
   * Rename a session
   */
  async renameSession(key: string, name: string): Promise<{ renamed: boolean }> {
    await this.sessionManager.renameSession(key, name);
    return { renamed: true };
  }

  /**
   * Tag a session
   */
  async tagSession(key: string, tags: string[]): Promise<{ tagged: boolean }> {
    await this.sessionManager.tagSession(key, tags);
    return { tagged: true };
  }

  /**
   * Remove tags from a session
   */
  async untagSession(key: string, tags: string[]): Promise<{ untagged: boolean }> {
    await this.sessionManager.untagSession(key, tags);
    return { untagged: true };
  }

  /**
   * Archive a session
   */
  async archiveSession(key: string): Promise<{ archived: boolean }> {
    await this.sessionManager.archiveSession(key);
    return { archived: true };
  }

  /**
   * Unarchive a session
   */
  async unarchiveSession(key: string): Promise<{ unarchived: boolean }> {
    await this.sessionManager.unarchiveSession(key);
    return { unarchived: true };
  }

  /**
   * Pin a session
   */
  async pinSession(key: string): Promise<{ pinned: boolean }> {
    await this.sessionManager.pinSession(key);
    return { pinned: true };
  }

  /**
   * Unpin a session
   */
  async unpinSession(key: string): Promise<{ unpinned: boolean }> {
    await this.sessionManager.unpinSession(key);
    return { unpinned: true };
  }

  /**
   * Search sessions
   */
  async searchSessions(query: string) {
    return this.sessionManager.searchSessions(query);
  }

  /**
   * Search within a session
   */
  async searchInSession(key: string, keyword: string) {
    return this.sessionManager.searchInSession(key, keyword);
  }

  /**
   * Export a session
   */
  async exportSession(key: string, format: ExportFormat): Promise<{ content: string }> {
    const content = await this.sessionManager.exportSession(key, format);
    return { content };
  }

  /**
   * Get session statistics
   */
  async getSessionStats() {
    return this.sessionManager.getStats();
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
    return getDistinctSessionChatIds(this.sessionManager, channel);
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
  getAuthMode(): 'none' | 'token' | 'password' {
    return this.auth.mode;
  }

  /**
   * Get current auth token (for CLI server integration).
   * Returns undefined if mode is 'none'.
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

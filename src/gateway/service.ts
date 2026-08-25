import crypto from 'crypto';
import { listAgentEntries, normalizeAgentId, resolveDefaultAgentId } from '../agent/agent-scope.js';
import { AgentService } from '../agent/service.js';
import { getEmbeddedExecutionSession } from '../agent/embedded/execution-context.js';
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
import { AutomationService, type AutomationRun } from '../automations/index.js';
import {
  DiscussionLiveWorker,
  DiscussionOrganizer,
  DiscussionOrganizerWorker,
  DiscussionSealer,
  DiscussionService,
} from '../discussions/index.js';
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
import { EphemeralSideChatManager, SideChatRunService } from './side-chat/index.js';
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
import { ModelCatalogSyncService } from '../providers/model-catalog-sync-service.js';
import { runBootstrapMigrationsSync } from '../migrations/runner.js';
import { createLogger, getLogDir, getRuntimeLogStats } from '../utils/logger.js';
import { subscribeToLogs } from '../utils/logger/log-stream.js';
import {
  resolveConfigPath,
  resolveAgentDir,
  resolveExtensionsDir,
} from '../config/paths.js';
import type { ClarifyStreamEvent } from './clarify-bridge.js';
import { registerClarifyBridge } from './clarify-runtime.js';
import { PACKAGE_VERSION } from '../package-version.js';
import { MobileNotificationService } from '../mobile/notification-service.js';
import { ProjectService, resolveProjectAgentId } from '../projects/index.js';
import { LocalAppService } from '../local-apps/index.js';
import {
  TaskRepository,
  TaskApplicationService,
  TaskOutboxDispatcher,
} from '../tasks/index.js';
import { TaskConversationRepository } from '../tasks/task-conversation-repository.js';
import { TaskRunDispatcher } from '../tasks/task-run-dispatcher.js';
import { TaskSignalService } from '../tasks/task-signal-service.js';
import { createRuntimeBrowserRecipeService, type BrowserRecipeService } from '../browser/recipes/index.js';
import {
  ReadonlyProactiveAgentExecutor,
  listInsights,
  mapProductEventToProactive,
  ProactiveEventService,
  ProactiveInboxService,
  ProactiveInboxWorker,
  ProactiveScenarioService,
  ProactiveTemporalWorker,
  ProactiveWorker,
} from '../proactive/index.js';

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
import { RealtimeRuntime } from '../realtime/runtime.js';
import { reconcileDreamingAutomations as reconcileDreamingAutomationRecords } from './dreaming-automation-reconciler.js';
import type {
  GatewayChannelStartupPhase1Metrics,
  GatewayChannelStartupPhase2Metrics,
  GatewayServiceConfig,
} from './service/types.js';
import {
  GatewayReadiness,
  type GatewayReadinessSnapshot,
} from './startup-readiness.js';
import { createGatewayStartupTrace, type GatewayStartupTrace } from './startup-trace.js';
import { closeXopcDatabase, openXopcDatabase } from '../storage/sqlite/index.js';
import { startConnectorSupervisor, type ConnectorSupervisor } from '../connectors/supervisor.js';
import {
  startConnectorLearningCoordinator,
  type ConnectorLearningCoordinator,
} from '../connectors/learning-coordinator.js';
import { ConnectedSourceChangePublisher } from '../connectors/source-change-publisher.js';
import {
  applyAutomaticVoiceLanguage,
  inferProductLanguageFromEnvironment,
  initializeVoiceDefaults,
  prepareConfiguredLocalVoiceModel,
  type ProductLanguage,
} from '../voice/language-profile.js';
import {
  startConnectedKnowledgeCoordinator,
  type ConnectedKnowledgeCoordinator,
} from '../knowledge/index.js';
import { EndpointToolRuntime } from '../endpoint-tools/index.js';

export type {
  GatewayChannelStartupPhase1Metrics,
  GatewayChannelStartupPhase2Metrics,
  GatewayServiceConfig,
} from './service/types.js';

const log = createLogger('Gateway:Service');

export class GatewayService {
  private bus: MessageBus;
  private config: Config;
  private configPath: string;
  private _agentService: AgentService | null = null;
  private channelManager: ChannelManager;
  private automationService: AutomationService;
  private browserRecipeService: BrowserRecipeService | null = null;
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
  private readonly modelCatalogSync = new ModelCatalogSyncService({
    onUpdated: (modelCount) => this.emit('model-catalog.updated', { modelCount }),
    getConfig: () => this.config,
  });

  // Authentication
  private auth: ResolvedGatewayAuth;

  readonly endpointTools = new EndpointToolRuntime();
  readonly realtime = new RealtimeRuntime(this.endpointTools);

  getConfig(): Config {
    return this.config;
  }

  getModelCatalogSync(): ModelCatalogSyncService {
    return this.modelCatalogSync;
  }

  get browserRecipes(): BrowserRecipeService {
    if (!this.browserRecipeService) {
      this.browserRecipeService = createRuntimeBrowserRecipeService({
        getConfig: () => this.config,
        emit: (type, payload) => this.emit(type, payload),
      });
    }
    return this.browserRecipeService;
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
  private taskRunDispatcher: TaskRunDispatcher | null = null;
  private taskRunDispatchTimer: ReturnType<typeof setInterval> | null = null;
  private mobileNotifications: MobileNotificationService | null = null;
  private connectorSupervisor: ConnectorSupervisor | null = null;
  private connectorLearningCoordinator: ConnectorLearningCoordinator | null = null;
  private connectedSourceChangePublisher: ConnectedSourceChangePublisher | null = null;
  private connectedKnowledgeCoordinator: ConnectedKnowledgeCoordinator | null = null;
  private stopAutomationProductEventBridge: (() => void) | null = null;
  private stopSessionTranscriptAutomationEvents: (() => void) | null = null;
  private stopRealtimeLogBridge: (() => void) | null = null;

  /**
   * Webchat agent invocation surface (`runAgent`, `abortAgentRun`, `steer*`,
   * `submitClarifyResponse`, clarify-bridge dispatch). Owns the
   * `activeWebchatRunBySession` + `runAbortControllers` maps.
   */
  readonly agentRunner: GatewayAgentRunner;

  /** Process-local, non-persistent side conversations forked from durable sessions. */
  readonly sideChats: EphemeralSideChatManager;
  readonly sideChatRuns: SideChatRunService;

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

  /** First-class project grouping surface. */
  readonly projects: ProjectService;
  readonly discussions: DiscussionService;
  readonly discussionWorker: DiscussionOrganizerWorker;
  readonly discussionLiveWorker: DiscussionLiveWorker;
  readonly discussionSealer: DiscussionSealer;

  /** Local user-created apps, their coder projects, previews, and installs. */
  readonly localApps: LocalAppService;

  /** Unified durable event spine for proactive scenarios. */
  readonly proactiveScenarios = new ProactiveScenarioService();
  readonly proactive = new ProactiveEventService(() => this.proactiveScenarios.routes());
  readonly proactiveInbox = new ProactiveInboxService();
  readonly proactiveInsights = listInsights;
  readonly proactiveWorker: ProactiveWorker;
  readonly proactiveTemporalWorker: ProactiveTemporalWorker;
  readonly proactiveInboxWorker: ProactiveInboxWorker;

  constructor(private serviceConfig: GatewayServiceConfig = {}) {
    this.bus = new MessageBus();
    this.configPath = serviceConfig.configPath || resolveConfigPath();
    runBootstrapMigrationsSync(this.configPath);
    this.config = loadConfig(this.configPath);
    this.proactiveWorker = new ProactiveWorker(new ReadonlyProactiveAgentExecutor(() => this.config));
    this.proactiveTemporalWorker = new ProactiveTemporalWorker(this.proactive);
    this.proactiveInboxWorker = new ProactiveInboxWorker({
      deliver: async ({ inboxItem }) => {
        this.emit('proactive.inbox.created', inboxItem);
        await this.createMobileNotificationService().deliverGatewayEvent('proactive.inbox.created', inboxItem);
      },
    });
    let bootstrapConfigChanged = initializeVoiceDefaults(
      this.config,
      inferProductLanguageFromEnvironment(),
    );
    const starterResult = ensureStarterAgentsInitialized(this.config);
    if (starterResult.changed) {
      this.config = starterResult.config;
      bootstrapConfigChanged = true;
    }
    if (sanitizeTunnelConfig(this.config)) {
      bootstrapConfigChanged = true;
    }
    if (bootstrapConfigChanged) {
      void writeConfigToDisk(this.config, this.configPath).catch((err) => {
        const em = err instanceof Error ? err.message : String(err);
        log.warn({ err, phase: 'bootstrap_config_init', errorMessage: em }, `Bootstrap config persist failed: ${em}`);
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

    // Session index + files shared with AgentService for chat transcript and Task execution context.
    this.sessionIndex = new SessionIndex({
      config: this.config,
    });

    this.automationService = new AutomationService(this.proactive);

    this.notesService = new NotesService(new NotesStore());

    this.projects = new ProjectService(undefined, this.proactive);
    const emitDiscussion = (capture: import('../discussions/index.js').DiscussionCapture) => {
      this.emit('discussion.updated', capture);
    };
    this.discussions = new DiscussionService(
      this.notesService,
      this.projects,
      (type, payload) => {
        this.emit(type, payload);
      },
    );
    this.discussionWorker = new DiscussionOrganizerWorker(
      new DiscussionOrganizer({
        notes: this.notesService,
        projects: this.projects,
        getConfig: () => this.config,
        onUpdated: emitDiscussion,
        onCompleted: (capture, organization) => {
          const payload = {
            discussionId: capture.id,
            noteId: capture.noteId,
            projectId: capture.projectId,
            completedAt: capture.completedAt,
            actionCount: organization.actionItems.length,
            unownedActionCount: organization.actionItems.filter((item) => !item.owner).length,
            undatedActionCount: organization.actionItems.filter((item) => !item.dueDate).length,
            riskCount: organization.risks.length,
            openQuestionCount: organization.openQuestions.length,
          };
          this.emit('discussion.completed', payload);
          publishAutomationProductEvent({
            type: 'discussion.completed',
            source: 'discussions',
            payload,
            occurredAtMs: capture.completedAt,
          });
        },
      }),
      emitDiscussion,
    );
    this.discussionLiveWorker = new DiscussionLiveWorker({
      notes: this.notesService,
      projects: this.projects,
      getConfig: () => this.config,
      onDiscussionUpdated: emitDiscussion,
      onTranscriptUpdated: (segment) => {
        const capture = this.discussions.get(segment.discussionId);
        const transcript = this.discussions.transcript(segment.discussionId);
        void capture.then((detail) => {
          if (!detail || !transcript) return;
          this.emit('discussion.segment.updated', {
            discussionId: segment.discussionId,
            noteId: detail.discussion.noteId,
            transcriptRevision: transcript.revision,
            segment,
            text: transcript.text,
            stats: transcript.stats,
          });
        });
      },
    });
    this.discussionSealer = new DiscussionSealer({
      notes: this.notesService,
      getConfig: () => this.config,
      onUpdated: emitDiscussion,
    });

    this.localApps = new LocalAppService({
      projects: this.projects,
      workspaceRoot: this.workspacePath,
      getConfig: () => this.config,
      saveConfig: (cfg) => this.saveConfig(cfg),
      getExtensionLoader: () => this.extensionLoader,
      emit: (type, payload) => this.emit(type, payload),
    });

    this.agentRunner = new GatewayAgentRunner({
      bus: this.bus,
      sessionIndex: this.sessionIndex,
      getAgentService: () => this.ensureAgentService(),
      getChannelManager: () => this.channelManager,
      getConfig: () => this.config,
      emit: (type, payload) => this.emit(type, payload),
      publishRealtime: (topic, event, data) => {
        this.realtime.broker.publish(topic, event, data);
      },
      completeRealtimeTopic: (topic) => this.realtime.completeTopic(topic),
    });

    let sideChatRuns: SideChatRunService | undefined;
    this.sideChats = new EphemeralSideChatManager({
      getParentMetadata: (sessionKey) => this.sessionIndex.getSessionMetadata(sessionKey),
      loadParentMessages: (sessionKey) => this.sessionIndex.getStore().load(sessionKey),
      getDefaultModelRef: (sessionKey) => this.ensureAgentService().getModelForSession(sessionKey),
      getWorkspacePath: (metadata) => metadata.cwd || this.currentWorkspacePath,
      onBeforeDispose: (sideChatId, clientInstanceId) =>
        sideChatRuns?.abort(sideChatId, clientInstanceId).then(() => undefined),
    });
    this.sideChatRuns = sideChatRuns = new SideChatRunService({
      manager: this.sideChats,
      getAgentService: () => this.ensureAgentService(),
      agentRunner: this.agentRunner,
      publishRealtime: (topic, event, data) => this.realtime.broker.publish(topic, event, data),
      completeRealtimeTopic: (topic) => this.realtime.completeTopic(topic),
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
      getWorkspacePath: () => this.currentWorkspacePath,
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
      reconcileDreamingAutomations: () => this.reconcileDreamingAutomations(),
      getChannelsStatus: () => this.getChannelsStatus(),
      emit: (type, payload) => this.emit(type, payload),
    });
  }

  /** Lazy AgentService — constructed on first use or during `start()`. */
  get agentService(): AgentService {
    return this.ensureAgentService();
  }

  refreshActionTrustPolicy(): void {
    this._agentService?.refreshActionTrustPolicy();
  }

  refreshUserProfileContext(): void {
    this._agentService?.refreshUserProfileContext();
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
      onSkillsUpdated: (payload) => {
        this.emit('config.reload', {
          section: 'skills',
          source: payload.reason === 'disk' ? 'skills-filesystem' : 'skills-config',
        });
      },
      extensionRegistry: this.extensionLoader?.getRegistry(),
      endpointTools: this.endpointTools,
      getAutomationService: () => this.automationService,
      getBrowserRecipeService: () => this.browserRecipes,
      getNotesService: () => this.notesService,
      getProjectService: () => this.projects,
      getLocalAppService: () => this.localApps,
      dispatchTaskEvents: () => this.dispatchTaskEvents(),
      dispatchTaskRuns: () => this.dispatchTaskRuns(),
      getWorkflowRunService: () => this.createWorkflowRunService(),
      sourceContextResolver: async (binding) => {
        if (binding.kind === 'note') {
          const note = await this.notesService.getNote(binding.sourceId);
          if (!note) return null;
          return buildNoteAgentContext({
            note,
            notesService: this.notesService,
            config: this.config,
          });
        }
        return null;
      },
      gatewayClarify: {
        requestClarification: (sessionKey, request) => {
          const executionSessionKey = getEmbeddedExecutionSession() ?? sessionKey;
          return this.agentRunner.requestClarification({
            sessionKey: executionSessionKey,
            request,
            publishStreamFor: (_runId) => (event: ClarifyStreamEvent) => {
              this._agentService!.turnDispatcher.enqueueWebchatStreamEvent(executionSessionKey, event);
            },
          });
        },
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
      getProjectWorkspaceRoot: (projectId) => this.projects.get(projectId)?.workspaceRoot,
      workflowRunService: this.createWorkflowRunService(),
      browserRecipeService: this.browserRecipes,
      executeTaskCommand: ({ taskId, idempotencyKey, command }) => {
        const task = new TaskRepository().get(taskId);
        if (!task) return { ok: false, reason: 'not_found' };
        const result = new TaskApplicationService().execute({
          taskId, idempotencyKey, expectedVersion: task.version, command,
          actor: { kind: 'system', id: 'automation' },
        });
        if (result.ok && result.runId) this.dispatchTaskRuns();
        if (result.ok === false) return { ok: false, reason: result.reason };
        return { ok: true, ...(result.runId ? { runId: result.runId } : {}) };
      },
      onRunCompleted: (run) => this.handleAutomationRunCompleted(run),
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

  private createTaskRunDispatcher(): TaskRunDispatcher {
    if (!this.taskRunDispatcher) {
      this.taskRunDispatcher = new TaskRunDispatcher({
        workerId: 'gateway-agent',
        ensureSession: async (taskId, runId, requestedAgentId) => {
          return (await this.ensureTaskConversation(taskId, { runId, requestedAgentId })).sessionKey;
        },
        runAgent: async (runId, sessionKey, message) => {
          const stream = this.agentRunner.runAgent(
            message,
            'webchat',
            sessionKey,
            { type: 'system', source: 'workflow' },
            undefined,
            undefined,
            { runId },
          );
          while (!(await stream.next()).done) { /* published through the run topic */ }
        },
      });
    }
    return this.taskRunDispatcher;
  }

  private createMobileNotificationService(): MobileNotificationService {
    if (!this.mobileNotifications) {
      this.mobileNotifications = new MobileNotificationService();
    }
    return this.mobileNotifications;
  }

  dispatchTaskRuns(): void {
    new TaskSignalService().tick();
    this.dispatchTaskEvents();
    this.createTaskRunDispatcher().dispatch();
    void this.createWorkflowRunService().dispatchTaskRuns();
  }

  async ensureTaskConversation(
    taskId: string,
    options: { runId?: string; requestedAgentId?: string } = {},
  ): Promise<{
    sessionKey: string;
    agentId: string;
    created: boolean;
    conversation: ReturnType<TaskConversationRepository['requireState']>;
  }> {
    const task = new TaskRepository().require(taskId);
    const agentId = resolveProjectAgentId({
      config: this.config,
      projects: this.projects,
      explicitAgentId: options.requestedAgentId ?? task.delegateAgentId,
      projectId: task.projectId,
    });
    const conversations = new TaskConversationRepository();
    const active = conversations.getActiveSession(task.id);
    if (active) {
      if (active.agentId && active.agentId !== agentId) {
        throw new Error('Task executor differs from the active conversation');
      }
      const conversation = conversations.activateExecutionSession({
        taskId: task.id,
        sessionKey: active.sessionKey,
        agentId,
        runId: options.runId,
      });
      return { sessionKey: active.sessionKey, agentId, created: false, conversation };
    }

    const peerId = `task-${sanitizeSegment(task.id) || Date.now()}`;
    const sessionKey = buildSessionKey({
      agentId,
      source: 'webchat',
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    });
    if (!await this.sessionIndex.getSessionMetadata(sessionKey)) {
      await this.sessionIndex.saveMessages(sessionKey, [], { metadata: {
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
        projectId: task.projectId,
        customData: {
          origin: 'task',
          triggerKind: 'user',
          ...(options.runId ? { taskRunId: options.runId } : {}),
        },
      } });
    }
    if (task.projectId) this.projects.attachSession(sessionKey, task.projectId);
    const conversation = conversations.activateExecutionSession({
      taskId: task.id,
      sessionKey,
      agentId,
      runId: options.runId,
    });
    return { sessionKey, agentId, created: true, conversation };
  }

  dispatchTaskEvents(): void {
    new TaskOutboxDispatcher(publishAutomationProductEvent).drain();
  }

  runAgent(
    ...args: Parameters<GatewayAgentRunner['runAgent']>
  ): ReturnType<GatewayAgentRunner['runAgent']> {
    return this.agentRunner.runAgent(...args);
  }

  submitSessionInput(...args: Parameters<GatewayAgentRunner['submitSessionInput']>) {
    return this.agentRunner.submitSessionInput(...args);
  }

  getSessionInputState(...args: Parameters<GatewayAgentRunner['getSessionInputState']>) {
    return this.agentRunner.getSessionInputState(...args);
  }

  updateSessionInput(...args: Parameters<GatewayAgentRunner['updateSessionInput']>) {
    return this.agentRunner.updateSessionInput(...args);
  }

  removeSessionInput(...args: Parameters<GatewayAgentRunner['removeSessionInput']>) {
    return this.agentRunner.removeSessionInput(...args);
  }

  abortAgentRun(runId: string) {
    return this.agentRunner.abortAgentRun(runId);
  }

  getActiveWebchatRunId(sessionKey: string): string | undefined {
    return this.agentRunner.getActiveRunId(sessionKey);
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

    this.modelCatalogSync.start();

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

    this.stopRealtimeLogBridge = subscribeToLogs((entry) => {
      this.realtime.broker.publish('logs', 'log.entry', entry);
    });

    setPairingBroadcastSink((type, payload) => {
      this.emit(type, payload);
    });

    log.debug('Starting gateway service...');
    openXopcDatabase();
    this.startTime = Date.now();
    this.running = true;
    this.taskRunDispatchTimer = setInterval(() => this.dispatchTaskRuns(), 1_000);
    this.taskRunDispatchTimer.unref?.();
    this.ensureDefaultProactiveScenarioSubscriptions();
    this.proactiveWorker.start();
    this.proactiveTemporalWorker.start();
    this.proactiveInboxWorker.start();
    prepareConfiguredLocalVoiceModel(this.config);
    this.startupTrace = createGatewayStartupTrace();
    this.readiness.markStarting(this.startTime);
    const trace = this.startupTrace;

    registerClarifyBridge(this.agentRunner.getClarifyBridge());

    this.ensureAgentService();
    this.agentRunner.recoverSessionInputs();

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
      browserRecipeService: this.browserRecipes,
      executeTaskCommand: ({ taskId, idempotencyKey, command }) => {
        const task = new TaskRepository().get(taskId);
        if (!task) return { ok: false, reason: 'not_found' };
        const result = new TaskApplicationService().execute({
          taskId, idempotencyKey, expectedVersion: task.version, command,
          actor: { kind: 'system', id: 'automation' },
        });
        if (result.ok && result.runId) this.dispatchTaskRuns();
        if (result.ok === false) return { ok: false, reason: result.reason };
        return { ok: true, ...(result.runId ? { runId: result.runId } : {}) };
      },
      onRunCompleted: (run) => this.handleAutomationRunCompleted(run),
    });
    this.startAutomationProductEventBridge();

    await trace.measure('workflows.reconcile', () => this.reconcileInterruptedWorkflowRuns());

    this.sessionIndex.on('sessionUpdated', (data: { key: string; name?: string; tags?: string[] }) => {
      this.emit('session.updated', { key: data.key, name: data.name, tags: data.tags });
    });

    await trace.measure('automations.initialize', () => this.automationService.initialize());
    await trace.measure('dreaming.reconcile', () => this.reconcileDreamingAutomations());

    await this.notesService.initialize();
    this.discussionLiveWorker.start();
    this.discussionSealer.start();
    this.discussionWorker.start();

    this.ensureHeartbeatService().start(heartbeatRunnerConfigFromConfig(this.config));

    this.connectorSupervisor = startConnectorSupervisor({
      getConfig: () => this.config,
      saveConfig: (cfg) => this.saveConfig(cfg),
    });
    this.connectorLearningCoordinator = startConnectorLearningCoordinator({
      getConfig: () => this.config,
      resolveAgentId: () => resolveDefaultAgentId(this.config),
      getMemoryManager: () => this.agentService.getMemoryManager(),
      emit: (type, payload) => this.emit(type, payload),
    });
    this.connectedSourceChangePublisher = new ConnectedSourceChangePublisher(this.proactive);
    this.connectedSourceChangePublisher.start();
    this.connectedKnowledgeCoordinator = startConnectedKnowledgeCoordinator({
      resolvePipelineOptions: () => ({
        agentId: resolveDefaultAgentId(this.config),
        workspaceId: this.currentWorkspacePath,
      }),
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

  private ensureDefaultProactiveScenarioSubscriptions(): void {
    for (const scenarioKey of ['meeting_preparation', 'discussion_follow_up']) {
      if (this.proactiveScenarios.subscriptions(scenarioKey).some(
        (subscription) => subscription.workspaceId === this.currentWorkspacePath,
      )) continue;
      this.proactiveScenarios.subscribe({
        scenarioKey,
        workspaceId: this.currentWorkspacePath,
        scopeKind: 'workspace',
        scopeId: this.currentWorkspacePath,
        enabled: true,
      });
    }
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
    this.stopRealtimeLogBridge?.();
    this.stopRealtimeLogBridge = null;

    log.debug('Stopping gateway service...');
    this.readiness.markStarting();
    this.endpointTools.close();
    await this.sideChats.disposeAll();
    this.realtime.close();

    await this.proactiveWorker.stop();
    await this.discussionWorker.stop();
    await this.discussionSealer.stop();
    await this.discussionLiveWorker.stop();
    this.proactiveTemporalWorker.stop();
    await this.proactiveInboxWorker.stop();
    if (this.taskRunDispatchTimer) {
      clearInterval(this.taskRunDispatchTimer);
      this.taskRunDispatchTimer = null;
    }

    await stopTailscaleExposure().catch((err) => {
      log.warn({ err }, 'Tailscale exposure shutdown failed');
    });

    if (this.stopGatewayUpdateCheck) {
      this.stopGatewayUpdateCheck();
      this.stopGatewayUpdateCheck = null;
    }

    this.modelCatalogSync.stop();

    await this.configCoordinator.stopHotReloader();

    // Stop heartbeat service
    this.heartbeatService?.stop();
    this.connectorSupervisor?.stop();
    this.connectorSupervisor = null;
    this.connectorLearningCoordinator?.stop();
    this.connectorLearningCoordinator = null;
    this.connectedSourceChangePublisher?.stop();
    this.connectedSourceChangePublisher = null;
    this.connectedKnowledgeCoordinator?.stop();
    this.connectedKnowledgeCoordinator = null;

    await this.browserRecipeService?.shutdown();

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

  async syncVoiceLanguage(language: ProductLanguage): Promise<{
    applied: boolean;
    language: ProductLanguage;
    mode: 'auto' | 'manual';
    error?: string;
  }> {
    const mode = this.config.voice?.languageMode ?? 'auto';
    if (mode === 'manual') {
      return { applied: false, language, mode };
    }
    const changed = applyAutomaticVoiceLanguage(this.config, language);
    if (changed) {
      const saved = await this.configCoordinator.saveConfig(this.config);
      if (!saved.saved) {
        return { applied: false, language, mode, error: saved.error ?? 'Failed to save voice language' };
      }
    }
    prepareConfiguredLocalVoiceModel(this.config);
    return { applied: changed, language, mode };
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

  requestConnectorLearning(
    connectionId: string,
    request?: Parameters<ConnectorLearningCoordinator['enqueueConnection']>[1],
  ): ReturnType<ConnectorLearningCoordinator['enqueueConnection']> {
    return this.connectorLearningCoordinator?.enqueueConnection(connectionId, request) ?? null;
  }

  requestConnectorLearningForToolkit(toolkit: string): ReturnType<ConnectorLearningCoordinator['enqueueToolkit']> {
    return this.connectorLearningCoordinator?.enqueueToolkit(toolkit) ?? [];
  }

  setConnectorLearningPaused(connectionId: string, paused: boolean): number {
    return this.connectorLearningCoordinator?.setPaused(connectionId, paused) ?? 0;
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

  private async reconcileDreamingAutomations(): Promise<void> {
    await reconcileDreamingAutomationRecords({
      config: this.config,
      automationService: this.automationService,
    });
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
    return this.agentService.turnDispatcher.processDirect(
      content,
      sessionKey,
      { type: 'system', source: 'internal' },
    );
  }

  emit(type: string, payload: unknown): void {
    this.realtime.broker.publish('gateway', type, payload);
    this.createMobileNotificationService().handleGatewayEvent(type, payload);
  }

  private handleAutomationRunCompleted(run: AutomationRun): void {
    this.emit('automation.run.completed', { run });
  }

  private startAutomationProductEventBridge(): void {
    this.stopAutomationProductEventBridge?.();
    this.stopSessionTranscriptAutomationEvents?.();
    this.stopAutomationProductEventBridge = onAutomationProductEvent((event) => {
      if (event.type.startsWith('task.')) {
        this.emit(event.type, event.payload);
      }
      const proactiveEvent = mapProductEventToProactive({
        event,
        workspaceId: this.currentWorkspacePath,
        defaultAgentId: resolveDefaultAgentId(this.config),
      });
      if (proactiveEvent) {
        try {
          this.proactive.publish(proactiveEvent);
        } catch (err) {
          const em = err instanceof Error ? err.message : String(err);
          log.warn(
            { err, eventType: event.type, source: event.source },
            `Proactive product event publication failed: ${em}`,
          );
        }
      }
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

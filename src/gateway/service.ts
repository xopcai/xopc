import { patchSessionMetadata } from '../storage/sqlite/session-repository.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';
import { resolveAgentMainConversationId } from '../routing/agent-session-key.js';
import { createBackgroundTask } from '../infra/background-task.js';
import { buildTaskAgentContext } from '../agent/source-context/task-context.js';
import { buildFileAgentContext } from '../agent/source-context/file-context.js';
import { buildSessionAgentContext } from '../agent/source-context/session-context.js';
import { buildMcpResourceAgentContext } from '../agent/source-context/mcp-resource-context.js';
import { buildBrowserTabAgentContext } from '../agent/source-context/browser-tab.js';
import { RealtimeExtensionBrowserProvider } from '../browser/providers/realtime-extension.js';
import { getBrowserTabBindingById } from '../storage/sqlite/browser-tab-binding-repository.js';
import crypto from 'node:crypto';
import { WorkDiscoveryService } from '../work-discovery/service.js';

import { findSessionInput, insertSessionInput } from '../storage/sqlite/session-input-repository.js';
import { ConnectionRecoveryService } from '../connectors/connection-recovery-service.js';

import { buildVoiceMemoryContext } from '../voice/realtime/memory-context.js';
import { buildVoicePersonaContext } from '../voice/realtime/persona-context.js';
import { voiceMemoryBudget, voicePersonaBudget } from '../voice/realtime/conversation-context.js';
import { getSessionConfig } from '../storage/sqlite/config-repository.js';
import { notifyUserContextChange } from '../user-context/changes.js';
import { resolveEffectiveAgentProfileForSession } from '../config/agent-profile.js';
import { listAgentEntries, normalizeAgentId, resolveDefaultAgentId, resolveAgentWorkspaceDir } from '../agent/agent-scope.js';
import { AgentService } from '../agent/service.js';
import { getEmbeddedExecutionSession } from '../agent/embedded/execution-context.js';
import { bootstrapApplicationStateSync } from '../bootstrap/application-state.js';
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
import { SessionIndex } from '../session/index.js';
import { EphemeralSideChatManager, SideChatPromotionService, SideChatRunService } from './side-chat/index.js';
import { onSessionTranscriptUpdate } from '../session/transcript-events.js';
import type { Config } from '../config/schema.js';
import { getAgentDefaultModelRef } from '../config/schema.js';
import { wireTunnelEventsToGateway } from '../tunnel/gateway-lifecycle.js';
import {
  stopTailscaleExposure,
} from './tailscale-lifecycle.js';
import { getExposureManager } from '../remote-access/exposure-manager.js';
import { sanitizeTunnelConfig } from '../tunnel/tunnel-config.js';
import { prepareAutomationAgentSession } from './automation-agent-session.js';
import { getGatewayFileSpaceService } from './file-space-service.js';
import { resolveGatewayAuth, assertGatewayAuthConfigured, validateToken, extractToken, type ResolvedGatewayAuth } from './auth.js';
import { assertGatewayAuthNotKnownWeak } from './security/known-weak-secrets.js';
import { auditGatewayConfig } from './security/audit.js';
import { assertGatewayRuntimeConfig } from './runtime-config.js';
import { resolveEffectiveGatewayPort } from './host.js';
import { buckets, isGatewayStrictSecurityEnabled } from './rate-limit/index.js';
import { prewarmModelRegistry } from '../providers/index.js';
import { ModelCatalogSyncService } from '../providers/model-catalog-sync-service.js';
import { getXopcCloudCatalogCoordinator } from '../providers/xopc-cloud-catalog-coordinator.js';
import { collectMediaUrisFromMessages, deleteMediaUris } from '../media/session-references.js';
import { createLogger, getLogDir, getRuntimeLogStats } from '../utils/logger.js';
import { subscribeToLogs } from '../utils/logger/log-stream.js';
import {
  resolveConfigPath,
  resolveExtensionsDir,
} from '../config/paths.js';
import type { ClarificationStreamEvent } from './ephemeral-clarification-waiter.js';
import { registerClarificationChannelRuntime } from './clarify-runtime.js';
import { PACKAGE_VERSION } from '../package-version.js';
import { NotificationService } from '../notifications/service.js';
import { ProjectService, resolveProjectAgentId } from '../projects/index.js';
import { LocalAppService } from '../local-apps/index.js';
import { ChatPreviewService } from '../chat-previews/index.js';
import {
  TaskRepository,
  TaskApplicationService,
} from '../tasks/index.js';
import { DomainOutboxDispatcher } from '../infra/domain-outbox-dispatcher.js';
import { TaskConversationRepository } from '../tasks/task-conversation-repository.js';
import { TaskRunDispatcher } from '../tasks/task-run-dispatcher.js';
import { TaskSignalService } from '../tasks/task-signal-service.js';
import { createRuntimeBrowserAutomationService, type BrowserAutomationService } from '../browser/automations/index.js';

import { disposeAllSessionMcpRuntimes } from '../agent/mcp/bundle-mcp-tools.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';
import { resolveConversationId, sanitizeSegment } from '../routing/session-key.js';
import { scheduleGatewayUpdateCheck } from '../infra/update-startup.js';
import { resolveChannelConnectDeferSet } from './resolve-channel-connect-defer.js';
import { restartGatewayProcessWithFreshPid } from './respawn.js';
import { GatewaySessionsApi } from './service/sessions-api.js';
import { GatewayMarketplaceService } from './service/marketplace-service.js';
import { GatewayConfigCoordinator } from './service/config-coordinator.js';
import { GatewayAgentRunner } from './service/agent-runner.js';
import { isBrowserSessionActive } from '../storage/sqlite/browser-session-repository.js';
import { RealtimeRuntime } from '../realtime/runtime.js';
import { VoiceRealtimeRuntime } from '../voice/realtime/runtime.js';
import { DurableVoiceAgentBroker } from '../voice/realtime/agentBroker.js';
import { reconcileMemoryMaintenanceAutomations } from './memory-maintenance-automation-reconciler.js';
import { reconcileHomeIntelligenceAutomation } from './home-intelligence-automation-reconciler.js';
import { runMemoryMaintenance } from '../memory-maintenance/index.js';
import type { AutomationAction } from '../automations/domain/types.js';
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
import { closeXopcDatabase } from '../storage/sqlite/index.js';
import { startConnectorSupervisor, type ConnectorSupervisor } from '../connectors/supervisor.js';
import {
  startConnectorLearningCoordinator,
  type ConnectorLearningCoordinator,
} from '../connectors/learning-coordinator.js';
import { GatewaySceneHost } from './scenes/host.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import type { SceneAccess } from '../scenes/httpServices.js';
import { createProductDispatcher } from '../capabilities/runtime/product.js';
import { prepareAppContext, checkAppContextAccess } from './service/app-context-access.js';
import type { GatewayPrincipal } from './security/gateway-principal.js';
import { ManagedComposioEventPoller } from '../connectors/composio-managed-events.js';
import {
  applyAutomaticVoiceLanguage,
  inferProductLanguageFromEnvironment,
  initializeVoiceDefaults,
  type ProductLanguage,
} from '../voice/language-profile.js';
import {
  startConnectedKnowledgeCoordinator,
  type ConnectedKnowledgeCoordinator,
} from '../knowledge/index.js';
import { EndpointToolRuntime } from '../endpoint-tools/index.js';
import { HomeIntelligenceHost } from '../home-intelligence/host.js';
import { HomeAdviceGenerator } from '../home-intelligence/generator.js';
import { HomeSnapshotBuilder } from '../home-intelligence/snapshot.js';
import { HomeCapabilityPreflightService } from '../home-intelligence/capability-preflight.js';
import { listKnowledgeItems } from '../knowledge-memory/index.js';
import { resolveKnowledgeReadPolicy } from '../user-context/config.js';
import { listSessionMetadata } from '../storage/sqlite/session-repository.js';

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
  private browserAutomationService: BrowserAutomationService | null = null;
  private notesService: NotesService;
  private extensionLoader: ExtensionLoader | null = null;
  private extensionMetadataSnapshot: import('../extensions/extension-metadata-snapshot.js').ExtensionMetadataSnapshot | null = null;
  private sceneHost: GatewaySceneHost | null = null;
  private homeIntelligenceHost: HomeIntelligenceHost | null = null;
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
  private isRealtimePrincipalActive = (principalId: string): boolean => {
    if (!principalId.startsWith('browser:')) return true;
    try { return isBrowserSessionActive(principalId.slice('browser:'.length), this.auth); } catch { return false; }
  };
  readonly realtime = new RealtimeRuntime(this.endpointTools, this.isRealtimePrincipalActive);
  readonly voiceRealtime = new VoiceRealtimeRuntime({
    isPrincipalActive: this.isRealtimePrincipalActive,
    getConversationContext: async (conversationId, expectedTranscriptId) => {
      const before = await this.sessionIndex.getSessionMetadata(conversationId);
      if (before?.transcriptId !== expectedTranscriptId) throw new Error('Conversation changed before voice connection');
      const messages = await this.sessionIndex.loadMessages(conversationId);
      const after = await this.sessionIndex.getSessionMetadata(conversationId);
      if (after?.transcriptId !== expectedTranscriptId) throw new Error('Conversation changed while loading voice context');
      const profile = resolveEffectiveAgentProfileForSession(conversationId);
      const persona = buildVoicePersonaContext({
        getConfig: () => this.config,
        conversationId,
        maxChars: voicePersonaBudget(this.config.voice.realtime.omni.instructions),
      });
      const context = {
        identity: persona.block,
        history: messages,
        isCurrent: persona.isCurrent,
      };
      const memory = buildVoiceMemoryContext({
        getConfig: () => this.config, conversationId,
        workspaceId: getSessionConfig(conversationId)?.workingDirectoryOverride ?? profile.resolvedWorkspacePath,
        projectId: after?.projectId, history: messages,
        maxChars: voiceMemoryBudget(this.config.voice.realtime.omni.instructions, context),
      });
      return { ...context, ...(memory ? { memory } : {}) };
    },
    getSessionIdentity: async (conversationId) => (await this.sessionIndex.getSessionMetadata(conversationId))?.transcriptId,
    recordOmniTranscript: async (conversationId, callId, entry, expectedTranscriptId) => {
      await this.sessionIndex.appendTranscriptCustomMessageEntry(conversationId, {
        expectedTranscriptId,
        customType: 'voice_omni_transcript',
        content: entry.text,
        display: true,
        details: { callId, itemId: entry.itemId, role: entry.role, interrupted: entry.interrupted, engine: 'omni' },
      });
      this.emit('session.transcript_updated', { key: conversationId });
    },
    getConfig: () => this.config,
    sessionExists: async (conversationId) => Boolean(await this.sessionIndex.getSessionMetadata(conversationId)),
    sessionBusy: (conversationId) => Boolean(this.agentRunner.getActiveRunId(conversationId)) || this.agentRunner.inputs.snapshot(conversationId).inputs.some((input) => input.status === 'queued'),
    recordInterruption: (entry) => this.sessionIndex.appendTranscriptContextEntry(entry.conversationId, {
      text: 'Voice response was interrupted before playback completed.',
      data: {
        type: 'voice_response_interrupted',
        responseId: entry.responseId,
        reason: entry.reason,
        generatedCharacters: entry.generatedCharacters,
        interruptedDuring: entry.interruptedDuring,
      },
    }),
    agentBroker: new DurableVoiceAgentBroker({
      submit: (input) => this.agentRunner.submitSessionInput(input),
      find: findSessionInput,
      snapshot: (conversationId) => this.agentRunner.inputs.snapshot(conversationId),
      currentSequence: (topic) => this.realtime.broker.currentSequence(topic),
      subscribe: (topic, afterSeq, listener) => this.realtime.broker.subscribe(topic, afterSeq, listener),
      cancelRun: async (runId) => { await this.agentRunner.abortAgentRun(runId); },
    }),
  });

  getConfig(): Config {
    return this.config;
  }

  getModelCatalogSync(): ModelCatalogSyncService {
    return this.modelCatalogSync;
  }

  get browserAutomations(): BrowserAutomationService {
    if (!this.browserAutomationService) {
      this.browserAutomationService = createRuntimeBrowserAutomationService({
        getConfig: () => this.config,
        endpointTools: this.endpointTools,
        emit: (type, payload) => this.emit(type, payload),
      });
    }
    return this.browserAutomationService;
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
  private managedComposioEventPoller?: ManagedComposioEventPoller;
  private notificationService: NotificationService | null = null;
  private connectorSupervisor: ConnectorSupervisor | null = null;
  private connectorLearningCoordinator: ConnectorLearningCoordinator | null = null;
  private connectedKnowledgeCoordinator: ConnectedKnowledgeCoordinator | null = null;
  private stopAutomationProductEventBridge: (() => void) | null = null;
  private stopSessionTranscriptAutomationEvents: (() => void) | null = null;
  private stopRealtimeLogBridge: (() => void) | null = null;

  /**
   * Webchat agent invocation surface (`runAgent`, `abortAgentRun`, `steer*`,
   * clarification dispatch). Owns the
   * `activeWebchatRunBySession` + `runAbortControllers` maps.
   */
  readonly agentRunner: GatewayAgentRunner;

  /** Process-local, non-persistent side conversations forked from durable sessions. */
  readonly sideChats: EphemeralSideChatManager;
  readonly sideChatRuns: SideChatRunService;
  readonly sideChatPromotions: SideChatPromotionService;

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
  private _workDiscovery: WorkDiscoveryService | undefined;

  get workDiscovery(): WorkDiscoveryService {
    return this._workDiscovery ??= new WorkDiscoveryService({
      projects: this.projects,
      sessions: this.sessionIndex,
      getConfig: () => this.config,
      emit: (type, payload) => this.emit(type, payload),
    });
  }
  readonly discussions: DiscussionService;
  readonly discussionWorker: DiscussionOrganizerWorker;
  readonly discussionLiveWorker: DiscussionLiveWorker;
  readonly discussionSealer: DiscussionSealer;

  /** Local user-created apps, their coder projects, previews, and installs. */
  readonly localApps: LocalAppService;
  /** Immutable, conversation-scoped UI previews that do not create projects. */
  readonly chatPreviews: ChatPreviewService;

  get sceneAccess(): SceneAccess | undefined {
    return this.sceneHost ? { services: this.sceneHost.http,
      principal: { ownerId: 'local-owner', workspaceId: this.workspacePath } } : undefined;
  }

  constructor(private serviceConfig: GatewayServiceConfig = {}) {
    this.bus = new MessageBus();
    this.configPath = serviceConfig.configPath || resolveConfigPath();
    bootstrapApplicationStateSync(this.configPath);
    this.config = loadConfig(this.configPath);
    let bootstrapConfigChanged = initializeVoiceDefaults(
      this.config,
      inferProductLanguageFromEnvironment(),
    );
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

    this.automationService = new AutomationService();

    this.notesService = new NotesService(new NotesStore());

    this.projects = new ProjectService();
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
      processRecordingJob: () => this.discussions.processRecordingJob(),
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
    this.chatPreviews = new ChatPreviewService({ localApps: this.localApps });

    this.agentRunner = new GatewayAgentRunner({
      validateConnectionResume: async input => {
        for (const source of input.contextSnapshots ?? []) {
          if (source.kind === 'app_context') {
            await checkAppContextAccess(source, this.appContextDispatcher(), this.auth);
          }
        }
        return this.connectionRecovery.preflight(input);
      },
      bus: this.bus,
      sessionIndex: this.sessionIndex,
      getAgentService: () => this.ensureAgentService(),
      getChannelManager: () => this.channelManager,
      getConfig: () => this.config,
      resolveTurnContext: async (ref, conversationId) => {
        if (ref.kind === 'task') return buildTaskAgentContext(new TaskRepository().get(ref.sourceId), ref.expectedVersion);
        if (ref.kind === 'file') {
          const files = getGatewayFileSpaceService(this);
          const space = await files.forContext('session', conversationId).catch(() => null);
          if (!space) return null;
          return buildFileAgentContext(
            files,
            ref.sourceId,
            ref.expectedVersion,
            space.id,
          );
        }
        if (ref.kind === 'session') {
          const [metadata, messages] = await Promise.all([
            this.sessionIndex.getSessionMetadata(ref.sourceId),
            this.sessionIndex.getStore().loadMessages(ref.sourceId),
          ]);
          return buildSessionAgentContext(metadata, messages, ref.expectedVersion);
        }
        if (ref.kind === 'mcp_resource') {
          return buildMcpResourceAgentContext({
            workspaceDir: this.currentWorkspacePath,
            config: this.config,
            sourceId: ref.sourceId,
            expectedVersion: ref.expectedVersion,
          });
        }
        if (ref.kind === 'browser_tab') {
          const binding = getBrowserTabBindingById(ref.sourceId);
          if (!binding
            || binding.conversationId !== conversationId
            || (ref.expectedVersion && ref.expectedVersion !== binding.documentId)) return null;
          const wire = await new RealtimeExtensionBrowserProvider(this.endpointTools).send({
            action: 'observe',
            sessionId: `context:${binding.conversationId}`,
            target: { kind: 'attached_tab', bindingId: binding.id },
            visual: 'never',
          }).catch(() => null);
          if (!wire?.result.ok || !wire.result.receipt.observation) return null;
          return buildBrowserTabAgentContext(ref.sourceId, wire.result.receipt.observation, ref.expectedVersion);
        }
        const note = await this.notesService.getNote(ref.sourceId);
        if (!note || note.status === 'trashed') return null;
        if (ref.expectedVersion && ref.expectedVersion !== String(note.updatedAt)) return null;
        const context = await buildNoteAgentContext({
          note,
          notesService: this.notesService,
          config: this.config,
        });
        const { images: _images, ...snapshot } = context;
        return snapshot;
      },
      emit: (type, payload) => this.emit(type, payload),
      publishRealtime: (topic, event, data) => {
        this.realtime.broker.publish(topic, event, data);
      },
      completeRealtimeTopic: (topic) => this.realtime.completeTopic(topic),
    });

    let sideChatRuns: SideChatRunService | undefined;
    this.sideChats = new EphemeralSideChatManager({
      getParentMetadata: (conversationId) => this.sessionIndex.getSessionMetadata(conversationId),
      getParentConfig: async (conversationId) => getSessionConfig(conversationId),
      loadParentMessages: (conversationId) => this.sessionIndex.getStore().load(conversationId),
      getDefaultModelRef: (conversationId) => this.ensureAgentService().getModelForSession(conversationId),
      getDefaultThinkingLevel: (conversationId) => this.ensureAgentService().getThinkingLevelForSession(conversationId),
      getWorkspacePath: (metadata) => metadata.cwd || this.currentWorkspacePath,
      onBeforeDispose: async (sideChatId, clientInstanceId, messages) => {
        await sideChatRuns?.cancelRun(sideChatId, clientInstanceId);
        await deleteMediaUris(collectMediaUrisFromMessages(messages));
      },
      onExpired: (sideChatId, clientInstanceId, reason) => {
        const topic = `side-chat:${clientInstanceId}:${sideChatId}`;
        this.realtime.broker.publish(topic, 'expired', { reason });
        this.realtime.completeTopic(topic);
      },
    });
    this.sideChatRuns = sideChatRuns = new SideChatRunService({
      manager: this.sideChats,
      getAgentService: () => this.ensureAgentService(),
      agentRunner: this.agentRunner,
      publishRealtime: (topic, event, data) => this.realtime.broker.publish(topic, event, data),
      completeRealtimeTopic: (topic) => this.realtime.completeTopic(topic),
    });
    this.sideChatPromotions = new SideChatPromotionService({
      manager: this.sideChats,
      sessionIndex: this.sessionIndex,
      getAgentService: () => this.ensureAgentService(),
    });

    this.sessions = new GatewaySessionsApi({
      sessionIndex: this.sessionIndex,
      getAgentService: () => this.ensureAgentService(),
      getActiveWebchatRunId: (sk) => this.agentRunner.getActiveRunId(sk),
      listActiveWebchatRuns: () => this.agentRunner.listActiveRuns(),
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
      getExtensionLoader: () => this.extensionLoader,
      reconcileMemoryMaintenanceAutomations: () => this.reconcileMemoryMaintenanceAutomations(),
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

  /** Refresh long-lived runtime caches after an Agent catalog mutation. */
  refreshAgentCatalog(): void {
    this._agentService?.applyRuntimeConfiguration(this.config);
    void this.reconcileMemoryMaintenanceAutomations().catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ err: error, errorMessage }, `Agent catalog refresh failed: ${errorMessage}`);
    });
    this.emit('agent.catalog', {});
  }

  private ensureAgentService(): AgentService {
    if (this._agentService) {
      return this._agentService;
    }

    this._agentService = new AgentService(this.bus, {
      workspace: this.workspacePath,
      model: getAgentDefaultModelRef(),
      config: this.config,
      sessionStore: this.sessionIndex.getStore(),
      onSessionMetadataUpdated: (conversationId, patch) => {
        this.sessionIndex.emit('sessionUpdated', { key: conversationId, name: patch?.name });
        this.emit('session.updated', { key: conversationId, name: patch?.name });
      },
      onSessionTranscriptUpdated: (conversationId) => {
        this.emit('session.transcript_updated', { key: conversationId });
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
      getSceneAccess: () => this.sceneAccess,
      getBrowserAutomationService: () => this.browserAutomations,
      emitBrowserEvent: (type, payload) => this.emit(type, payload),
      getNotesService: () => this.notesService,
      getProjectService: () => this.projects,
      getWorkDiscovery: () => this._workDiscovery ?? undefined,
      getLocalAppService: () => this.localApps,
      getChatPreviewService: () => this.chatPreviews,
      dispatchTaskEvents: () => this.dispatchTaskEvents(),
      dispatchTaskRuns: () => this.dispatchTaskRuns(),
      onAgentCatalogMutate: () => this.refreshAgentCatalog(),
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
        requestClarification: (context, request) => {
          const executionConversationId = getEmbeddedExecutionSession() ?? context.conversationId;
          return this.agentRunner.requestClarification({
            conversationId: executionConversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            request,
            publishStreamFor: (_runId) => (event: ClarificationStreamEvent) => {
              this._agentService!.turnDispatcher.enqueueWebchatStreamEvent(executionConversationId, event);
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
      getDefaultAgentId: () => getDefaultAgentId(),
      prepareAgentSession: (input) => prepareAutomationAgentSession(
        this.sessionIndex.getStore(),
        this.projects,
        input,
      ),
      workflowRunService: this.createWorkflowRunService(),
      browserAutomationService: this.browserAutomations,
      executeTaskCommand: ({ taskId, idempotencyKey, command, triggerEvent }) => {
        const task = new TaskRepository().get(taskId);
        if (!task) return { ok: false, reason: 'not_found' };
        const result = new TaskApplicationService().execute({
          taskId, idempotencyKey, expectedVersion: task.version, command,
          actor: { kind: 'system', id: 'automation' },
          ...(triggerEvent ? { triggerContext: { automationTrigger: triggerEvent } } : {}),
        });
        if (result.ok && result.runId) this.dispatchTaskRuns();
        if (result.ok === false) return { ok: false, reason: result.reason };
        return { ok: true, ...(result.runId ? { runId: result.runId } : {}) };
      },
      executeSystemAction: (input) => this.executeSystemAutomationAction(input),
      onRunCompleted: (run) => this.handleAutomationRunCompleted(run),
    });

    return this._agentService;
  }

  // ── Webchat agent runner (delegated to GatewayAgentRunner) ────────────

  private createTaskRunDispatcher(): TaskRunDispatcher {
    if (!this.taskRunDispatcher) {
      this.taskRunDispatcher = new TaskRunDispatcher({
        workerId: 'gateway-agent',
        ensureSession: async (taskId, runId, requestedAgentId) => {
          return (await this.ensureTaskConversation(taskId, { runId, requestedAgentId })).conversationId;
        },
        runAgent: async (runId, conversationId, message) => {
          const taskRun = new TaskRunRepository().require(runId);
          const followUpBinding = getSqliteDatabase().prepare('SELECT 1 FROM scene_task_bindings WHERE task_id = ?').get(taskRun.taskId);
          if (followUpBinding) {
            if (!this.sceneHost?.http.followUps) throw new Error('Task follow-up runtime is disabled');
            // The shared AgentService owns the single transcript persistence listener.
            this.ensureAgentService();
            await this.sceneHost.http.followUps.executeTask(runId, conversationId);
            return;
          }
          const clientMessageId = `task:${runId}`;
          const session = await this.sessionIndex.getSessionMetadata(conversationId);
          if (!session) throw new Error('Task session is unavailable');
          insertSessionInput({ id: crypto.randomUUID(), conversationId, clientMessageId, expectedTranscriptId: session.transcriptId,
            requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: message,
            origin: { type: 'system', source: 'workflow' }, taskRunId: runId,
          });
          void this.agentRunner.inputs.drain(conversationId);
          await this.agentRunner.inputs.waitForCompletion(conversationId, clientMessageId);
        },
      });
    }
    return this.taskRunDispatcher;
  }

  private createNotificationService(): NotificationService {
    if (!this.notificationService) {
      this.notificationService = new NotificationService({
        publish: (type, payload) => this.realtime.broker.publish('gateway', type, payload),
        allowsNotification: notification => notification.target.kind !== 'task'
          || this.sceneHost?.http.followUps?.allowsTaskNotification(notification.target.taskId) !== false,
      });
    }
    return this.notificationService;
  }

  private readonly taskRunDispatch = createBackgroundTask(async () => {
    new TaskSignalService().tick();
    this.notesService.flushCommittedEffects();
    this.projects.flushCommittedEffects();
    this._workDiscovery?.dispatchProjectUnderstanding();
    this.dispatchTaskEvents();
    this.createTaskRunDispatcher().dispatch();
    await this.createWorkflowRunService().dispatchTaskRuns();
  }, (err) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ err, errorMessage, phase: 'task_run_dispatch' }, `Task dispatch failed: ${errorMessage}`);
  });

  dispatchTaskRuns(): void {
    this.taskRunDispatch();
  }

  async ensureTaskConversation(
    taskId: string,
    options: { runId?: string; requestedAgentId?: string } = {},
  ): Promise<{
    conversationId: string;
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
        conversationId: active.conversationId,
        agentId,
        runId: options.runId,
      });
      return { conversationId: active.conversationId, agentId, created: false, conversation };
    }

    const peerId = `task-${sanitizeSegment(task.id) || Date.now()}`;
    const conversationId = resolveConversationId({
      agentId,
      source: 'webchat',
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    });
    patchSessionMetadata(conversationId, {
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
    });
    if (task.projectId) this.projects.attachSession(conversationId, task.projectId);
    const conversation = conversations.activateExecutionSession({
      taskId: task.id,
      conversationId,
      agentId,
      runId: options.runId,
    });
    return { conversationId, agentId, created: true, conversation };
  }

  dispatchTaskEvents(): void {
    new DomainOutboxDispatcher(event => {
      if (event.source === 'local_apps') this.emit(event.type, event.payload);
      else publishAutomationProductEvent(event);
    }).drain();
  }

  runAgent(
    ...args: Parameters<GatewayAgentRunner['runAgent']>
  ): ReturnType<GatewayAgentRunner['runAgent']> {
    return this.agentRunner.runAgent(...args);
  }

  readonly connectionRecovery = new ConnectionRecoveryService({
    getConfig: () => this.config,
    saveConfig: (config) => this.saveConfig(config),
    drain: (conversationId) => { void this.agentRunner.inputs.drain(conversationId); },
  });

  submitSessionInput(...args: Parameters<GatewayAgentRunner['submitSessionInput']>) {
    return this.agentRunner.submitSessionInput(...args);
  }

  private appContextDispatcher() {
    return createProductDispatcher(() => this.notesService, {
      getProjects: () => this.projects, getLocalApps: () => this.localApps,
      getSceneAccess: () => this.sceneAccess,
    });
  }

  prepareSessionAppContext(input: unknown, principal: GatewayPrincipal, conversationId: string, clientMessageId: string) {
    const previous = findSessionInput(conversationId, clientMessageId)?.contextSnapshots?.find(source => source.kind === 'app_context');
    return prepareAppContext(input, principal, this.auth, this.appContextDispatcher(), previous);
  }

  replaceLatestSessionTurn(...args: Parameters<GatewayAgentRunner['replaceLatestSessionTurn']>) {
    return this.agentRunner.replaceLatestSessionTurn(...args);
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

  getActiveWebchatRunId(conversationId: string): string | undefined {
    return this.agentRunner.getActiveRunId(conversationId);
  }

  answerEphemeralClarification(requestId: string, answer: string): boolean {
    return this.agentRunner.answerEphemeralClarification(requestId, answer);
  }

  getClarificationState(conversationId: string) {
    return this.agentRunner.getClarificationState(conversationId);
  }

  resolveClarificationResponse(input: Parameters<GatewayAgentRunner['resolveClarificationResponse']>[0]) {
    return this.agentRunner.resolveClarificationResponse(input);
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
      await this.extensionLoader.startServices();
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
    await this.extensionLoader.startServices();
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
      await this.extensionLoader.startServices();
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
    if (this.running) this.workDiscovery.resumeProjectUnderstanding();

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
    try {
      await this.startRuntime();
    } catch (err) {
      await this.stop().catch((cleanupError) => log.error({ err: cleanupError }, 'Gateway startup cleanup failed'));
      await this.sceneHost?.stop();
      this.sceneHost = null;
      this.homeIntelligenceHost?.stop();
      this.homeIntelligenceHost = null;
      this.stopRealtimeLogBridge?.();
      this.stopRealtimeLogBridge = null;
      setPairingBroadcastSink(null);
      throw err;
    }
  }

  private async startRuntime(): Promise<void> {
    if (this.running) return;

    this.stopRealtimeLogBridge = subscribeToLogs((entry) => {
      this.realtime.broker.publish('logs', 'log.entry', entry);
    });

    setPairingBroadcastSink((type, payload) => {
      this.emit(type, payload);
    });

    log.debug('Starting gateway service...');
    const homeCapabilities = new HomeCapabilityPreflightService({
      config: () => this.config,
      agentId: () => resolveDefaultAgentId(),
      skills: (agentId) => this.agentService.getAgentSkillAvailability(agentId).skills,
      principalId: 'local-owner',
    });
    this.homeIntelligenceHost = new HomeIntelligenceHost(getSqliteDatabase(), {
      principal: { ownerId: 'local-owner', workspaceId: this.workspacePath },
      snapshot: new HomeSnapshotBuilder({
        projects: () => this.projects.list({ limit: 500 }).items,
        tasks: () => new TaskRepository().list({ limit: 200 }),
        knowledge: () => listKnowledgeItems({ statuses: ['active'], limit: 200 }),
        knowledgePolicy: () => this.config.userContext.knowledgeMemory.enabled
          ? resolveKnowledgeReadPolicy(this.config.userContext.knowledgeMemory)
          : { scopes: [], contentSources: [] },
        sessions: () => listSessionMetadata({ limit: 50, excludeArchived: true }).items,
      }),
      generator: new HomeAdviceGenerator(() => this.config),
      capabilities: () => homeCapabilities.inventory(),
      resolveCapabilities: (requirements, options) => homeCapabilities.resolve(requirements, options),
      publish: (type, payload) => this.realtime.broker.publish('gateway', type, payload),
      notifyOpportunity: (payload) => this.emit('home.opportunity.ready', payload),
      locale: () => 'en',
      enabled: () => this.config.userContext.enabled && this.config.userContext.homeIntelligence.enabled,
      dispatchTaskRuns: () => this.dispatchTaskRuns(),
    });
    await this.localApps.recoverPendingReleases();
    const { recoverCapabilityImports } = await import('../imports/runtime.js');
    await recoverCapabilityImports();
    this.createNotificationService().start();
    this.startTime = Date.now();
    this.running = true;
    this.taskRunDispatchTimer = setInterval(() => this.dispatchTaskRuns(), 1_000);
    this.taskRunDispatchTimer.unref?.();
    if (this.config.gateway?.scenes?.enabled === true) {
      this.sceneHost = new GatewaySceneHost(getSqliteDatabase(), {
        principal: { ownerId: 'local-owner', workspaceId: this.workspacePath },
        config: () => this.config,
        publish: (type, notification) => this.realtime.broker.publish('gateway', type, notification),
      });
    }
    this.startupTrace = createGatewayStartupTrace();
    this.readiness.markStarting(this.startTime);
    const trace = this.startupTrace;

    const catalogCoordinator = getXopcCloudCatalogCoordinator();
    const catalog = await trace.measure('model-catalog.hydrate', () => catalogCoordinator.hydrate());
    const defaultModel = getAgentDefaultModelRef();
    if (defaultModel?.startsWith('xopc-cloud/') && catalog.source === 'none') {
      const readiness = await trace.measure('model-catalog.initial-refresh', () =>
        catalogCoordinator.ensure({
          reason: 'startup',
          network: 'if-empty',
          timeoutMs: 10_000,
        }));
      if (readiness.error) {
        log.warn(
          {
            provider: 'xopc-cloud',
            phase: 'catalog_refresh',
            errorMessage: readiness.error.message,
          },
          `Initial XOPC Cloud catalog refresh failed: ${readiness.error.message}`,
        );
      }
    }

    registerClarificationChannelRuntime({
      answerChoice: (requestId, choiceIndex, idempotencyKey) =>
        this.agentRunner.answerClarificationChoice(requestId, choiceIndex, idempotencyKey),
      answerText: (conversationId, text, idempotencyKey) =>
        this.agentRunner.answerClarificationText(conversationId, text, idempotencyKey),
    });

    this.ensureAgentService();
    this.agentRunner.recoverSessionInputs();
    this.connectionRecovery.start();

    this.channelManager.setOutboundHooks({
      runMessageSending: (to, content, channel) =>
        this.agentService.outboundCoordinator.invokeOutboundMessageSending(to, content, channel),
      runMessageSent: (to, content, success, error, channel) =>
        this.agentService.outboundCoordinator.invokeOutboundMessageSent(to, content, success, error, channel),
    });
    this.channelManager.enableOutboundPersistence(getDefaultAgentId());

    if (this.extensionLoader) {
      this.extensionLoader.setRuntimeContext({
        bus: this.bus,
        sessionManager: this.sessionIndex,
        scheduleWebchatContinuation: (conversationId: string, continuationMessage: string) => {
          queueMicrotask(() => {
            void this.agentRunner.drainScheduledWebchatContinuation(conversationId, continuationMessage);
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
      getDefaultAgentId: () => getDefaultAgentId(),
      prepareAgentSession: (input) => prepareAutomationAgentSession(
        this.sessionIndex.getStore(),
        this.projects,
        input,
      ),
      workflowRunService: this.createWorkflowRunService(),
      browserAutomationService: this.browserAutomations,
      executeTaskCommand: ({ taskId, idempotencyKey, command, triggerEvent }) => {
        const task = new TaskRepository().get(taskId);
        if (!task) return { ok: false, reason: 'not_found' };
        const result = new TaskApplicationService().execute({
          taskId, idempotencyKey, expectedVersion: task.version, command,
          actor: { kind: 'system', id: 'automation' },
          ...(triggerEvent ? { triggerContext: { automationTrigger: triggerEvent } } : {}),
        });
        if (result.ok && result.runId) this.dispatchTaskRuns();
        if (result.ok === false) return { ok: false, reason: result.reason };
        return { ok: true, ...(result.runId ? { runId: result.runId } : {}) };
      },
      executeSystemAction: (input) => this.executeSystemAutomationAction(input),
      onRunCompleted: (run) => this.handleAutomationRunCompleted(run),
    });
    this.startAutomationProductEventBridge();

    await trace.measure('workflows.reconcile', () => this.reconcileInterruptedWorkflowRuns());

    this.sessionIndex.on('sessionUpdated', (data: { key: string; name?: string; tags?: string[] }) => {
      this.emit('session.updated', { key: data.key, name: data.name, tags: data.tags });
    });

    await trace.measure('automations.initialize', () => this.automationService.initialize());
    await trace.measure('homeIntelligence.reconcileAutomation', () => reconcileHomeIntelligenceAutomation(this.automationService));
    await trace.measure('memoryMaintenance.reconcile', () => this.reconcileMemoryMaintenanceAutomations());

    await this.notesService.initialize();
    this.discussionLiveWorker.start();
    this.discussionSealer.start();
    this.discussionWorker.start();


    this.connectorSupervisor = startConnectorSupervisor({
      getConfig: () => this.config,
      saveConfig: (cfg) => this.saveConfig(cfg),
    });
    this.connectorLearningCoordinator = startConnectorLearningCoordinator({
      getConfig: () => this.config,
      resolveAgentId: () => resolveDefaultAgentId(),
      emit: (type, payload) => this.emit(type, payload),
    });
    this.managedComposioEventPoller = new ManagedComposioEventPoller({
      getConfig: () => this.config,
      triggerAutomation: (event) => this.automationService.triggerEvent(event),
      requestLearning: (toolkit) => { this.requestConnectorLearningForToolkit(toolkit); },
      setLearningPaused: (connectionId, paused) => { this.setConnectorLearningPaused(connectionId, paused); },
    });
    this.managedComposioEventPoller.start();
    this.connectedKnowledgeCoordinator = startConnectedKnowledgeCoordinator({
      resolvePipelineOptions: () => ({
        agentId: resolveDefaultAgentId(),
        workspaceId: this.currentWorkspacePath,
      }),
    });

    void import('../browser/providers/browser-ext-install.js')
      .then(({ ensureBrowserExtensionOnStartup }) => ensureBrowserExtensionOnStartup(this.config))
      .catch((err) => log.warn({ err }, 'Browser extension artifact ensure failed'));

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
      .then(({ runStagingSweep }) => runStagingSweep(
        [...new Set([getDefaultAgentId(), ...listAgentEntries().map(entry => entry.id)])]
          .map(agentId => resolveAgentWorkspaceDir(agentId)),
      ))
      .catch((err) => log.warn({ err }, 'Share staging sweep failed'));

    if (this.serviceConfig.deferChannelConnectUntilAfterHttp !== true) {
      this.markGatewayReady();
    } else {
      trace.mark('service.started-awaiting-http');
    }

    this.sceneHost?.start();
    this.homeIntelligenceHost.start();
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
    this.stopRealtimeLogBridge?.();
    this.stopRealtimeLogBridge = null;

    log.debug('Stopping gateway service...');
    await this._workDiscovery?.stop();
    this.readiness.markStarting();
    this.endpointTools.close();
    await this.sideChats.disposeAll();
    await this.sceneHost?.stop();
    this.sceneHost = null;
    this.homeIntelligenceHost?.stop();
    this.homeIntelligenceHost = null;
    this.realtime.close();
    this.voiceRealtime.close();

    await this.discussionWorker.stop();
    await this.discussionSealer.stop();
    await this.discussionLiveWorker.stop();
    this.notificationService?.stop();
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

    this.connectorSupervisor?.stop();
    this.connectorSupervisor = null;
    this.connectorLearningCoordinator?.stop();
    this.connectorLearningCoordinator = null;
    this.managedComposioEventPoller?.stop();
    this.managedComposioEventPoller = undefined;
    this.connectedKnowledgeCoordinator?.stop();
    this.connectedKnowledgeCoordinator = null;

    await this.browserAutomationService?.shutdown();

    registerClarificationChannelRuntime(null);
    this.connectionRecovery.stop();
    this.agentRunner.disposeClarifications();
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

    await this.extensionLoader?.shutdown();

    await this.automationService.stop();
    this.stopAutomationProductEventBridge?.();
    this.stopAutomationProductEventBridge = null;
    this.stopSessionTranscriptAutomationEvents?.();
    this.stopSessionTranscriptAutomationEvents = null;

    // Flush notes to disk

    // Tear down rate-limit cleanup timers so the process can exit cleanly.
    buckets.destroyAll();

    closeXopcDatabase();

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

  // ── Config persistence / hot reload (delegated to GatewayConfigCoordinator) ──

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
    return { applied: changed, language, mode };
  }

  setExtensionActivationTarget(
    extensionId: string,
    wanted: boolean,
  ): Promise<{ ok: boolean; error?: string; requiresGatewayRestart: boolean }> {
    return this.configCoordinator.setExtensionActivationTarget(extensionId, wanted);
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

  get homeIntelligence(): HomeIntelligenceHost {
    if (!this.homeIntelligenceHost) throw new Error('Home intelligence is not running');
    return this.homeIntelligenceHost;
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

  private async reconcileMemoryMaintenanceAutomations(): Promise<void> {
    await reconcileMemoryMaintenanceAutomations({
      config: this.config,
      automationService: this.automationService,
    });
  }

  private executeSystemAutomationAction(input: {
    capability: Extract<AutomationAction, { kind: 'system' }>['capability'];
    runId: string;
  }): { summary: string } {
    if (input.capability === 'home.advisor.refresh') {
      const generationId = this.homeIntelligence.requestRefresh('scheduled_refresh', `automation:${input.runId}`);
      return { summary: generationId === 'disabled' ? 'Home AI suggestions are disabled' : `Home advice refresh queued: ${generationId}` };
    }
    const maintenance = this.config.userContext.userModel.maintenance;
    if (!this.config.userContext.enabled || !this.config.userContext.userModel.enabled || !maintenance.enabled) {
      return { summary: 'Memory maintenance is disabled' };
    }
    const jobType = input.capability.slice('memory.'.length) as 'temporal_sweep' | 'daily_reconciliation' | 'weekly_knowledge';
    const result = runMemoryMaintenance({
      jobType,
      limit: maintenance.limit,
      staleRetentionDays: maintenance.staleRetentionDays,
      evidenceThreshold: maintenance.evidenceThreshold,
    });
    return { summary: `Memory maintenance completed: ${JSON.stringify(result.metrics)}` };
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
    ids.add(resolveDefaultAgentId());
    for (const entry of listAgentEntries()) {
      if (entry.enabled === false) continue;
      ids.add(normalizeAgentId(entry.id));
    }
    return [...ids];
  }

  /** Process a message directly through the agent (for CLI mode). */
  async processDirect(content: string, conversationId = resolveAgentMainConversationId({ agentId: getDefaultAgentId() })): Promise<string> {
    return this.agentService.turnDispatcher.processDirect(
      content,
      conversationId,
      { type: 'system', source: 'internal' },
    );
  }

  emit(type: string, payload: unknown): void {
    if (type === 'config.reload') notifyUserContextChange({ kind: 'policy' });
    if (type === 'connector.learning.updated' && payload && typeof payload === 'object') {
      const job = payload as Record<string, unknown>;
      if (job.status === 'completed'
        && typeof job.sourceInstanceId === 'string'
        && typeof job.updatedAt === 'string') {
        this.homeIntelligenceHost?.sourceChanged({
          sourceInstanceId: job.sourceInstanceId,
          revision: job.updatedAt,
          refresh: this.config.userContext.homeIntelligence.refreshOnContextChange,
        });
      }
    }
    this.realtime.broker.publish('gateway', type, payload);
    this.createNotificationService().handleGatewayEvent(type, payload);
  }

  private handleAutomationRunCompleted(run: AutomationRun): void {
    void this.automationService.get(run.automationId).then((automation) => {
      if (!automation) return;
      const requiresAttention = run.status !== 'succeeded'
        || (automation.safety?.mode ?? 'auto_apply') !== 'auto_apply';
      this.emit('automation.run.completed', {
        run,
        notificationPolicy: automation.notificationPolicy,
        requiresAttention,
        projectId: automation.projectId,
      });
    }).catch((err) => {
      log.warn({ err, automationId: run.automationId, runId: run.id }, 'Automation completion event failed');
    });
  }

  private startAutomationProductEventBridge(): void {
    this.stopAutomationProductEventBridge?.();
    this.stopSessionTranscriptAutomationEvents?.();
    this.stopAutomationProductEventBridge = onAutomationProductEvent((event) => {
      if (event.type === 'project.deleted' && typeof event.payload.projectId === 'string') {
        const runIds = event.payload.deletedUnderstandingRunIds;
        if (Array.isArray(runIds) && runIds.every(id => typeof id === 'string')) {
          this._workDiscovery?.abortDeletedProjectRuns(event.payload.projectId, runIds);
        }
      }
      if (event.type === 'note.created' || event.type === 'note.updated' || event.type === 'note.deleted' || event.type === 'task.changed.v2' || event.type === 'task.deleted.v1' || event.type === 'project.changed' || event.type === 'project.created' || event.type === 'project.deleted' || event.type === 'scene.changed' || event.type === 'scene.created' || event.type === 'scene.deleted') {
        const note = event.type.startsWith('note.');
        const project = event.type.startsWith('project.');
        const scene = event.type.startsWith('scene.');
        const payload = event.payload as Record<string, unknown>;
        if (typeof payload.sourceEventId === 'string') this.realtime.broker.publish(
          note ? 'resources:notes' : project ? 'resources:projects' : scene ? 'resources:scenes' : 'resources:tasks', 'resource.changed', {
            eventId: payload.sourceEventId, kind: note ? 'note' : project ? 'project' : scene ? 'scene' : 'task',
            id: note ? payload.noteId : project ? payload.projectId : scene ? payload.sceneId : payload.taskId, revision: note || scene ? payload.revision : payload.version,
            operation: event.type === 'task.deleted.v1' || event.type.endsWith('.deleted') ? 'deleted' : event.type.endsWith('.created') ? 'created' : 'updated',
            ...(typeof payload.operationId === 'string' ? { operationId: payload.operationId } : {}),
          });
      }
      if (event.type.startsWith('task.')) {
        this.emit(event.type, event.payload);
      }
      if (this.config.userContext.homeIntelligence.refreshOnContextChange
        && (event.type.startsWith('task.') || event.type.startsWith('project.'))) {
        const payload = event.payload as Record<string, unknown>;
        const objectId = event.type.startsWith('task.') ? payload.taskId : payload.projectId;
        const revision = payload.version ?? payload.revision ?? 'unknown';
        this.homeIntelligenceHost?.requestRefresh(
          event.type.startsWith('task.') ? 'task_changed' : 'project_changed',
          `domain:${event.type}:${String(objectId)}:${String(revision)}`,
        );
      }
      void this.automationService.triggerEvent(event).catch((err) => {
        const em = err instanceof Error ? err.message : String(err);
        log.warn({ err, eventType: event.type, source: event.source }, `Automation product event failed: ${em}`);
      });
    });
    this.stopSessionTranscriptAutomationEvents = onSessionTranscriptUpdate((update) => {
      if (!update.conversationId || getSessionMetadata(update.conversationId)?.sourceChannel === 'automation') return;
      publishAutomationProductEvent({
        type: 'session.transcript.updated',
        source: 'sessions',
        payload: {
          conversationId: update.conversationId,
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

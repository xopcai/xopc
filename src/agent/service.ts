import type { AgentEvent, AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { MessageBus } from '../infra/bus/index.js';
import { type Config, getAgentDefaultModelRef } from '../config/schema.js';
import { maybeAutoTitleSessionStore } from '../session/session-title.js';
import type { ChannelManager } from '../channels/manager.js';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  SessionStore,
  SessionConfigStore,
  onSessionTranscriptUpdate,
  effectiveWorkspacePathForSession,
  type CompactionConfig,
  type WindowConfig,
} from '../session/index.js';
import { type ThinkLevel } from './transcript/thinking-types.js';
import { createLogger } from '../utils/logger.js';
import { ExtensionHookRunner } from '../extensions/index.js';
import { extractTextContent } from './context/workspace.js';
import { SessionTracker } from './session/tracker.js';
import { ModelManager } from './models/index.js';
import { initializeCommands } from '../chat-commands/index.js';
import { ProgressFeedbackManager } from './lifecycle/progress.js';
import { HookHandler } from './lifecycle/hook-handler.js';
import { ToolErrorTracker } from './tools/error-tracker.js';
import { RequestLimiter } from './models/request-limiter.js';
import { SystemReminder } from './prompt/system-reminder.js';
import { ToolUsageAnalyzer } from './tools/usage-analyzer.js';
import { ToolChainTracker } from './tools/chain-tracker.js';
import { ErrorPatternMatcher } from './tools/error-pattern-matcher.js';
import { ContextMiddleware, SelfVerifyMiddleware } from './middleware/index.js';
import { LifecycleManager } from './lifecycle/index.js';
import { CompactionLifecycleHandler } from './lifecycle/handlers/compaction.js';

import {
  MessageRouter,
  CommandHandler,
  StreamManager,
  OutboundCoordinator,
} from './messaging/index.js';
import { InboundLoop } from './inbound/inbound-loop.js';
import { TurnDispatcher } from './inbound/turn-dispatcher.js';
import {
  SessionContextManager,
  SessionLifecycleManager,
  SessionStateBag,
  SessionConfigService,
  SessionHydrator,
  SessionInspector,
  type SessionContext,
} from './session/index.js';
import { AgentOrchestrator, AgentEventHandler } from './orchestration/index.js';
import { FeedbackCoordinator } from './feedback/index.js';
import { AgentManager, type SkillCatalogEntry } from './agent-manager.js';
import type { SkillMarkdownPreviewPayload } from './skills/types.js';
import type { AgentServiceConfig, StreamHandle } from './service.types.js';
import { PersistentGoalService } from './goals/persistent-goal-service.js';
import { reconcileManagedDreamingCronJobs } from './service/reconcile-dreaming-cron.js';
import { parseOutboundSessionKey } from './service/parse-outbound-session-key.js';

import {
  resolveAgentHomeDir,
  resolveAgentProfileDir,
  resolveDefaultAgentId,
} from './agent-scope.js';
import {
  extractProfileAgentId,
  resolveEffectiveAgentProfileForSession,
} from '../config/agent-profile.js';
import { type TypingController } from './lifecycle/typing.js';
import { cleanTrailingErrors } from './memory/message-sanitizer.js';
import { tryApplySessionTranscriptHygiene } from './transcript/transcript-hygiene.js';
import {
  persistInboundAttachmentsToWorkspace,
  type InternalAttachmentRoots,
} from '../channels/attachments/inbound-persist.js';
import { applyConfigOverrides } from '../config/runtime-overrides.js';

export type { AgentServiceConfig, AgentContext, StreamHandle } from './service.types.js';

const log = createLogger('AgentService');

export class AgentService {
  /**
   * Persistent transcript + session-metadata store. Public so the gateway/TUI
   * can read sessions, delete them, etc. without forcing every CRUD-style
   * operation through a delegation method on `AgentService`.
   */
  readonly sessionStore: SessionStore;
  private sessionConfigStore: SessionConfigStore;
  private hookRunner?: ExtensionHookRunner;
  private agentId: string;
  private workspaceDir: string;
  private channelManagerRef: ChannelManager | null = null;
  private bus: MessageBus;
  private config: AgentServiceConfig;

  private sessionTracker: SessionTracker;
  private modelManager: ModelManager;
  private progressManager: ProgressFeedbackManager;
  private hookHandler: HookHandler;
  private lifecycleManager: LifecycleManager;
  private errorTracker: ToolErrorTracker;
  private requestLimiter: RequestLimiter;
  private systemReminder: SystemReminder;
  private toolUsageAnalyzer: ToolUsageAnalyzer;
  private toolChainTracker: ToolChainTracker;
  private errorPatternMatcher: ErrorPatternMatcher;
  private selfVerifyMiddleware: SelfVerifyMiddleware;
  private contextMiddleware: ContextMiddleware;

  private messageRouter: MessageRouter;
  private commandHandler: CommandHandler;
  private streamManager: StreamManager;
  /**
   * Outbound pipeline: typing controller, silence guard, final response publish,
   * extension `message_sending`/`message_sent` hooks, post-turn `webchat_turn_complete`
   * event. Public so the gateway / channels can drive it directly.
   */
  readonly outboundCoordinator: OutboundCoordinator;
  private inboundLoop: InboundLoop;
  /**
   * Direct-turn entry points: `processDirect` (one-shot), `processDirectStreaming`
   * (SSE generator), webchat steering and SSE injection. Public so the gateway,
   * TUI, CLI, and cron jobs do not need to thread every call through `AgentService`.
   */
  readonly turnDispatcher: TurnDispatcher;
  /**
   * `/goal` runtime: continuation scheduling, persistent-goal API factory,
   * stream-outcome state, post-turn verdict. Public so the gateway can wire
   * the webchat continuation scheduler and read stream outcomes directly.
   */
  readonly persistentGoals: PersistentGoalService;
  /**
   * Per-session config writes (model / thinking / reasoning / working directory).
   * Public so REST endpoints and CLI flows can hit it without going through a
   * monolithic patch entrypoint on `AgentService`.
   */
  readonly sessionConfig: SessionConfigService;
  /**
   * Hydration — read persisted per-session config and apply it to the runtime
   * (AgentManager / ModelManager). The mirror image of `sessionConfig`: writes
   * go through `sessionConfig`, reads-into-runtime go through `sessionHydrator`.
   */
  readonly sessionHydrator: SessionHydrator;
  /**
   * Read-only introspection (compaction, /context report, /btw, contextUsage,
   * agentConfig view). Public so REST endpoints and CLI flows can query a
   * session's view without going through delegating methods on `AgentService`.
   */
  readonly sessionInspector: SessionInspector;
  private sessionContextManager: SessionContextManager;
  private sessionLifecycleManager: SessionLifecycleManager;
  private agentOrchestrator: AgentOrchestrator;
  private agentEventHandler: AgentEventHandler;
  private feedbackCoordinator: FeedbackCoordinator;
  private agentManager: AgentManager;

  /**
   * Unified per-session state container (replaces six ad-hoc Maps). Owns webchat
   * publishers, last assistant text, embedded stream buffer, persistent-goal stream
   * outcomes, concurrent-turn depth, and event-listener unsubscribers; runs a TTL
   * sweep for slots that have no explicit owner.
   */
  private sessionState = new SessionStateBag();

  /** Gateway: notify UI after direct `SessionStore.updateMetadata` (no SessionManager emit). */
  private onSessionMetadataUpdated?: (sessionKey: string) => void;
  private onSessionTranscriptUpdated?: (sessionKey: string) => void;

  private effectiveAppConfig(): Config | undefined {
    const base = this.config.config;
    return base ? applyConfigOverrides(base) : undefined;
  }

  constructor(bus: MessageBus, config: AgentServiceConfig) {
    this.bus = bus;
    this.config = config;
    this.onSessionMetadataUpdated = config.onSessionMetadataUpdated;
    this.onSessionTranscriptUpdated = config.onSessionTranscriptUpdated;
    this.agentId = `agent-${Date.now()}`;
    this.workspaceDir = config.workspace;

    this.sessionTracker = new SessionTracker();
    this.modelManager = new ModelManager({
      defaultModel: config.model,
      config: config.config,
    });

    initializeCommands();
    log.debug('Command system initialized');

    this.sessionStore = config.sessionStore ?? this.createSessionStore();
    onSessionTranscriptUpdate((update) => {
      void this.sessionStore.syncSessionsJsonFromTranscriptUpdate(update).catch((err) => {
        log.warn(
          { err, sessionFile: update.sessionFile, sessionKey: update.sessionKey },
          'Transcript index sync failed',
        );
      });
      const sk = update.sessionKey?.trim();
      if (sk) {
        this.onSessionTranscriptUpdated?.(sk);
      }
    });
    const appCfgForPaths = this.config.config;
    if (!appCfgForPaths) {
      throw new Error('AgentService requires config.config for session paths');
    }
    const defaultAid = resolveDefaultAgentId(appCfgForPaths);
    const defaultAgentHome = resolveAgentHomeDir(appCfgForPaths, defaultAid);
    this.sessionConfigStore = new SessionConfigStore(defaultAgentHome);

    this.hookRunner = this.createHookRunner();
    this.hookHandler = new HookHandler({
      hookRunner: this.hookRunner,
      agentId: this.agentId,
      get sessionKey() { return this.currentContext?.sessionKey; },
    });

    this.progressManager = this.createProgressManager();
    this.initializeReliabilityModules();

    this.lifecycleManager = new LifecycleManager();
    this.initializeLifecycleHandlers();

    this.streamManager = new StreamManager();
    this.sessionContextManager = new SessionContextManager();
    this.feedbackCoordinator = new FeedbackCoordinator({
      progressManager: this.progressManager,
      bus,
    });

    // Initialize AgentManager
    this.agentManager = new AgentManager({
      workspace: config.workspace,
      model: config.model,
      config: config.config,
      extensionRegistry: config.extensionRegistry,
      hookRunner: this.hookRunner,
      bus,
      getCurrentContext: () => this.sessionContextManager.getContext(),
      getSessionStore: () => this.sessionStore,
      getModelManager: () => this.modelManager,
      thinkingLevel: config.thinkingLevel,
      reasoningLevel: config.reasoningLevel,
      verboseLevel: config.verboseLevel,
      gatewayClarify: config.gatewayClarify,
      getCronService: config.getCronService,
    });

    this.agentEventHandler = new AgentEventHandler({
      progressManager: this.progressManager,
      errorTracker: this.errorTracker,
      requestLimiter: this.requestLimiter,
      lifecycleManager: this.lifecycleManager,
      toolChainTracker: this.toolChainTracker,
      selfVerifyMiddleware: this.selfVerifyMiddleware,
      systemReminder: this.systemReminder,
      toolUsageAnalyzer: this.toolUsageAnalyzer,
      errorPatternMatcher: this.errorPatternMatcher,
    });

    // sessionHydrator is constructed early because AgentOrchestrator + InboundLoop +
    // TurnDispatcher all need it; the SessionConfigService instance below also
    // shares the same constructor parameters.
    this.sessionHydrator = new SessionHydrator({
      sessionConfigStore: this.sessionConfigStore,
      agentManager: this.agentManager,
      modelManager: this.modelManager,
      getConfig: () => this.effectiveAppConfig(),
    });

    this.agentOrchestrator = new AgentOrchestrator({
      agentManager: this.agentManager,
      sessionStore: this.sessionStore,
      modelManager: this.modelManager,
      eventHandler: this.agentEventHandler,
      feedbackCoordinator: this.feedbackCoordinator,
      sessionConfigStore: this.sessionConfigStore,
      sessionHydrator: this.sessionHydrator,
      getConfig: () => this.effectiveAppConfig(),
      getThinkingDefault: () => this.effectiveAppConfig()?.agents?.defaults?.thinkingDefault,
      getThinkingDefaultForSession: (sessionKey: string) =>
        this.agentManager.getThinkingDefaultForSession(sessionKey),
      workspaceRoot: this.workspaceDir,
      getWorkspaceRootForSession: (sessionKey: string) =>
        this.agentManager.getResolvedWorkspaceForSession(sessionKey),
      getAgentInternalStorageRootForSession: (sessionKey: string) =>
        resolveAgentHomeDir(this.config.config!, extractProfileAgentId(sessionKey, this.config.config!)),
      enqueueAutoTitle: (sessionKey: string) => this.enqueueMaybeAutoTitleAfterPersist(sessionKey),
      onEmbeddedStreamEvent: (sessionKey, event) => {
        const ctx = this.sessionContextManager.getContext();
        if (!ctx || ctx.sessionKey !== sessionKey) {
          return;
        }
        if (event.type === 'token') {
          const next = this.sessionState.appendEmbeddedStreamText(sessionKey, event.content);
          this.streamManager.update(next);
        }
      },
      onEmbeddedTurnComplete: (sessionKey, text) => {
        if (text) {
          this.sessionState.setLastAssistantText(sessionKey, text);
        }
        this.sessionState.clearEmbeddedStreamText(sessionKey);
      },
    });

    this.messageRouter = new MessageRouter();
    this.commandHandler = new CommandHandler({
      config: config.config!,
      bus,
      sessionStore: this.sessionStore,
      sessionConfigStore: this.sessionConfigStore,
      getPersistentGoalApisForCommand: (routing) => this.persistentGoals.buildApisForRouting(routing),
      applySessionThinkingLevel: (sessionKey: string, level: ThinkLevel) => {
        this.agentManager.setThinkingLevel(sessionKey, level as ThinkingLevel);
      },
      getCurrentModel: () => this.agentOrchestrator.getCurrentModel(),
      switchModelForSession: (sessionKey: string, modelId: string) =>
        this.switchModelForSession(sessionKey, modelId),
      invalidateAgentSession: (sessionKey: string) => {
        this.agentManager.removeAgent(sessionKey);
      },
      abortSessionTurn: async (sessionKey: string) => {
        await this.streamManager.abort();
        this.agentOrchestrator.abort(sessionKey);
      },
      compactSession: (sessionKey, options) => this.sessionInspector.compact(sessionKey, options),
      btwQuery: (sessionKey, question) => this.sessionInspector.btwQuery(sessionKey, question),
      getSessionContextReport: (sessionKey, mode) => this.sessionInspector.report(sessionKey, mode),
    });

    this.sessionLifecycleManager = new SessionLifecycleManager(
      this.sessionStore,
      this.sessionTracker,
      this.lifecycleManager
    );

    this.persistentGoals = new PersistentGoalService({
      bus,
      sessionStore: this.sessionStore,
      modelManager: this.modelManager,
      sessionState: this.sessionState,
      getConfig: () => this.effectiveAppConfig(),
      getResolvedWorkspaceForSession: (sk) => this.agentManager.getResolvedWorkspaceForSession(sk),
      onSessionMetadataUpdated: this.onSessionMetadataUpdated,
      notifyWebchatTranscriptAppend: (sk, text) => this.turnDispatcher.notifyWebchatTranscriptAppend(sk, text),
    });

    this.sessionConfig = new SessionConfigService({
      sessionStore: this.sessionStore,
      sessionConfigStore: this.sessionConfigStore,
      modelManager: this.modelManager,
      agentManager: this.agentManager,
      getConfig: () => this.effectiveAppConfig(),
    });

    this.sessionInspector = new SessionInspector({
      sessionStore: this.sessionStore,
      sessionConfigStore: this.sessionConfigStore,
      modelManager: this.modelManager,
      agentManager: this.agentManager,
      sessionHydrator: this.sessionHydrator,
      getConfig: () => this.effectiveAppConfig(),
      getContextWindow: () => this.getContextWindow(),
    });

    this.outboundCoordinator = new OutboundCoordinator({
      bus,
      hookHandler: this.hookHandler,
      streamManager: this.streamManager,
      getConfig: () => this.effectiveAppConfig(),
      getLastAssistantPlainText: (sk) => this.getLastAssistantPlainText(sk),
      runPersistentGoalPostTurn: (payload) => this.persistentGoals.runPostTurn(payload),
    });

    this.turnDispatcher = new TurnDispatcher({
      log,
      agentManager: this.agentManager,
      sessionStore: this.sessionStore,
      modelManager: this.modelManager,
      sessionConfigStore: this.sessionConfigStore,
      sessionState: this.sessionState,
      commandHandler: this.commandHandler,
      getConfig: () => this.effectiveAppConfig(),
      requireConfig: () => {
        const c = this.config.config;
        if (!c) throw new Error('AgentService requires config.config');
        return c;
      },
      parseSessionKey: (sk) => this.parseSessionKey(sk),
      initSessionContext: (sk, channel, chatId) => this.initSessionContext(sk, channel, chatId),
      sessionHydrator: this.sessionHydrator,
      attachmentRootsForSession: (sk) => this.attachmentRootsForSession(sk),
      prepareInboundAttachments: (sk, att) => this.prepareInboundAttachments(sk, att),
      enqueueMaybeAutoTitleAfterPersist: (sk) => this.enqueueMaybeAutoTitleAfterPersist(sk),
      endDirectRequestContext: () => this.endDirectRequestContext(),
      onSessionTranscriptUpdated: this.onSessionTranscriptUpdated,
    });

    this.inboundLoop = new InboundLoop({
      log,
      agentId: this.agentId,
      bus,
      hookHandler: this.hookHandler,
      messageRouter: this.messageRouter,
      commandHandler: this.commandHandler,
      sessionContextManager: this.sessionContextManager,
      feedbackCoordinator: this.feedbackCoordinator,
      agentManager: this.agentManager,
      sessionLifecycleManager: this.sessionLifecycleManager,
      agentOrchestrator: this.agentOrchestrator,
      outboundCoordinator: this.outboundCoordinator,
      streamManager: this.streamManager,
      sessionState: this.sessionState,
      sessionStore: this.sessionStore,
      modelManager: this.modelManager,
      setupSessionEventHandling: (sk) => this.setupSessionEventHandling(sk),
      sessionHydrator: this.sessionHydrator,
      getLastAssistantPlainText: (sk) => this.getLastAssistantPlainText(sk),
      checkAndCompact: (sk, msgs) => this.checkAndCompact(sk, msgs),
      enqueueMaybeAutoTitleAfterPersist: (sk) => this.enqueueMaybeAutoTitleAfterPersist(sk),
      getConfig: () => this.effectiveAppConfig(),
      setStreamHandle: (handle) => this.setStreamHandle(handle),
    });

    // Register signal handlers only if not running as an Electron subprocess.
    // In Electron, the parent process manages the lifecycle and signals should not trigger disposal.
    const isElectronSubprocess = !!process.env.ELECTRON_RUN_AS_NODE;
    if (!isElectronSubprocess) {
      process.on('SIGINT', () => this.dispose());
      process.on('SIGTERM', () => this.dispose());
    }

    log.info('AgentService initialized');
  }

  private attachmentRootsForSession(sessionKey: string): InternalAttachmentRoots {
    const cfg = this.config.config!;
    return {
      agentHome: resolveAgentHomeDir(cfg, extractProfileAgentId(sessionKey, cfg)),
    };
  }

  private createSessionStore(): SessionStore {
    const sessionStoreDefaults = this.config.agentDefaults || this.config.config?.agents?.defaults;
    const windowConfig: Partial<WindowConfig> = {
      maxMessages: 100,
      keepRecentMessages: sessionStoreDefaults?.maxToolIterations || 20,
      preserveSystemMessages: true,
    };
    const compactionConfig: Partial<CompactionConfig> = {
      enabled: sessionStoreDefaults?.compaction?.enabled ?? true,
      mode: (sessionStoreDefaults?.compaction?.mode as 'extractive' | 'abstractive' | 'structured') || 'abstractive',
      reserveTokens: sessionStoreDefaults?.compaction?.reserveTokens || 8000,
      triggerThreshold: sessionStoreDefaults?.compaction?.triggerThreshold || 0.8,
      minMessagesBeforeCompact: sessionStoreDefaults?.compaction?.minMessagesBeforeCompact || 10,
      keepRecentMessages: sessionStoreDefaults?.compaction?.keepRecentMessages || 10,
      evictionWindow: sessionStoreDefaults?.compaction?.evictionWindow || 0.2,
      retentionWindow: sessionStoreDefaults?.compaction?.retentionWindow || 6,
    };
    const appCfg = this.config.config;
    if (!appCfg) {
      throw new Error('AgentService requires config.config for session store paths');
    }
    return new SessionStore(
      {
        config: appCfg,
        agentId: resolveDefaultAgentId(appCfg),
      },
      windowConfig,
      compactionConfig,
    );
  }

  private createHookRunner(): ExtensionHookRunner | undefined {
    if (!this.config.extensionRegistry) return undefined;

    return new ExtensionHookRunner(this.config.extensionRegistry, {
      catchErrors: true,
      logger: {
        info: (msg: string) => log.info({ hook: true }, msg),
        warn: (msg: string) => log.warn({ hook: true }, msg),
        error: (msg: string) => log.error({ hook: true }, msg),
      },
    });
  }

  private createProgressManager(): ProgressFeedbackManager {
    return new ProgressFeedbackManager({
      level: 'normal',
      showThinking: true,
      streamToolProgress: true,
      heartbeatEnabled: true,
      heartbeatIntervalMs: 20000,
      longTaskThresholdMs: 30000,
    });
  }

  private initializeReliabilityModules(): void {
    const defaults = this.config.agentDefaults || this.config.config?.agents?.defaults;

    this.errorTracker = new ToolErrorTracker({
      maxFailuresPerTool: defaults?.maxToolFailuresPerTurn || 3,
      maxTotalFailures: defaults?.maxToolFailuresPerTurn ? defaults.maxToolFailuresPerTurn + 2 : 5,
      resetOnTurnEnd: true,
    });

    this.selfVerifyMiddleware = new SelfVerifyMiddleware({
      maxEditsPerFile: 5,
      enablePreCompletionCheck: true,
      minTurnsForVerification: 4,
      resetOnVerification: true,
    });

    this.requestLimiter = new RequestLimiter({
      maxRequestsPerTurn: defaults?.maxRequestsPerTurn || 50,
      warnThreshold: 0.8,
      softLimit: false,
    });

    this.systemReminder = new SystemReminder({
      enabled: true,
      appendToToolResults: true,
      maxRemindersPerTurn: 3,
    });

    this.toolUsageAnalyzer = new ToolUsageAnalyzer({
      enabled: true,
      lowUsageThreshold: 5,
      veryLowUsageThreshold: 1,
      minCallsForAnalysis: 100,
      reportIntervalMs: 60 * 60 * 1000,
    });

    this.toolChainTracker = new ToolChainTracker({
      enabled: true,
      maxChainsPerSession: 10,
      maxNodesPerChain: 100,
      trackParams: true,
      trackResults: true,
      autoPrune: true,
    });

    this.errorPatternMatcher = new ErrorPatternMatcher({
      enabled: true,
      defaultMaxRetries: 1,
      logMatches: true,
    });

    // Initialize context middleware for automatic request tracking
    this.contextMiddleware = new ContextMiddleware();
  }

  private initializeLifecycleHandlers(): void {
    this.lifecycleManager.on('llm_response', new CompactionLifecycleHandler({
      minMessages: 20,
      maxTokens: 8000,
      preserveReasoning: true,
      accumulateUsage: true,
    }));

    log.debug(
      { handlers: this.lifecycleManager.getRegisteredHandlers() },
      'Lifecycle handlers initialized'
    );
  }

  setChannelManager(channelManager: ChannelManager): void {
    this.modelManager.setChannelManager(channelManager);
    this.channelManagerRef = channelManager;
    this.inboundLoop.setChannelManager(channelManager);
  }

  /**
   * Apply config after save or hot reload so the default model updates without restarting the gateway.
   */
  applyAgentDefaultsFromConfig(config: Config): void {
    this.config.config = config;
    const ref = getAgentDefaultModelRef(config);
    this.config.model = ref;
    this.modelManager.updateFromConfig(config);
    this.agentManager.updateAgentDefaults(config);
    this.commandHandler.updateAgentConfig(config);
  }

  getSkillCatalog(lang?: string): SkillCatalogEntry[] {
    return this.agentManager.getSkillCatalog(lang);
  }

  getSkillMarkdownSource(skillName: string, lang?: string): SkillMarkdownPreviewPayload | null {
    return this.agentManager.getSkillMarkdownSource(skillName, lang);
  }

  refreshSkillsAfterDiskChange(): void {
    this.agentManager.refreshSkillsAfterDiskChange();
  }

  refreshSkillsAfterSkillConfigChange(): void {
    this.agentManager.refreshSkillsAfterSkillConfigChange();
  }

  getModelForSession(sessionKey: string): string {
    return this.modelManager.getModelForSession(sessionKey);
  }

  async switchModelForSession(sessionKey: string, modelId: string): Promise<boolean> {
    const ok = await this.modelManager.switchModelForSession(sessionKey, modelId);
    if (!ok) return false;
    await this.sessionConfigStore.update(sessionKey, { modelOverride: modelId });
    const result = this.agentManager.setModelForSession(sessionKey, modelId);
    if (result) {
      this.sessionTracker.touchSession(sessionKey);
    }
    return true;
  }

  /**
   * Clears per-session model override so the next turn uses the configured agent default
   * (e.g. cron isolated job with no explicit model).
   */
  async resetSessionModelToAgentDefault(sessionKey: string): Promise<void> {
    await this.sessionConfig.clearModelOverride(sessionKey);
  }

  setStreamHandle(handle: StreamHandle): void {
    this.streamManager.setHandle(handle);
    this.feedbackCoordinator.setStreamHandle(handle);
  }

  clearStreamHandle(): void {
    this.streamManager.clearHandle();
    this.feedbackCoordinator.endTask();
  }

  /** Last assistant visible plain text for a session (e.g. after a webchat stream). */
  getLastAssistantPlainText(sessionKey: string): string {
    return (
      this.sessionState.getLastAssistantText(sessionKey) ??
      this.agentManager.getLastAssistantContent(sessionKey) ??
      ''
    );
  }

  beginInboundTurn(sessionKey: string): void {
    this.sessionState.beginInboundTurn(sessionKey);
  }

  endInboundTurn(sessionKey: string): void {
    this.sessionState.endInboundTurn(sessionKey);
  }

  getInboundTurnDepth(sessionKey: string): number {
    return this.sessionState.getInboundTurnDepth(sessionKey);
  }

  async start(): Promise<void> {
    await this.sessionConfigStore.initialize();
    await this.hookHandler.trigger('gateway_start', { port: 0, host: 'cli' });
    await this.reconcileDreamingCronJob().catch((err) => {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em }, `Dreaming cron reconcile failed: ${em}`);
    });
    log.debug('Agent service started');
    await this.inboundLoop.start();
  }

  stop(): Promise<void> {
    this.inboundLoop.stop();
    this.agentManager.dispose();
    this.dispose();

    this.hookHandler.trigger('gateway_stop', { reason: 'stopped' });
    log.debug('Agent service stopped');
    return Promise.resolve();
  }

  /**
   * Reconcile managed Dreaming cron job against the current effective config.
   * Safe to call after config saves to apply changes without restarting the process.
   */
  async reconcileDreamingNow(): Promise<void> {
    await this.reconcileDreamingCronJob();
  }

  private async reconcileDreamingCronJob(): Promise<void> {
    const cron = this.config.getCronService?.();
    if (!cron) {
      return;
    }
    await reconcileManagedDreamingCronJobs(cron, this.effectiveAppConfig());
  }

  /**
   * Persist agent messages with the same sanitizer + transcript hygiene as AgentOrchestrator.
   * Uses persistence hygiene so `thinking` blocks remain on disk for the web UI (LLM load path still drops them).
   */
  /**
   * Fire-and-forget: `maybeAutoTitleSessionStore` no-ops for cron/heartbeat keys.
   * Runs after persist so the store has the latest transcript; does not block SSE / callers.
   */
  private enqueueMaybeAutoTitleAfterPersist(sessionKey: string): void {
    void (async () => {
      try {
        let modelRef =
          getAgentDefaultModelRef(this.config.config ?? ({} as Config)) ?? this.config.model;
        if (!modelRef?.trim()) {
          try {
            modelRef = this.modelManager.getModelForSession(sessionKey);
          } catch {
            modelRef = undefined;
          }
        }
        await maybeAutoTitleSessionStore(this.sessionStore, sessionKey, modelRef?.trim() || undefined);
      } catch (err) {
        log.warn({ err, sessionKey }, 'Auto session title failed');
      }
    })();
  }

  private prepareLoadedSessionMessages(sessionKey: string, messages: AgentMessage[]): AgentMessage[] {
    let out = cleanTrailingErrors(messages);
    try {
      const model = this.modelManager.getResolvedModelForSession(sessionKey);
      out = tryApplySessionTranscriptHygiene(out, model);
    } catch (err) {
      log.warn({ err, sessionKey }, 'Transcript hygiene on load skipped');
    }
    return out;
  }

  private parseSessionKey(sessionKey: string): { channel: string; chatId: string } {
    return parseOutboundSessionKey(sessionKey, this.config.config);
  }

  private initSessionContext(
    sessionKey: string,
    channel: string,
    chatId: string,
    senderId = '',
  ): SessionContext {
    const context: SessionContext = {
      sessionKey,
      channel,
      chatId,
      senderId,
      isGroup: false,
    };

    this.contextMiddleware.onRequest({
      sessionKey,
      userId: context.senderId,
      channel,
      chatId,
    });

    // Direct turn entry points (one-shot + streaming generator) cannot wrap their
    // body in `sessionContextManager.runWith(ctx, fn)` cleanly — the streaming
    // path is an async generator, and both flows already use a try/finally for
    // side-effect cleanup. We use `enter` so the context is visible via ALS for
    // every async resource launched after this call returns. The context is
    // overwritten or cleared by the next direct turn (each direct turn calls
    // `initSessionContext` first), so there is no cross-session leak in practice.
    this.sessionContextManager.enter(context);
    this.feedbackCoordinator.setContext(context);
    this.agentManager.getOrCreateAgent(sessionKey);
    this.setupSessionEventHandling(sessionKey);

    return context;
  }

  /**
   * Persist inbound file attachments under agent home `inbound/` (non-images with data).
   * Idempotent if `workspaceRelativePath` is already set on an attachment.
   */
  async prepareInboundAttachments(
    sessionKey: string,
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
      workspaceRelativePath?: string;
    }>,
  ): Promise<
    | Array<{
        type: string;
        mimeType?: string;
        data?: string;
        name?: string;
        size?: number;
        workspaceRelativePath?: string;
      }>
    | undefined
  > {
    const cfg = this.config.config!;
    const storageRoot = resolveAgentHomeDir(cfg, extractProfileAgentId(sessionKey, cfg));
    return persistInboundAttachmentsToWorkspace(storageRoot, sessionKey, attachments);
  }

  private endDirectRequestContext(): void {
    // `sessionContextManager` is ALS-backed: the context for the current async
    // chain drops automatically when the chain unwinds. The feedback
    // coordinator + context middleware still use singleton state, so clear
    // them explicitly here.
    this.feedbackCoordinator.clearContext();
    this.contextMiddleware.onResponse();
  }

  /**
   * Reset a session's transcript and drop the in-memory agent so the next turn
   * reloads from disk. Combines two collaborators (sessionStore + agentManager)
   * so it stays on `AgentService`; pure sessionStore reads should use
   * `agentService.sessionStore.*` directly.
   */
  async clearSessionMessages(key: string): Promise<void> {
    await this.sessionStore.saveMessages(key, []);
    this.agentManager.removeAgent(key);
  }

  /**
   * Drop in-memory agent so the next turn reloads transcript from disk (e.g. after checkpoint restore).
   */
  evictSessionAgent(sessionKey: string): void {
    this.agentManager.removeAgent(sessionKey);
  }

  /**
   * Load session working directory override into AgentManager, ensure directory exists.
   * Call before AgentManager.getOrCreateAgent for this session.
   */
  /** Workspace root for UI file tree / editor (same as agent tools after hydration). */
  async getEffectiveWorkspacePathForSession(sessionKey: string): Promise<string> {
    await this.sessionHydrator.workspace(sessionKey);
    const cfg = this.config.config!;
    const sc = await this.sessionConfigStore.get(sessionKey);
    return effectiveWorkspacePathForSession(cfg, sessionKey, sc);
  }

  /**
   * Best-effort timezone resolution for webchat envelope timestamps.
   * Reads `USER.md` under the agent `profile/` directory and extracts a `Timezone:` line.
   */
  resolveUserTimezoneForSession(sessionKey: string): string | undefined {
    try {
      const cfg = this.effectiveAppConfig();
      if (!cfg) return undefined;
      const { agentId } = resolveEffectiveAgentProfileForSession(cfg, sessionKey);
      const userPath = join(resolveAgentProfileDir(cfg, agentId), 'USER.md');
      if (!existsSync(userPath)) return undefined;
      const raw = readFileSync(userPath, 'utf-8');
      const match = raw.match(/Timezone:\s*(.+)/i);
      const tz = match?.[1]?.trim();
      return tz || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Setup event handling for a specific session
   */
  private setupSessionEventHandling(sessionKey: string): void {
    if (this.sessionState.hasSessionEventUnsubscriber(sessionKey)) {
      return;
    }

    const unsubscribe = this.agentManager.subscribeToSession(sessionKey, (event) => {
      this.handleSessionEvent(sessionKey, event);
    });

    if (unsubscribe) {
      this.sessionState.setSessionEventUnsubscriber(sessionKey, unsubscribe);
    }
  }

  /**
   * Handle events from a specific session's agent
   */
  private handleSessionEvent(sessionKey: string, event: AgentEvent): void {
    const currentContext = this.sessionContextManager.getContext();
    if (!currentContext) {
      // Inbound `finally` clears context before trailing agent `message_update` events finish — ignore (not a bug).
      return;
    }

    if (currentContext.sessionKey !== sessionKey) {
      // Event from a different session — still process with current context where applicable
      this.agentEventHandler.handle(event, currentContext);
      return;
    }

    // Handle streaming updates for the current session
    if (event.type === 'message_update') {
      const msgEvent = event as Extract<AgentEvent, { type: 'message_update' }>;
      if (msgEvent.message?.role === 'assistant') {
        const content = msgEvent.message.content;
        const text = Array.isArray(content)
          ? extractTextContent(content as Array<{ type: string; text?: string }>)
          : String(content);

        this.streamManager.update(text);
      }
    }

    this.agentEventHandler.handle(event, currentContext);
  }

  private async checkAndCompact(sessionKey: string, messages: AgentMessage[]): Promise<void> {
    const contextWindow = this.getContextWindow();
    const prep = this.sessionStore.prepareCompaction(sessionKey, messages, contextWindow);
    if (!prep.needsCompaction) return;

    log.info({ sessionKey, reason: prep.stats?.reason, usagePercent: prep.stats?.usagePercent }, 'Session needs compaction');

    const result = await this.sessionStore.compact(sessionKey, messages, contextWindow, undefined, false);
    await this.hookHandler.trigger('after_compaction', {
      messageCount: messages.length,
      tokenCount: result.tokensBefore,
      compactedCount: messages.length - result.firstKeptIndex,
    });
    log.info({ sessionKey, tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter }, 'Session compacted');
  }

  private getContextWindow(): number {
    const defaults = this.config.agentDefaults || this.config.config?.agents?.defaults;
    return defaults?.maxTokens ? defaults.maxTokens * 4 : 128000;
  }

  private dispose(): void {
    this.sessionTracker.dispose();
    this.sessionState.disposeAll();
    this.agentManager.dispose();
  }
}

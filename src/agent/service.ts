import type { AgentEvent, AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';
import { MessageBusShutdownError, type MessageBus, type InboundMessage } from '../infra/bus/index.js';
import { type Config, getAgentDefaultModelRef } from '../config/schema.js';
import { maybeAutoTitleSessionStore } from '../session/session-title.js';
import type { ChannelManager } from '../channels/manager.js';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  SessionStore,
  SessionConfigStore,
  resolveEffectiveThinkingLevel,
  resolveEffectiveReasoningLevel,
  effectiveWorkspacePathForSession,
  normalizeWorkingDirectoryInput,
  type CompactionConfig,
  type WindowConfig,
} from '../session/index.js';
import type { SessionDetail } from '../session/types.js';
import {
  normalizeThinkLevel,
  normalizeReasoningLevel,
  type ThinkLevel,
  type ReasoningLevel,
} from './transcript/thinking-types.js';
import { createLogger, runWithLogContext, updateAsyncLogContext } from '../utils/logger.js';
import { ExtensionHookRunner } from '../extensions/index.js';
import { loadProfileMarkdownFiles, extractTextContent } from './context/workspace.js';
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

import { MessageRouter, CommandHandler, StreamManager } from './messaging/index.js';
import { SessionContextManager, SessionLifecycleManager, type SessionContext } from './session/index.js';
import { AgentOrchestrator, AgentEventHandler } from './orchestration/index.js';
import { FeedbackCoordinator } from './feedback/index.js';
import { AgentManager, type SkillCatalogEntry } from './agent-manager.js';
import type { SkillMarkdownPreviewPayload } from './skills/types.js';
import { inboundMessageLogRequestId } from './service-inbound-utils.js';
import type { AgentServiceConfig, StreamHandle } from './service.types.js';
import {
  runProcessDirectStreaming,
  type ProcessDirectStreamingDeps,
} from './service/process-direct-streaming.js';
import { parseSessionKey as parseRoutingSessionKey } from '../routing/session-key.js';
import { handlePersistentGoalPostTurn } from './goals/post-turn.js';
import type { PersistentGoalApis } from './goals/persistent-goal-apis.js';
import { reconcileManagedDreamingCronJobs } from './service/reconcile-dreaming-cron.js';
import { parseOutboundSessionKey } from './service/parse-outbound-session-key.js';
import { runBtwQuery } from './service/btw-query.js';
import { formatSessionContextReport } from './service/session-context-report.js';
import { buildDirectUserMessageContent } from './service/build-direct-message-content.js';
import { maybeEmitWebchatTts } from './service/webchat-tts.js';
import { runProcessDirect, type RunProcessDirectDeps } from './service/process-direct-one-shot.js';

import {
  resolveAgentHomeDir,
  resolveAgentProfileDir,
  resolveDefaultAgentId,
} from './agent-scope.js';
import {
  extractProfileAgentId,
  resolveEffectiveAgentProfileForSession,
} from '../config/agent-profile.js';
import { DEFAULT_ACK_MAX_CHARS, NO_REPLY, shouldSilence } from '../heartbeat/tokens.js';
import { createTypingController, type TypingController } from './lifecycle/typing.js';
import { cleanTrailingErrors, sanitizeMessages } from './memory/message-sanitizer.js';
import {
  tryApplySessionTranscriptHygiene,
  tryApplySessionTranscriptHygieneForPersistence,
} from './transcript/transcript-hygiene.js';
import {
  persistInboundAttachmentsToWorkspace,
  type InternalAttachmentRoots,
} from '../channels/attachments/inbound-persist.js';
import { applyConfigOverrides } from '../config/runtime-overrides.js';
import type { CompactionResult } from './memory/compaction.js';

export type { AgentServiceConfig, AgentContext, StreamHandle } from './service.types.js';

const log = createLogger('AgentService');

export class AgentService {
  private sessionStore: SessionStore;
  private sessionConfigStore: SessionConfigStore;
  private hookRunner?: ExtensionHookRunner;
  private running = false;
  private agentId: string;
  private workspaceDir: string;
  private profileMarkdownFiles: ReturnType<typeof loadProfileMarkdownFiles> = [];
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
  private sessionContextManager: SessionContextManager;
  private sessionLifecycleManager: SessionLifecycleManager;
  private agentOrchestrator: AgentOrchestrator;
  private agentEventHandler: AgentEventHandler;
  private feedbackCoordinator: FeedbackCoordinator;
  private agentManager: AgentManager;

  /** Webchat SSE queue pushers for `clarify_request` and similar mid-turn UI events. */
  private webchatSseEnqueueBySession = new Map<
    string,
    (event: { type: string; [key: string]: unknown }) => void
  >();

  /** Gateway: drain `processDirectStreaming` for webchat continuations (Hermes FIFO-style). */
  private persistentGoalWebchatContinuationScheduler?: (sessionKey: string, message: string) => void;
  private directStreamOutcomeBySession = new Map<string, { skipPersistentGoalPostTurn: boolean }>();
  /** Concurrent inbound / direct-stream turns per session (Hermes-style /goal mid-flight guard). */
  private inboundTurnDepthBySession = new Map<string, number>();

  /** Gateway: notify UI after direct `SessionStore.updateMetadata` (no SessionManager emit). */
  private onSessionMetadataUpdated?: (sessionKey: string) => void;

  // Track event unsubscribers per session
  private sessionUnsubscribers: Map<string, () => void> = new Map();

  private effectiveAppConfig(): Config | undefined {
    const base = this.config.config;
    return base ? applyConfigOverrides(base) : undefined;
  }

  constructor(bus: MessageBus, config: AgentServiceConfig) {
    this.bus = bus;
    this.config = config;
    this.onSessionMetadataUpdated = config.onSessionMetadataUpdated;
    this.agentId = `agent-${Date.now()}`;
    this.workspaceDir = config.workspace;

    if (config.config) {
      const aid = resolveDefaultAgentId(config.config);
      const profileDir = resolveAgentProfileDir(config.config, aid);
      this.profileMarkdownFiles = loadProfileMarkdownFiles(profileDir);
    } else {
      this.profileMarkdownFiles = [];
    }

    this.sessionTracker = new SessionTracker();
    this.modelManager = new ModelManager({
      defaultModel: config.model,
      config: config.config,
    });

    initializeCommands();
    log.debug('Command system initialized');

    this.sessionStore = config.sessionStore ?? this.createSessionStore();
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
      modelManager: this.modelManager,
    });

    this.agentOrchestrator = new AgentOrchestrator({
      agentManager: this.agentManager,
      sessionStore: this.sessionStore,
      modelManager: this.modelManager,
      eventHandler: this.agentEventHandler,
      feedbackCoordinator: this.feedbackCoordinator,
      sessionConfigStore: this.sessionConfigStore,
      hydrateSessionWorkspaceFromStore: (sessionKey) => this.hydrateSessionWorkspaceFromStore(sessionKey),
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
    });

    this.messageRouter = new MessageRouter();
    this.commandHandler = new CommandHandler({
      config: config.config!,
      bus,
      sessionStore: this.sessionStore,
      sessionConfigStore: this.sessionConfigStore,
      getPersistentGoalApisForCommand: (routing) => this.getPersistentGoalApisForCommand(routing),
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
      compactSession: (sessionKey, options) => this.compactSession(sessionKey, options),
      btwQuery: (sessionKey, question) => this.btwQuery(sessionKey, question),
      getSessionContextReport: (sessionKey, mode) => this.getSessionContextReport(sessionKey, mode),
    });

    this.sessionLifecycleManager = new SessionLifecycleManager(
      this.sessionStore,
      this.sessionTracker,
      this.lifecycleManager
    );

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

  private async clearSessionModelOverride(sessionKey: string): Promise<void> {
    this.modelManager.clearSessionModelOverride(sessionKey);
    await this.sessionConfigStore.update(sessionKey, { modelOverride: undefined });
    const agent = this.agentManager.getAgent(sessionKey);
    if (agent) {
      await this.modelManager.applyModelForSession(agent, sessionKey);
    }
  }

  /**
   * Clears per-session model override so the next turn uses the configured agent default
   * (e.g. cron isolated job with no explicit model).
   */
  async resetSessionModelToAgentDefault(sessionKey: string): Promise<void> {
    await this.clearSessionModelOverride(sessionKey);
  }

  private async hydrateSessionModelFromStore(sessionKey: string): Promise<void> {
    const cfg = await this.sessionConfigStore.get(sessionKey);
    if (cfg?.modelOverride) {
      await this.modelManager.switchModelForSession(sessionKey, cfg.modelOverride);
    }
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
    return this.agentManager.getLastAssistantContent(sessionKey) ?? '';
  }

  /** Gateway only: webchat continuations bypass the bus and reuse `runGatewayAgent`. */
  setPersistentGoalWebchatContinuationScheduler(
    fn: ((sessionKey: string, message: string) => void) | undefined,
  ): void {
    this.persistentGoalWebchatContinuationScheduler = fn;
  }

  beginInboundTurn(sessionKey: string): void {
    this.inboundTurnDepthBySession.set(
      sessionKey,
      (this.inboundTurnDepthBySession.get(sessionKey) ?? 0) + 1,
    );
  }

  endInboundTurn(sessionKey: string): void {
    const n = (this.inboundTurnDepthBySession.get(sessionKey) ?? 1) - 1;
    if (n <= 0) {
      this.inboundTurnDepthBySession.delete(sessionKey);
    } else {
      this.inboundTurnDepthBySession.set(sessionKey, n);
    }
  }

  getInboundTurnDepth(sessionKey: string): number {
    return this.inboundTurnDepthBySession.get(sessionKey) ?? 0;
  }

  schedulePersistentGoalContinuation(
    sessionKey: string,
    message: string,
    routing: { channel: string; chatId: string; inboundMetadata?: Record<string, unknown> },
  ): void {
    const parsed = parseRoutingSessionKey(sessionKey);
    if (parsed?.source === 'webchat' && this.persistentGoalWebchatContinuationScheduler) {
      this.persistentGoalWebchatContinuationScheduler(sessionKey, message);
      return;
    }
    queueMicrotask(() => {
      void this.bus
        .publishInbound({
          channel: routing.channel,
          chat_id: routing.chatId,
          sender_id: 'persistent-goal',
          content: message,
          metadata: { sessionKey, ...routing.inboundMetadata },
        })
        .catch((err) => {
          log.warn({ err, sessionKey }, 'Persistent goal: publishInbound failed');
        });
    });
  }

  getPersistentGoalApisForCommand(routing: {
    sessionKey: string;
    channel: string;
    chatId: string;
    inboundMetadata?: Record<string, unknown>;
  }): PersistentGoalApis {
    return {
      getSessionMetadata: (k) => this.sessionStore.getMetadata(k),
      updateSessionMetadata: async (k, u) => {
        await this.sessionStore.updateMetadata(k, u);
        this.onSessionMetadataUpdated?.(k);
      },
      loadMessages: (k) => this.sessionStore.loadMessages(k),
      saveMessages: (k, m) => this.sessionStore.saveMessages(k, m),
      scheduleContinuation: (sk, msg) => {
        this.schedulePersistentGoalContinuation(sk, msg, {
          channel: routing.channel,
          chatId: routing.chatId,
          inboundMetadata: routing.inboundMetadata,
        });
      },
      inboundConcurrentDepth: (sk) => this.getInboundTurnDepth(sk),
    };
  }

  recordPersistentGoalStreamOutcome(
    sessionKey: string,
    outcome: { skipPersistentGoalPostTurn: boolean },
  ): void {
    this.directStreamOutcomeBySession.set(sessionKey, outcome);
  }

  takePersistentGoalStreamOutcome(sessionKey: string): { skipPersistentGoalPostTurn: boolean } | undefined {
    const v = this.directStreamOutcomeBySession.get(sessionKey);
    this.directStreamOutcomeBySession.delete(sessionKey);
    return v;
  }

  /**
   * After any assistant-visible turn (webchat direct stream or bus-driven channels): extension hook + built-in `/goal` post-turn.
   */
  async emitSessionTurnComplete(payload: {
    sessionKey: string;
    channel: string;
    chatId: string;
    inboundUserText: string;
    assistantPlainText: string;
    aborted: boolean;
    streamError?: string;
    skipPersistentGoalPostTurn?: boolean;
    outboundMetadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.hookHandler.triggerWithSessionKey(payload.sessionKey, 'webchat_turn_complete', {
      sessionKey: payload.sessionKey,
      channel: payload.channel,
      chatId: payload.chatId,
      inboundUserText: payload.inboundUserText,
      assistantPlainText: payload.assistantPlainText,
      aborted: payload.aborted,
      ...(payload.streamError !== undefined ? { streamError: payload.streamError } : {}),
    });

    const apis = this.getPersistentGoalApisForCommand({
      sessionKey: payload.sessionKey,
      channel: payload.channel,
      chatId: payload.chatId,
      inboundMetadata: payload.outboundMetadata,
    });

    const src = parseRoutingSessionKey(payload.sessionKey)?.source;
    const isWebchat = src === 'webchat';
    const publishVerdict =
      !isWebchat && payload.channel !== 'cli'
        ? async (text: string) => {
            await this.bus.publishOutbound({
              channel: payload.channel,
              chat_id: payload.chatId,
              content: text,
              type: 'message',
              metadata: {
                accountId: payload.outboundMetadata?.accountId,
                threadId: payload.outboundMetadata?.threadId,
              },
            });
          }
        : undefined;

    await handlePersistentGoalPostTurn({
      apis,
      sessionKey: payload.sessionKey,
      assistantPlainText: payload.assistantPlainText,
      aborted: payload.aborted,
      ...(payload.streamError !== undefined ? { streamError: payload.streamError } : {}),
      skipPersistentGoalPostTurn: payload.skipPersistentGoalPostTurn ?? false,
      config: this.effectiveAppConfig(),
      publishVerdictToChannel: publishVerdict,
    });
  }

  async start(): Promise<void> {
    this.running = true;
    await this.sessionConfigStore.initialize();
    await this.hookHandler.trigger('gateway_start', { port: 0, host: 'cli' });
    await this.reconcileDreamingCronJob().catch((err) => {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em }, `Dreaming cron reconcile failed: ${em}`);
    });
    log.debug('Agent service started');
    await this.hookHandler.trigger('session_start', { sessionId: this.agentId });

    while (this.running) {
      try {
        const msg = await this.bus.consumeInbound();
        await this.handleInboundMessage(msg);
      } catch (error) {
        if (error instanceof MessageBusShutdownError) {
          break;
        }
        const em = error instanceof Error ? error.message : String(error);
        log.error(
          { err: error, errorMessage: em, phase: 'inbound_consume' },
          `Agent loop failed (will retry in 1s): ${em}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    await this.hookHandler.trigger('session_end', {
      sessionId: this.agentId,
      messageCount: 0, // No longer tracking single agent messages
    });
  }

  stop(): Promise<void> {
    this.running = false;
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
  private async persistAgentSessionMessages(sessionKey: string): Promise<void> {
    const raw = this.agentManager.getMessages(sessionKey);
    if (!raw) {
      return;
    }
    const { messages } = sanitizeMessages(raw);
    let toSave = messages;
    try {
      const model = this.modelManager.getResolvedModelForSession(sessionKey);
      toSave = tryApplySessionTranscriptHygieneForPersistence(messages, model);
    } catch (err) {
      log.warn({ err, sessionKey }, 'Transcript hygiene on save skipped');
    }
    await this.sessionStore.save(sessionKey, toSave);
    this.enqueueMaybeAutoTitleAfterPersist(sessionKey);
  }

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

    this.sessionContextManager.setContext(context);
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
    this.sessionContextManager.clearContext();
    this.feedbackCoordinator.clearContext();
    this.contextMiddleware.onResponse();
  }

  /** Full session snapshot (metadata + API-shaped messages), e.g. embedded TUI history. */
  async loadSessionDetail(sessionKey: string): Promise<SessionDetail | null> {
    return this.sessionStore.get(sessionKey);
  }

  async compactSession(
    sessionKey: string,
    options?: { instructions?: string; force?: boolean },
  ): Promise<CompactionResult> {
    const messages = await this.sessionStore.load(sessionKey);
    const contextWindow = this.getContextWindow();
    const result = await this.sessionStore.compact(
      sessionKey,
      messages,
      contextWindow,
      options?.instructions,
      options?.force ?? true,
    );
    if (result.compacted) {
      await this.sessionStore.save(sessionKey, await this.sessionStore.load(sessionKey));
      this.agentManager.removeAgent(sessionKey);
    }
    log.info({ sessionKey, result }, 'Manual compaction complete');
    return result;
  }

  /**
   * Drop in-memory agent so the next turn reloads transcript from disk (e.g. after checkpoint restore).
   */
  evictSessionAgent(sessionKey: string): void {
    this.agentManager.removeAgent(sessionKey);
  }

  /**
   * One-shot LLM answer for /btw: uses transcript as background only; does not persist to session.
   */
  async btwQuery(sessionKey: string, question: string): Promise<{ text: string; error?: string }> {
    return runBtwQuery({
      sessionKey,
      question,
      sessionStore: this.sessionStore,
      modelForSession: this.modelManager.getModelForSession(sessionKey),
      log,
    });
  }

  /** Markdown or JSON summary for /context (prompt assembly is approximated from config + transcript stats). */
  async getSessionContextReport(
    sessionKey: string,
    mode: 'list' | 'detail' | 'json',
  ): Promise<string> {
    const messages = await this.sessionStore.load(sessionKey);
    const cw = this.getContextWindow();
    const stats = this.getSessionStats(sessionKey, messages);
    const cfg = this.effectiveAppConfig() ?? this.config.config!;
    const model = this.modelManager.getModelForSession(sessionKey);
    const sc = await this.sessionConfigStore.get(sessionKey);
    const workspace = effectiveWorkspacePathForSession(cfg, sessionKey, sc);
    const estTokens = await this.sessionStore.estimateTokenUsage(sessionKey, messages);
    const profile = resolveEffectiveAgentProfileForSession(cfg, sessionKey);
    const defaults = cfg.agents?.defaults;
    const compaction = defaults?.compaction;
    const tools = defaults?.tools;

    const toolsSummary =
      tools && typeof tools === 'object'
        ? Object.entries(tools as Record<string, unknown>)
            .filter(([, v]) => v === true)
            .map(([k]) => k)
            .slice(0, 16)
            .join(', ') || '(none explicitly true)'
        : '(see agents.defaults.tools in config)';

    return formatSessionContextReport({
      sessionKey,
      mode,
      model,
      workspacePath: workspace,
      agentId: profile.agentId,
      messageCount: messages.length,
      contextWindowNominal: cw,
      estimatedTranscriptTokens: estTokens,
      thinkingDefault: defaults?.thinkingDefault,
      reasoningDefault: defaults?.reasoningDefault,
      verboseDefault: defaults?.verboseDefault,
      compaction,
      toolsFlagsSummary: toolsSummary,
      windowStats: stats.windowStats,
      compactionRunStats: stats.compactionStats,
    });
  }

  getSessionStats(sessionKey: string, messages: AgentMessage[]) {
    return {
      windowStats: this.sessionStore.getWindowStats(messages),
      compactionStats: this.sessionStore.getCompactionStats(sessionKey),
      tokenEstimate: this.sessionStore.estimateTokenUsage(sessionKey, messages),
    };
  }

  private async applyResolvedThinkingLevel(sessionKey: string, requestOverride?: string | null): Promise<void> {
    const def = this.effectiveAppConfig()?.agents?.defaults?.thinkingDefault;
    const level = await resolveEffectiveThinkingLevel(
      this.sessionConfigStore,
      sessionKey,
      requestOverride,
      def,
    );
    this.agentManager.setThinkingLevel(sessionKey, level);
  }

  /** Resolved thinking level and effective model ref for a session (Web UI). */
  async getSessionAgentConfig(sessionKey: string): Promise<{
    thinkingLevel: ThinkingLevel;
    model: string;
    reasoningLevel: ReasoningLevel;
    effectiveWorkspacePath: string;
    workingDirectoryLocked: boolean;
  }> {
    await this.hydrateSessionModelFromStore(sessionKey);
    const cfg = this.effectiveAppConfig()!;
    const sc = await this.sessionConfigStore.get(sessionKey);

    // Ensure model display matches the effective agent profile even before an Agent instance exists.
    // Otherwise, `ModelManager.getModelForSession()` falls back to the global default until the first turn creates the agent.
    const profile = resolveEffectiveAgentProfileForSession(cfg, sessionKey);
    const profileModelRef = profile.primaryModelRef?.trim();
    if (profileModelRef) {
      this.modelManager.setSessionProfileDefault(sessionKey, profileModelRef);
    }

    const defThink = cfg.agents?.defaults?.thinkingDefault ?? 'medium';
    const level = await resolveEffectiveThinkingLevel(this.sessionConfigStore, sessionKey, null, defThink);
    const defReason = (cfg.agents?.defaults?.reasoningDefault ?? 'stream') as ReasoningLevel;
    const reasoningLevel = await resolveEffectiveReasoningLevel(this.sessionConfigStore, sessionKey, defReason);
    const model = this.modelManager.getModelForSession(sessionKey);
    return {
      thinkingLevel: level,
      model,
      reasoningLevel,
      effectiveWorkspacePath: effectiveWorkspacePathForSession(cfg, sessionKey, sc),
      workingDirectoryLocked: Boolean(sc?.workingDirectoryOverride?.trim()),
    };
  }

  /**
   * Load session working directory override into AgentManager, ensure directory exists.
   * Call before AgentManager.getOrCreateAgent for this session.
   */
  async hydrateSessionWorkspaceFromStore(sessionKey: string): Promise<void> {
    const cfg = this.config.config;
    if (!cfg) {
      return;
    }
    const loaded = await this.sessionConfigStore.get(sessionKey);
    if (loaded?.workingDirectoryOverride?.trim()) {
      const wdStored = normalizeWorkingDirectoryInput(loaded.workingDirectoryOverride);
      if (wdStored.ok) {
        this.agentManager.setSessionWorkspaceOverride(sessionKey, wdStored.path);
      } else {
        log.warn({ sessionKey }, 'Invalid stored workingDirectoryOverride; ignoring');
        this.agentManager.setSessionWorkspaceOverride(sessionKey, null);
      }
    } else {
      this.agentManager.setSessionWorkspaceOverride(sessionKey, null);
    }
    const effective = effectiveWorkspacePathForSession(cfg, sessionKey, loaded);
    await mkdir(effective, { recursive: true });
  }

  /**
   * Sync persisted session workspace override for an isolated cron run (runs may change when the job is edited).
   * Omit or pass empty `workingDirectory` to use the effective agent default workspace for this session key.
   */
  async applyCronJobWorkingDirectory(sessionKey: string, workingDirectory: string | undefined): Promise<void> {
    const raw = workingDirectory?.trim();
    if (raw) {
      const wdNorm = normalizeWorkingDirectoryInput(raw);
      if (wdNorm.ok === false) {
        log.warn({ sessionKey, error: wdNorm.error }, 'Cron job working directory invalid; using agent default');
        await this.clearCronSessionWorkingDirectoryOverride(sessionKey);
        return;
      }
      await mkdir(wdNorm.path, { recursive: true });
      await this.sessionConfigStore.update(sessionKey, { workingDirectoryOverride: wdNorm.path });
      this.agentManager.setSessionWorkspaceOverride(sessionKey, wdNorm.path);
      return;
    }
    await this.clearCronSessionWorkingDirectoryOverride(sessionKey);
  }

  private async clearCronSessionWorkingDirectoryOverride(sessionKey: string): Promise<void> {
    const existing = await this.sessionConfigStore.get(sessionKey);
    if (existing?.workingDirectoryOverride) {
      const { workingDirectoryOverride: _removed, ...rest } = existing;
      await this.sessionConfigStore.set(sessionKey, rest);
    }
    this.agentManager.setSessionWorkspaceOverride(sessionKey, null);
  }

  /** Workspace root for UI file tree / editor (same as agent tools after hydration). */
  async getEffectiveWorkspacePathForSession(sessionKey: string): Promise<string> {
    await this.hydrateSessionWorkspaceFromStore(sessionKey);
    const cfg = this.config.config!;
    const sc = await this.sessionConfigStore.get(sessionKey);
    return effectiveWorkspacePathForSession(cfg, sessionKey, sc);
  }

  async patchSessionAgentConfig(
    sessionKey: string,
    partial: {
      thinkingLevel?: string;
      model?: string | null;
      reasoningLevel?: string;
      workingDirectory?: string;
    },
  ): Promise<{ ok: boolean; error?: string }> {
    if (partial.model !== undefined) {
      if (partial.model === null || partial.model === '') {
        await this.clearSessionModelOverride(sessionKey);
      } else {
        const ok = await this.modelManager.switchModelForSession(sessionKey, partial.model);
        if (!ok) {
          return { ok: false, error: 'Invalid model' };
        }
        await this.sessionConfigStore.update(sessionKey, { modelOverride: partial.model });
        this.agentManager.setModelForSession(sessionKey, partial.model);
      }
    }

    if (partial.thinkingLevel !== undefined) {
      const normalized = normalizeThinkLevel(partial.thinkingLevel);
      if (!normalized) {
        return { ok: false, error: 'Invalid thinking level' };
      }
      await this.sessionConfigStore.update(sessionKey, { thinkingLevel: normalized });
      this.agentManager.setThinkingLevel(sessionKey, normalized as ThinkingLevel);
    }

    if (partial.reasoningLevel !== undefined) {
      const normalized = normalizeReasoningLevel(partial.reasoningLevel);
      if (!normalized) {
        return { ok: false, error: 'Invalid reasoning level' };
      }
      await this.sessionConfigStore.update(sessionKey, { reasoningLevel: normalized });
    }

    if (partial.workingDirectory !== undefined) {
      const cfg = this.config.config;
      if (!cfg) {
        return { ok: false, error: 'Config not loaded' };
      }
      const existing = await this.sessionConfigStore.get(sessionKey);
      const existingRaw = existing?.workingDirectoryOverride?.trim();
      const incoming = partial.workingDirectory.trim();

      const priorMessages = await this.sessionStore.load(sessionKey);

      if (priorMessages.length > 0) {
        if (!incoming) {
          return { ok: false, error: 'workingDirectory is empty' };
        }
        if (!existingRaw) {
          return {
            ok: false,
            error: 'Working directory can only be set before the first message in this conversation',
          };
        }
        const prev = normalizeWorkingDirectoryInput(existingRaw);
        const next = normalizeWorkingDirectoryInput(incoming);
        if (prev.ok && next.ok && prev.path === next.path) {
          /* idempotent */
        } else {
          return { ok: false, error: 'Working directory is already set for this session' };
        }
      } else {
        if (!incoming) {
          return { ok: false, error: 'workingDirectory is empty' };
        }
        const wdNorm = normalizeWorkingDirectoryInput(incoming);
        switch (wdNorm.ok) {
          case true:
            if (existingRaw) {
              const prev = normalizeWorkingDirectoryInput(existingRaw);
              if (prev.ok && prev.path === wdNorm.path) {
                break;
              }
            }
            await mkdir(wdNorm.path, { recursive: true });
            await this.sessionConfigStore.update(sessionKey, { workingDirectoryOverride: wdNorm.path });
            this.agentManager.setSessionWorkspaceOverride(sessionKey, wdNorm.path);
            this.agentManager.removeAgent(sessionKey);
            break;
          case false:
            return { ok: false, error: wdNorm.error };
          default:
            return { ok: false, error: 'Invalid working directory' };
        }
      }
    }

    return { ok: true };
  }

  async *processDirectStreaming(
    content: string,
    sessionKey = 'cli:direct',
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
      workspaceRelativePath?: string;
    }>,
    thinking?: string,
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<{ type: string; [key: string]: unknown }, void, unknown> {
    yield* runProcessDirectStreaming(this.createProcessDirectStreamingDeps(), {
      content,
      sessionKey,
      attachments,
      thinking,
      signal: options?.signal,
    });
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

  private createProcessDirectStreamingDeps(): ProcessDirectStreamingDeps {
    return {
      log,
      parseSessionKey: (sk) => this.parseSessionKey(sk),
      initDirectStreamingSession: (sk, channel, chatId) => this.initSessionContext(sk, channel, chatId),
      registerWebchatSsePublisher: (sk, publisher) => {
        this.webchatSseEnqueueBySession.set(sk, publisher);
      },
      unregisterWebchatSsePublisher: (sk) => {
        this.webchatSseEnqueueBySession.delete(sk);
      },
      agentManager: this.agentManager,
      hydrateSessionWorkspaceFromStore: (sk) => this.hydrateSessionWorkspaceFromStore(sk),
      hydrateSessionModelFromStore: (sk) => this.hydrateSessionModelFromStore(sk),
      agentEventHandler: this.agentEventHandler,
      sessionStore: this.sessionStore,
      prepareLoadedSessionMessages: (sk, msgs) => this.prepareLoadedSessionMessages(sk, msgs),
      modelManager: this.modelManager,
      applyResolvedThinkingLevel: (sk, t) => this.applyResolvedThinkingLevel(sk, t),
      getConfig: () => this.effectiveAppConfig(),
      sessionConfigStore: this.sessionConfigStore,
      attachmentRootsForSession: (sk) => this.attachmentRootsForSession(sk),
      agentOrchestrator: this.agentOrchestrator,
      commandHandler: this.commandHandler,
      prepareInboundAttachments: (sk, att) => this.prepareInboundAttachments(sk, att),
      buildMessageContent: (text, prepared, sk) =>
        buildDirectUserMessageContent({
          content: text,
          attachments: prepared,
          sessionKey: sk,
          config: this.config.config!,
          agentManager: this.agentManager,
          modelManager: this.modelManager,
        }),
      persistAgentSessionMessages: (sk) => this.persistAgentSessionMessages(sk),
      recordPersistentGoalStreamOutcome: (sk, o) => this.recordPersistentGoalStreamOutcome(sk, o),
      maybeEmitWebchatTts: (sk, hadVoice) =>
        maybeEmitWebchatTts(
          {
            config: this.config.config,
            agentManager: this.agentManager,
            sessionStore: this.sessionStore,
            log,
          },
          sk,
          hadVoice,
        ),
      endDirectRequestContext: () => this.endDirectRequestContext(),
    };
  }

  /**
   * Inject an SSE event into an in-flight webchat stream (same queue as tokens/tools).
   */
  enqueueWebchatSseEvent(sessionKey: string, event: { type: string; [key: string]: unknown }): void {
    const pub = this.webchatSseEnqueueBySession.get(sessionKey);
    if (pub) {
      pub(event);
    }
  }

  /**
   * Queue a steering user message into pi-agent's in-flight run (delivered after current tool work, before the next LLM call).
   * See `Agent.steer` in `@earendil-works/pi-agent-core`.
   */
  async steerWebchatSession(sessionKey: string, text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed) return false;
    try {
      await this.hydrateSessionWorkspaceFromStore(sessionKey);
      const agent = this.agentManager.getOrCreateAgent(sessionKey);
      const msg: AgentMessage = {
        role: 'user',
        content: [{ type: 'text', text: trimmed }],
        timestamp: Date.now(),
      };
      agent.steer(msg);
      return true;
    } catch (err) {
      log.warn({ err, sessionKey }, 'steerWebchatSession failed');
      return false;
    }
  }

  private createRunProcessDirectDeps(): RunProcessDirectDeps {
    const cfg = this.config.config;
    if (!cfg) {
      throw new Error('AgentService requires config.config');
    }
    return {
      log,
      config: cfg,
      parseSessionKey: (sk) => this.parseSessionKey(sk),
      initSessionContext: (sk, channel, chatId) => {
        void this.initSessionContext(sk, channel, chatId);
      },
      hydrateSessionWorkspaceFromStore: (sk) => this.hydrateSessionWorkspaceFromStore(sk),
      hydrateSessionModelFromStore: (sk) => this.hydrateSessionModelFromStore(sk),
      agentManager: this.agentManager,
      sessionStore: this.sessionStore,
      prepareLoadedSessionMessages: (sk, msgs) => this.prepareLoadedSessionMessages(sk, msgs),
      modelManager: this.modelManager,
      applyResolvedThinkingLevel: (sk, t) => this.applyResolvedThinkingLevel(sk, t),
      prepareInboundAttachments: (sk, att) => this.prepareInboundAttachments(sk, att),
      commandHandler: this.commandHandler,
      persistAgentSessionMessages: (sk) => this.persistAgentSessionMessages(sk),
      endDirectRequestContext: () => this.endDirectRequestContext(),
    };
  }

  async processDirect(
    content: string,
    sessionKey = 'cli:direct',
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
      workspaceRelativePath?: string;
    }>,
    thinking?: string,
  ): Promise<string> {
    return runProcessDirect(this.createRunProcessDirectDeps(), {
      content,
      sessionKey,
      attachments,
      thinking,
    });
  }

  private async handleInboundMessage(msg: InboundMessage): Promise<void> {
    const requestId = inboundMessageLogRequestId(msg);

    await runWithLogContext({ requestId }, async () => {
      const routing = await this.messageRouter.routeMessage(msg);
      const { context, isCommand, command, commandArgs } = routing;

      const sessionContext: SessionContext = {
        sessionKey: context.sessionKey,
        channel: context.channel,
        chatId: context.chatId,
        senderId: context.senderId || '',
        isGroup: context.isGroup || false,
        metadata: {
          transcribedVoice: msg.metadata?.transcribedVoice === true,
        },
      };

      updateAsyncLogContext({ sessionId: sessionContext.sessionKey });

      this.sessionContextManager.setContext(sessionContext);
      this.feedbackCoordinator.setContext(sessionContext);

      // `subscribeToSession` requires an Agent instance; without this the first inbound never
      // registers `message_update` streaming (second turn behaved differently).
      this.agentManager.getOrCreateAgent(sessionContext.sessionKey);

      // Setup event handling for this session
      this.setupSessionEventHandling(sessionContext.sessionKey);

      await this.sessionLifecycleManager.startSession(sessionContext);

      /** Declared on the function so `finally` can clear typing after outbound (TTS + send). */
      let typingController: TypingController | null = null;
      let inboundTurnArmed = false;
      let busProcessFailed: string | undefined;

      try {
        if (msg.channel === 'system') {
          await this.handleSystemMessage(msg, sessionContext);
          return;
        }

        if (this.channelManagerRef && msg.channel !== 'cli') {
          await this.channelManagerRef.dispatchInboundMessageAction(msg);
        }

        if (isCommand && command) {
          const handled = await this.commandHandler.executeCommand(command, commandArgs || '', {
            sessionKey: sessionContext.sessionKey,
            channel: sessionContext.channel,
            chatId: sessionContext.chatId,
            senderId: sessionContext.senderId,
            isGroup: sessionContext.isGroup,
            inboundMetadata: msg.metadata,
          });

          if (handled) {
            return;
          }
        }

        // Start continuous typing indicator (renews every 5 seconds)
        if (msg.channel !== 'cli') {
          typingController = createTypingController({
            intervalSeconds: 5,
            onStart: async () => {
              await this.bus.publishOutbound({
                channel: msg.channel,
                chat_id: msg.chat_id,
                content: '',
                type: 'typing_on',
                metadata: {
                  accountId: msg.metadata?.accountId,
                  threadId: msg.metadata?.threadId,
                  sessionWebhook: msg.metadata?.sessionWebhook,
                  conversationId: msg.metadata?.conversationId,
                },
              });
            },
            onStop: async () => {
              await this.bus.publishOutbound({
                channel: msg.channel,
                chat_id: msg.chat_id,
                content: '',
                type: 'typing_off',
                metadata: {
                  accountId: msg.metadata?.accountId,
                  threadId: msg.metadata?.threadId,
                  sessionWebhook: msg.metadata?.sessionWebhook,
                  conversationId: msg.metadata?.conversationId,
                },
              });
            },
          });
          typingController.start();
        }

        if (this.channelManagerRef && msg.channel !== 'cli') {
          const meta = msg.metadata as Record<string, unknown> | undefined;
          const streamHandle = this.channelManagerRef.startStream(
            msg.channel,
            msg.chat_id,
            meta?.accountId as string | undefined,
            {
              threadId: meta?.threadId as string | undefined,
              replyToMessageId: meta?.messageId as string | undefined,
            },
          );

          if (streamHandle) {
            this.setStreamHandle(streamHandle as StreamHandle);
          }
        }

        this.beginInboundTurn(sessionContext.sessionKey);
        inboundTurnArmed = true;
        try {
          await this.agentOrchestrator.process(msg, sessionContext);
        } catch (procErr) {
          busProcessFailed = procErr instanceof Error ? procErr.message : String(procErr);
          throw procErr;
        }
      } finally {
        await this.sessionLifecycleManager.endSession(sessionContext);
        await this.streamManager.end();
        try {
          await this.sendFinalResponse(msg, sessionContext);
        } finally {
          // After outbound (incl. TTS); previously we cleared typing right after LLM finished, so Weixin showed typing_off before the message.
          await typingController?.stop();
        }
        if (inboundTurnArmed) {
          const meta = msg.metadata as Record<string, unknown> | undefined;
          const assistantPlainText = this.getLastAssistantPlainText(sessionContext.sessionKey) ?? '';
          try {
            await this.emitSessionTurnComplete({
              sessionKey: sessionContext.sessionKey,
              channel: sessionContext.channel,
              chatId: sessionContext.chatId,
              inboundUserText: msg.content,
              assistantPlainText,
              aborted: false,
              ...(busProcessFailed !== undefined ? { streamError: busProcessFailed } : {}),
              skipPersistentGoalPostTurn: false,
              outboundMetadata: {
                accountId: meta?.accountId,
                threadId: meta?.threadId,
              },
            });
          } catch (turnErr) {
            const em = turnErr instanceof Error ? turnErr.message : String(turnErr);
            log.warn(
              { err: turnErr, sessionKey: sessionContext.sessionKey },
              `Session turn complete failed: ${em}`,
            );
          }
          this.endInboundTurn(sessionContext.sessionKey);
        }
        this.feedbackCoordinator.endTask();
        this.sessionContextManager.clearContext();
        this.feedbackCoordinator.clearContext();
      }
    });
  }

  private async handleSystemMessage(msg: InboundMessage, context: SessionContext): Promise<void> {
    log.debug({ sessionKey: context.sessionKey }, 'Processing system message');

    await this.hydrateSessionWorkspaceFromStore(context.sessionKey);

    // Get or create agent for this session
    const agent = this.agentManager.getOrCreateAgent(context.sessionKey);

    const messages = await this.sessionStore.load(context.sessionKey);
    await this.checkAndCompact(context.sessionKey, messages);
    const refreshedMessages = await this.sessionStore.load(context.sessionKey);
    agent.state.messages = this.prepareLoadedSessionMessages(context.sessionKey, refreshedMessages);

    const systemMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: `[System: ${msg.sender_id}] ${msg.content}` }],
      timestamp: Date.now(),
    };

    try {
      await agent.prompt(systemMessage);
      await agent.waitForIdle();

      const finalContent = this.agentManager.getLastAssistantContent(context.sessionKey);
      if (finalContent) {
        const hookResult = await this.hookHandler.runMessageSending(
          context.chatId,
          finalContent,
          context.channel,
        );
        if (hookResult.send) {
          await this.bus.publishOutbound({
            channel: context.channel,
            chat_id: context.chatId,
            content: hookResult.content || finalContent,
            type: 'message',
          });
        }
      }

      await this.persistAgentSessionMessages(context.sessionKey);
    } catch (error) {
      const em = error instanceof Error ? error.message : String(error);
      log.error(
        {
          err: error,
          errorMessage: em,
          sessionKey: context.sessionKey,
          channel: context.channel,
          chatId: context.chatId,
          senderId: msg.sender_id,
        },
        `System message handling failed: ${em}`,
      );
      await this.bus.publishOutbound({
        channel: context.channel,
        chat_id: context.chatId,
        content: '❌ An error occurred while processing the system message.',
        type: 'message',
      });
    }
  }

  /**
   * Setup event handling for a specific session
   */
  private setupSessionEventHandling(sessionKey: string): void {
    // If already subscribed, skip
    if (this.sessionUnsubscribers.has(sessionKey)) {
      return;
    }

    const unsubscribe = this.agentManager.subscribeToSession(sessionKey, (event) => {
      this.handleSessionEvent(sessionKey, event);
    });

    if (unsubscribe) {
      this.sessionUnsubscribers.set(sessionKey, unsubscribe);
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

  private async sendFinalResponse(
    msg: InboundMessage,
    sessionContext: SessionContext
  ): Promise<void> {
    if (this.streamManager.consumeSkipFinalOutbound()) {
      return;
    }

    const finalContent = this.agentManager.getLastAssistantContent(sessionContext.sessionKey);
    if (!finalContent?.trim()) return;

    const ackMax =
      this.config.config?.gateway?.heartbeat?.ackMaxChars ?? DEFAULT_ACK_MAX_CHARS;
    if (shouldSilence(finalContent, ackMax) || finalContent.trim() === NO_REPLY) {
      log.debug(
        { sessionKey: sessionContext.sessionKey },
        'Silent reply — skipping outbound',
      );
      return;
    }

    const hookResult = await this.hookHandler.runMessageSending(
      sessionContext.chatId,
      finalContent,
      sessionContext.channel,
    );
    if (!hookResult.send) return;

    // TTS is handled by ChannelManager, just send text message here
    await this.bus.publishOutbound({
      channel: sessionContext.channel,
      chat_id: sessionContext.chatId,
      content: hookResult.content || finalContent,
      type: 'message',
      metadata: {
        accountId: msg.metadata?.accountId,
        threadId: msg.metadata?.threadId,
        transcribedVoice: sessionContext.metadata?.transcribedVoice,
        sessionWebhook: msg.metadata?.sessionWebhook,
        conversationId: msg.metadata?.conversationId,
      },
    });
  }

  /** Extension hooks for ChannelManager outbound pipeline (Gateway). */
  async invokeOutboundMessageSending(
    to: string,
    content: string,
    channel: string,
  ): Promise<{ send: boolean; content?: string; reason?: string }> {
    return this.hookHandler.runMessageSending(to, content, channel);
  }

  async invokeOutboundMessageSent(
    to: string,
    content: string,
    success: boolean,
    error: string | undefined,
    channel: string,
  ): Promise<void> {
    return this.hookHandler.runMessageSent(to, content, success, error, channel);
  }

  private dispose(): void {
    this.sessionTracker.dispose();

    // Unsubscribe from all session agents
    for (const unsubscribe of this.sessionUnsubscribers.values()) {
      unsubscribe();
    }
    this.sessionUnsubscribers.clear();

    // Dispose all agent instances
    this.agentManager.dispose();
  }
}

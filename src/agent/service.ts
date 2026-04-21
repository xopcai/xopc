import type { AgentEvent, AgentMessage, ThinkingLevel } from '@mariozechner/pi-agent-core';
import { MessageBusShutdownError, type MessageBus, type InboundMessage } from '../infra/bus/index.js';
import { type Config, getAgentDefaultModelRef } from '../config/schema.js';
import { maybeAutoTitleSessionStore } from '../session/session-title.js';
import type { ChannelManager } from '../channels/manager.js';
import { INTERNAL_OUTBOUND_DROP_CHANNEL } from '../channels/internal-outbound.js';
import { join } from 'path';

import { mkdir } from 'node:fs/promises';

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
import {
  normalizeThinkLevel,
  normalizeReasoningLevel,
  type ThinkLevel,
  type ReasoningLevel,
} from './transcript/thinking-types.js';
import { createLogger, runWithLogContext, updateAsyncLogContext } from '../utils/logger.js';
import { ExtensionRegistryImpl as ExtensionRegistry, ExtensionHookRunner } from '../extensions/index.js';
import { loadBootstrapFiles, extractTextContent } from './context/workspace.js';
import { SessionTracker } from './session/tracker.js';
import { ModelManager } from './models/index.js';
import { commandRegistry, initializeCommands } from '../chat-commands/index.js';
import { parseSlashCommand } from '../chat-commands/command-parse.js';
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
import { runAgentTurnWithModelFallbacks } from './orchestration/run-agent-turn-with-fallbacks.js';
import { FeedbackCoordinator } from './feedback/index.js';
import { AgentManager, type SkillCatalogEntry } from './agent-manager.js';
import { extractAgentUserPlainText } from './memory/user-message-text.js';
import { inboundMessageLogRequestId } from './service-inbound-utils.js';
import type { AgentServiceConfig, AgentContext, StreamHandle } from './service.types.js';
import {
  runProcessDirectStreaming,
  type ProcessDirectStreamingDeps,
} from './service/process-direct-streaming.js';

import {
  resolveAgentHomeDir,
  resolveDefaultAgentId,
} from './agent-scope.js';
import { parseSessionKey as parseRoutingSessionKey } from '../routing/session-key.js';
import { extractProfileAgentId, resolveAgentBootstrapDir } from '../config/agent-profile.js';
import { DEFAULT_ACK_MAX_CHARS, NO_REPLY, shouldSilence } from '../heartbeat/tokens.js';
import { createTypingController, type TypingController } from './lifecycle/typing.js';
import { cleanTrailingErrors, sanitizeMessages } from './memory/message-sanitizer.js';
import {
  tryApplySessionTranscriptHygiene,
  tryApplySessionTranscriptHygieneForPersistence,
} from './transcript/transcript-hygiene.js';
import {
  persistInboundAttachmentsToWorkspace,
  formatInboundFileTextBlock,
  type InternalAttachmentRoots,
} from '../channels/attachments/inbound-persist.js';
import { resolveInboundImageContentParts } from './image/inbound-image-handling.js';
import { getDefaultModelSync } from '../providers/index.js';
import { persistOutboundTtsAudio } from '../channels/attachments/outbound-tts-persist.js';
import { compressAudio } from '../voice/tts/audio.js';
import { speak } from '../voice/tts/index.js';
import { mergeTtsConfigFromAppConfig } from '../voice/tts/merge-config.js';
import { resolveAgentDir } from '../config/paths.js';
import { shouldUseTTS, getChannelOutputFormat } from '../voice/tts/service.js';
import { isTTSAvailable } from '../voice/tts/factory.js';

export type { AgentServiceConfig, AgentContext, StreamHandle } from './service.types.js';

const log = createLogger('AgentService');

export class AgentService {
  private sessionStore: SessionStore;
  private sessionConfigStore: SessionConfigStore;
  private hookRunner?: ExtensionHookRunner;
  private running = false;
  private agentId: string;
  private workspaceDir: string;
  private bootstrapFiles: ReturnType<typeof loadBootstrapFiles> = [];
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

  // Track event unsubscribers per session
  private sessionUnsubscribers: Map<string, () => void> = new Map();

  constructor(bus: MessageBus, config: AgentServiceConfig) {
    this.bus = bus;
    this.config = config;
    this.agentId = `agent-${Date.now()}`;
    this.workspaceDir = config.workspace;

    if (config.config) {
      const aid = resolveDefaultAgentId(config.config);
      this.bootstrapFiles = loadBootstrapFiles(resolveAgentBootstrapDir(config.config, aid));
    } else {
      this.bootstrapFiles = [];
    }

    this.sessionTracker = new SessionTracker();
    this.modelManager = new ModelManager({
      defaultModel: config.model,
      config: config.config,
    });

    initializeCommands();
    log.debug('Command system initialized');

    this.sessionStore = this.createSessionStore();
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
      getConfig: () => this.config.config,
      getThinkingDefault: () => this.config.config?.agents?.defaults?.thinkingDefault,
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

  getSkillCatalog(): SkillCatalogEntry[] {
    return this.agentManager.getSkillCatalog();
  }

  getSkillMarkdownSource(skillName: string): { name: string; markdown: string } | null {
    return this.agentManager.getSkillMarkdownSource(skillName);
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

  async start(): Promise<void> {
    this.running = true;
    await this.sessionConfigStore.initialize();
    await this.hookHandler.trigger('gateway_start', { port: 0, host: 'cli' });
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
    const parts = sessionKey.split(':').filter(Boolean);
    const first = parts[0] || 'cli';

    // Heartbeat sessions use keys like `heartbeat:main` / `heartbeat:isolated:ts` — not a real channel id.
    // Route tool outbounds to configured delivery target, or a synthetic channel that ChannelManager drops.
    if (first === 'heartbeat') {
      const hb = this.config.config?.gateway?.heartbeat;
      const target = hb?.target?.trim();
      const targetChatId = hb?.targetChatId?.trim();
      if (target && targetChatId) {
        return { channel: target, chatId: targetChatId };
      }
      return { channel: INTERNAL_OUTBOUND_DROP_CHANNEL, chatId: parts.slice(1).join(':') || 'heartbeat' };
    }

    const parsed = parseRoutingSessionKey(sessionKey);
    if (parsed) {
      return { channel: parsed.source, chatId: parsed.peerId };
    }

    if (first === 'cron') {
      return { channel: INTERNAL_OUTBOUND_DROP_CHANNEL, chatId: parts.slice(1).join(':') || 'cron' };
    }

    return {
      channel: first,
      chatId: parts.slice(1).join(':') || 'direct',
    };
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
    this.setupSessionEventHandling(sessionKey);

    return context;
  }

  private async buildMessageContent(
    content: string,
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
      workspaceRelativePath?: string;
    }>,
    sessionKey?: string,
  ): Promise<Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>> {
    const messageContent: Array<
      { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    > = [];

    if (content.trim()) {
      messageContent.push({ type: 'text', text: content });
    }

    if (!attachments?.length) {
      return messageContent;
    }

    const sk = sessionKey ?? '';
    const modelRef =
      sk !== ''
        ? this.modelManager.getModelForSession(sk)
        : getAgentDefaultModelRef(this.config.config!) ?? getDefaultModelSync(this.config.config);
    const cfg = this.config.config;

    const storageRoot =
      sk !== ''
        ? resolveAgentHomeDir(this.config.config!, extractProfileAgentId(sk, this.config.config!))
        : resolveAgentHomeDir(this.config.config!, resolveDefaultAgentId(this.config.config!));

    let i = 0;
    while (i < attachments.length) {
      const att = attachments[i]!;
      const isImage =
        att.type === 'image' ||
        att.type === 'photo' ||
        Boolean(att.mimeType?.startsWith('image/'));

      if (isImage) {
        const group: Array<{ data: string; mimeType: string }> = [];
        while (i < attachments.length) {
          const a = attachments[i]!;
          const img =
            a.type === 'image' || a.type === 'photo' || Boolean(a.mimeType?.startsWith('image/'));
          if (!img) {
            break;
          }
          if (!a.data || a.data.length === 0) {
            i += 1;
            continue;
          }
          group.push({ data: a.data, mimeType: a.mimeType || 'image/png' });
          i += 1;
        }
        if (group.length > 0) {
          const parts = await resolveInboundImageContentParts({
            modelRef: modelRef || getDefaultModelSync(cfg),
            cfg,
            userTextForContext: content.trim() ? content : '',
            images: group,
          });
          messageContent.push(...parts);
        }
      } else {
        const fileBlock = formatInboundFileTextBlock(att, storageRoot);
        messageContent.push({ type: 'text', text: fileBlock });
        i += 1;
      }
    }

    return messageContent;
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

  async compactSession(sessionKey: string, instructions?: string): Promise<void> {
    const messages = await this.sessionStore.load(sessionKey);
    const contextWindow = this.getContextWindow();
    const result = await this.sessionStore.compact(sessionKey, messages, contextWindow, instructions);
    if (result.compacted) {
      await this.sessionStore.save(sessionKey, await this.sessionStore.load(sessionKey));
    }
    log.info({ sessionKey, result }, 'Manual compaction complete');
  }

  getSessionStats(sessionKey: string, messages: AgentMessage[]) {
    return {
      windowStats: this.sessionStore.getWindowStats(messages),
      compactionStats: this.sessionStore.getCompactionStats(sessionKey),
      tokenEstimate: this.sessionStore.estimateTokenUsage(sessionKey, messages),
    };
  }

  private async applyResolvedThinkingLevel(sessionKey: string, requestOverride?: string | null): Promise<void> {
    const def = this.config.config?.agents?.defaults?.thinkingDefault;
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
    const cfg = this.config.config!;
    const sc = await this.sessionConfigStore.get(sessionKey);
    const defThink = cfg.agents?.defaults?.thinkingDefault ?? 'medium';
    const level = await resolveEffectiveThinkingLevel(this.sessionConfigStore, sessionKey, null, defThink);
    const defReason = (cfg.agents?.defaults?.reasoningDefault ?? 'off') as ReasoningLevel;
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
      getConfig: () => this.config.config,
      sessionConfigStore: this.sessionConfigStore,
      attachmentRootsForSession: (sk) => this.attachmentRootsForSession(sk),
      agentOrchestrator: this.agentOrchestrator,
      commandHandler: this.commandHandler,
      prepareInboundAttachments: (sk, att) => this.prepareInboundAttachments(sk, att),
      buildMessageContent: (text, prepared, sk) => this.buildMessageContent(text, prepared, sk),
      persistAgentSessionMessages: (sk) => this.persistAgentSessionMessages(sk),
      maybeEmitWebchatTts: (sk, hadVoice) => this.maybeEmitWebchatTts(sk, hadVoice),
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
   * See `Agent.steer` in `@mariozechner/pi-agent-core`.
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

  /**
   * Generate TTS for webchat when config allows, persist under agent home `tts/`, attach to last assistant turn.
   */
  private async maybeEmitWebchatTts(
    sessionKey: string,
    hadInboundVoice: boolean,
  ): Promise<{ type: 'tts_audio'; workspaceRelativePath: string; mimeType: string; name: string } | null> {
    const ttsConfig = mergeTtsConfigFromAppConfig(this.config.config?.tts);
    if (!isTTSAvailable(ttsConfig)) {
      return null;
    }
    const decision = shouldUseTTS(ttsConfig, hadInboundVoice);
    if (!decision.useTTS) {
      return null;
    }
    const text = this.agentManager.getLastAssistantContent(sessionKey)?.trim();
    if (!text) {
      return null;
    }
    try {
      const webOut = getChannelOutputFormat('webchat');
      const fmt = webOut.format as 'opus' | 'mp3' | 'wav';
      const ttsResult = await speak(text, ttsConfig, {
        appConfig: this.config.config,
        tts: { format: fmt },
      });
      const { buffer, format } = await compressAudio(
        Buffer.from(ttsResult.audio),
        ttsResult.format,
        webOut.format === 'mp3' ? 'mp3' : 'opus',
      );
      const normalizedMime =
        format === 'opus' || format === 'ogg'
          ? 'audio/ogg'
          : format === 'mp3' || format === 'mpeg'
            ? 'audio/mpeg'
            : format === 'wav'
              ? 'audio/wav'
              : `audio/${format}`;
      const persisted = await persistOutboundTtsAudio(
        resolveAgentHomeDir(this.config.config!, extractProfileAgentId(sessionKey, this.config.config!)),
        sessionKey,
        buffer,
        format,
      );
      await this.appendAttachmentToLastAssistant(sessionKey, {
        type: 'audio',
        mimeType: normalizedMime,
        name: persisted.name,
        size: persisted.size,
        workspaceRelativePath: persisted.workspaceRelativePath,
      });
      return {
        type: 'tts_audio',
        workspaceRelativePath: persisted.workspaceRelativePath,
        mimeType: normalizedMime,
        name: persisted.name,
      };
    } catch (err) {
      log.warn({ err, sessionKey }, 'Webchat TTS failed');
      return null;
    }
  }

  private async appendAttachmentToLastAssistant(
    sessionKey: string,
    att: {
      type: string;
      mimeType: string;
      name: string;
      size: number;
      workspaceRelativePath: string;
    },
  ): Promise<void> {
    const loaded = await this.sessionStore.load(sessionKey);
    for (let i = loaded.length - 1; i >= 0; i--) {
      const m = loaded[i] as { role?: string; attachments?: unknown[] };
      if (m.role === 'assistant') {
        const prev = (m.attachments ?? []) as Array<{ workspaceRelativePath?: string }>;
        if (prev.some((x) => x.workspaceRelativePath === att.workspaceRelativePath)) {
          return;
        }
        const next = [...prev, att];
        loaded[i] = { ...m, attachments: next } as unknown as AgentMessage;
        await this.sessionStore.save(sessionKey, loaded);
        return;
      }
    }
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
    const { channel, chatId } = this.parseSessionKey(sessionKey);
    this.initSessionContext(sessionKey, channel, chatId);

    try {
      await this.hydrateSessionWorkspaceFromStore(sessionKey);
      // Get or create agent for this session
      const agent = this.agentManager.getOrCreateAgent(sessionKey);

      await this.hydrateSessionModelFromStore(sessionKey);

      const loaded = await this.sessionStore.load(sessionKey);
      agent.state.messages = this.prepareLoadedSessionMessages(sessionKey, loaded);

      await this.modelManager.applyModelForSession(agent, sessionKey);
      await this.applyResolvedThinkingLevel(sessionKey, thinking);

      const prepared = await this.prepareInboundAttachments(sessionKey, attachments);

      const cmd = parseSlashCommand(content);
      if (cmd && commandRegistry.has(cmd.command)) {
        const { aggregatedText } = await this.commandHandler.executeCommandAndAggregateReply(cmd.command, cmd.args, {
          sessionKey,
          channel,
          chatId,
          senderId: '',
          isGroup: false,
        });
        await this.persistAgentSessionMessages(sessionKey);
        return aggregatedText;
      }

      const textForDirect = content.trimStart().startsWith('/skill:')
        ? this.agentManager.expandSkillUserText(content)
        : content;
      const messageContent = await this.buildMessageContent(textForDirect, prepared, sessionKey);

      const userMessage = {
        role: 'user' as const,
        content: messageContent,
        timestamp: Date.now(),
      };
      const userPlain = extractAgentUserPlainText(userMessage);
      const userMessageForModel = await this.agentManager.applyMemoryPrefetchToUserMessage(
        userMessage,
        sessionKey,
      );

      await runAgentTurnWithModelFallbacks({
        agent,
        sessionKey,
        modelManager: this.modelManager,
        userMessage: userMessageForModel,
        log,
        getConfig: () => this.config.config,
        beforeUserPrompt: () => this.agentManager.beginBackgroundReviewUserTurn(sessionKey),
      });

      this.agentManager.afterAgentTurn(sessionKey, userPlain);
      this.agentManager.scheduleBackgroundReviewAfterUserTurn(sessionKey);

      const response = this.agentManager.getLastAssistantContent(sessionKey) || '';
      await this.persistAgentSessionMessages(sessionKey);

      return response;
    } finally {
      this.endDirectRequestContext();
      // Don't unsubscribe here - keep the session agent alive for future messages
    }
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

      // Setup event handling for this session
      this.setupSessionEventHandling(sessionContext.sessionKey);

      await this.sessionLifecycleManager.startSession(sessionContext);

      /** Declared on the function so `finally` can clear typing after outbound (TTS + send). */
      let typingController: TypingController | null = null;

      try {
        if (msg.channel === 'system') {
          await this.handleSystemMessage(msg, sessionContext);
          return;
        }

        if (isCommand && command) {
          const handled = await this.commandHandler.executeCommand(command, commandArgs || '', {
            sessionKey: sessionContext.sessionKey,
            channel: sessionContext.channel,
            chatId: sessionContext.chatId,
            senderId: sessionContext.senderId,
            isGroup: sessionContext.isGroup,
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

        await this.agentOrchestrator.process(msg, sessionContext);
      } finally {
        await this.sessionLifecycleManager.endSession(sessionContext);
        await this.streamManager.end();
        try {
          await this.sendFinalResponse(msg, sessionContext);
        } finally {
          // After outbound (incl. TTS); previously we cleared typing right after LLM finished, so Weixin showed typing_off before the message.
          await typingController?.stop();
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

    const result = await this.sessionStore.compact(sessionKey, messages, contextWindow);
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

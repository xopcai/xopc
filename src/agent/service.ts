import type { AgentEvent, AgentMessage, ThinkingLevel } from '@mariozechner/pi-agent-core';
import { MessageBusShutdownError, type MessageBus, type InboundMessage } from '../infra/bus/index.js';
import { type Config, type AgentDefaults, getAgentDefaultModelRef } from '../config/schema.js';
import { maybeAutoTitleSessionStore } from '../session/session-title.js';
import type { ChannelManager } from '../channels/manager.js';
import { INTERNAL_OUTBOUND_DROP_CHANNEL } from '../channels/internal-outbound.js';
import { mkdirSync } from 'fs';
import { join } from 'path';

import {
  SessionStore,
  SessionConfigStore,
  resolveEffectiveThinkingLevel,
  type CompactionConfig,
  type WindowConfig,
} from '../session/index.js';
import { normalizeThinkLevel, type ThinkLevel } from './transcript/thinking-types.js';
import { createLogger } from '../utils/logger.js';
import { ExtensionRegistryImpl as ExtensionRegistry, ExtensionHookRunner } from '../extensions/index.js';
import {
  loadBootstrapFiles,
  extractTextContent,
  extractThinkingContent,
  extractThinkingFromAssistantMessage,
} from './context/workspace.js';
import { SessionTracker } from './session/tracker.js';
import { ModelManager } from './models/index.js';
import { initializeCommands } from '../chat-commands/index.js';
import { ProgressFeedbackManager, type ProgressStage } from './lifecycle/progress.js';
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
} from '../channels/attachments/inbound-persist.js';
import {
  mergeVoiceTranscriptsIntoUserText,
  mergeSttConfigFromAppConfig,
} from '../channels/attachments/voice-stt-webchat.js';
import { persistOutboundTtsAudio } from '../channels/attachments/outbound-tts-persist.js';
import { compressAudio } from '../tts/audio.js';
import { speak } from '../tts/index.js';
import { mergeTtsConfigFromAppConfig } from '../tts/merge-config.js';
import { shouldUseTTS, getChannelOutputFormat } from '../tts/service.js';
import { isTTSAvailable } from '../tts/factory.js';

const log = createLogger('AgentService');

/** Cap tool result size in SSE `tool_end` events (pi-agent passes structured objects, not only strings). */
const SSE_TOOL_RESULT_MAX_CHARS = 100_000;

function serializeAgentToolResultForSse(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result === 'string') {
    return result.length > SSE_TOOL_RESULT_MAX_CHARS
      ? `${result.slice(0, SSE_TOOL_RESULT_MAX_CHARS)}\n…(truncated)`
      : result;
  }
  try {
    const s = JSON.stringify(result, null, 2);
    return s.length > SSE_TOOL_RESULT_MAX_CHARS
      ? `${s.slice(0, SSE_TOOL_RESULT_MAX_CHARS)}\n…(truncated)`
      : s;
  } catch {
    try {
      return String(result);
    } catch {
      return undefined;
    }
  }
}

export interface AgentServiceConfig {
  workspace: string;
  model?: string;
  config?: Config;
  agentDefaults?: AgentDefaults;
  extensionRegistry?: ExtensionRegistry;
  maxRequestsPerTurn?: number;
  maxToolFailuresPerTurn?: number;
  maxTaskDurationMs?: number;
  // Thinking configuration
  thinkingLevel?: ThinkingLevel;
  reasoningLevel?: 'off' | 'on' | 'stream';
  verboseLevel?: 'off' | 'on' | 'full';
}

export interface AgentContext {
  channel: string;
  chatId: string;
  sessionKey: string;
  senderId?: string;
  isGroup?: boolean;
}

export interface StreamHandle {
  update: (text: string) => void;
  updateProgress?: (text: string, stage: ProgressStage, detail?: string) => void;
  setProgress?: (stage: ProgressStage, detail?: string) => void;
  end: () => Promise<void>;
  abort: () => Promise<void>;
  messageId: () => number | undefined;
}

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

  // Track event unsubscribers per session
  private sessionUnsubscribers: Map<string, () => void> = new Map();

  constructor(bus: MessageBus, config: AgentServiceConfig) {
    this.bus = bus;
    this.config = config;
    this.agentId = `agent-${Date.now()}`;
    this.workspaceDir = config.workspace;

    this.bootstrapFiles = loadBootstrapFiles(config.workspace);

    this.sessionTracker = new SessionTracker();
    this.modelManager = new ModelManager({
      defaultModel: config.model,
      config: config.config,
    });

    initializeCommands();
    log.debug('Command system initialized');

    this.sessionStore = this.createSessionStore();
    this.sessionConfigStore = new SessionConfigStore(this.workspaceDir);
    mkdirSync(join(this.workspaceDir, '.sessions', 'config'), { recursive: true });

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
      thinkingLevel: config.thinkingLevel,
      reasoningLevel: config.reasoningLevel,
      verboseLevel: config.verboseLevel,
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
      getThinkingDefault: () => this.config.config?.agents?.defaults?.thinkingDefault,
      workspaceRoot: this.workspaceDir,
    });

    this.messageRouter = new MessageRouter({ workspace: config.workspace });
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

    process.on('SIGINT', () => this.dispose());
    process.on('SIGTERM', () => this.dispose());

    log.info('AgentService initialized');
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
    return new SessionStore({ workspace: this.config.workspace }, windowConfig, compactionConfig);
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
        log.error({ err: error }, 'Error in agent loop');
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
   * Fire-and-forget: `maybeAutoTitleSessionStore` no-ops for non-webchat keys.
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

    // Cron `processDirect` uses `cron:<jobId>` — not a channel plugin id.
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

  private buildMessageContent(
    content: string,
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
      workspaceRelativePath?: string;
    }>,
  ): Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> {
    const messageContent: Array<
      { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    > = [];

    if (content.trim()) {
      messageContent.push({ type: 'text', text: content });
    }

    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (att.type === 'image' || att.mimeType?.startsWith('image/')) {
          messageContent.push({
            type: 'image',
            data: att.data || '',
            mimeType: att.mimeType || 'image/png',
          });
        } else {
          const fileBlock = formatInboundFileTextBlock(att, this.workspaceDir);
          messageContent.push({ type: 'text', text: fileBlock });
        }
      }
    }

    return messageContent;
  }

  /**
   * Persist inbound file attachments under the session workspace (non-images with data).
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
    return persistInboundAttachmentsToWorkspace(this.workspaceDir, sessionKey, attachments);
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
  async getSessionAgentConfig(sessionKey: string): Promise<{ thinkingLevel: ThinkingLevel; model: string }> {
    await this.hydrateSessionModelFromStore(sessionKey);
    const def = this.config.config?.agents?.defaults?.thinkingDefault ?? 'medium';
    const level = await resolveEffectiveThinkingLevel(this.sessionConfigStore, sessionKey, null, def);
    const model = this.modelManager.getModelForSession(sessionKey);
    return { thinkingLevel: level, model };
  }

  async patchSessionAgentConfig(
    sessionKey: string,
    partial: { thinkingLevel?: string; model?: string | null },
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
    const { channel, chatId } = this.parseSessionKey(sessionKey);
    const context = this.initSessionContext(sessionKey, channel, chatId);

    const eventQueue: Array<{ type: string; [key: string]: unknown }> = [];
    let resolveWaiting: (() => void) | null = null;
    let agentDone = false;

    // Track last sent content for delta calculation (incremental push optimization)
    let lastSentContent = '';
    let lastSentThinking = '';

    const pushEvent = (event: { type: string; [key: string]: unknown }) => {
      eventQueue.push(event);
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    };

    const signal = options?.signal;
    let userAborted = false;
    let abortHandled = false;

    const agent = this.agentManager.getOrCreateAgent(sessionKey);
    await this.hydrateSessionModelFromStore(sessionKey);
    const unsubscribeStreaming = agent.subscribe((event: AgentEvent) => {
      this.agentEventHandler.handle(event, context);

      switch (event.type) {
        case 'tool_execution_start': {
          const toolEvent = event as Extract<AgentEvent, { type: 'tool_execution_start' }>;
          const toolName =
            typeof toolEvent.toolName === 'string' && toolEvent.toolName.trim()
              ? toolEvent.toolName.trim()
              : 'unknown';
          pushEvent({
            type: 'tool_start',
            toolName,
            args: toolEvent.args,
          });
          break;
        }
        case 'tool_execution_end': {
          const toolEvent = event as Extract<AgentEvent, { type: 'tool_execution_end' }>;
          const toolName =
            typeof toolEvent.toolName === 'string' && toolEvent.toolName.trim()
              ? toolEvent.toolName.trim()
              : 'unknown';
          pushEvent({
            type: 'tool_end',
            toolName,
            isError: toolEvent.isError,
            result: serializeAgentToolResultForSse(toolEvent.result),
          });
          break;
        }
        case 'message_update': {
          const msgEvent = event as Extract<AgentEvent, { type: 'message_update' }>;
          if (msgEvent.message?.role === 'assistant') {
            const msgContent = msgEvent.message.content;
            const blocks = Array.isArray(msgContent)
              ? (msgContent as Array<{ type: string; text?: string }>)
              : undefined;
            const fullText = blocks
              ? extractTextContent(blocks)
              : String(msgContent);
            const thinkingFromBlocks = blocks ? extractThinkingContent(blocks) : '';
            const thinkingFromReasoning = extractThinkingFromAssistantMessage(msgEvent.message);
            const thinkingText =
              thinkingFromReasoning.length >= thinkingFromBlocks.length
                ? thinkingFromReasoning
                : thinkingFromBlocks;

            // Main answer text (type: text)
            if (fullText.length > lastSentContent.length) {
              const delta = fullText.slice(lastSentContent.length);
              if (delta) {
                pushEvent({ type: 'token', content: delta });
                lastSentContent = fullText;
              }
            } else if (fullText.length < lastSentContent.length) {
              pushEvent({ type: 'token', content: fullText });
              lastSentContent = fullText;
            }

            // Reasoning / thinking blocks (some models stream here instead of main text)
            if (thinkingText.length > lastSentThinking.length) {
              const thDelta = thinkingText.slice(lastSentThinking.length);
              if (thDelta) {
                pushEvent({ type: 'thinking', content: thDelta, delta: true });
                lastSentThinking = thinkingText;
              }
            } else if (thinkingText.length < lastSentThinking.length) {
              pushEvent({ type: 'thinking', content: thinkingText, delta: false });
              lastSentThinking = thinkingText;
            }
          }
          break;
        }
        case 'message_start': {
          const msgEvent = event as Extract<AgentEvent, { type: 'message_start' }>;
          if (msgEvent.message?.role === 'assistant') {
            // Reset incremental tracking
            lastSentContent = '';
            lastSentThinking = '';
            pushEvent({ type: 'thinking', status: 'started' });
          }
          break;
        }
        case 'message_end': {
          pushEvent({ type: 'message_end' });
          break;
        }
        case 'agent_start': {
          pushEvent({ type: 'progress', stage: 'thinking', message: '🤔 Thinking...' });
          break;
        }
        case 'agent_end': {
          pushEvent({ type: 'progress', stage: 'idle', message: 'Done' });
          break;
        }
        default:
          break;
      }
    });

    try {
      const prepared = await this.prepareInboundAttachments(sessionKey, attachments);
      let loaded = await this.sessionStore.load(sessionKey);
      const lastMsg = loaded[loaded.length - 1] as { role?: string; webchatEarlySave?: boolean } | undefined;
      if (lastMsg?.role === 'user' && lastMsg.webchatEarlySave === true) {
        loaded = loaded.slice(0, -1);
      }
      agent.replaceMessages(this.prepareLoadedSessionMessages(sessionKey, loaded));

      await this.modelManager.applyModelForSession(agent, sessionKey);
      await this.applyResolvedThinkingLevel(sessionKey, thinking);

      const sttCfg = mergeSttConfigFromAppConfig(this.config.config?.stt);
      const { text: mergedUserText, inboundVoice } = await mergeVoiceTranscriptsIntoUserText(
        this.workspaceDir,
        prepared,
        content,
        sttCfg,
      );

      const messageContent = this.buildMessageContent(mergedUserText, prepared);

      const armAbort = () => {
        if (abortHandled) {
          return;
        }
        abortHandled = true;
        userAborted = true;
        this.agentOrchestrator.abort(sessionKey);
        agentDone = true;
        pushEvent({ type: '__done__' });
      };
      if (signal) {
        if (signal.aborted) {
          armAbort();
        } else {
          signal.addEventListener('abort', armAbort, { once: true });
        }
      }

      if (!abortHandled) {
        const agentPromise = (async () => {
          await runAgentTurnWithModelFallbacks({
            agent,
            sessionKey,
            modelManager: this.modelManager,
            userMessage: {
              role: 'user',
              content: messageContent,
              timestamp: Date.now(),
            },
            log,
          });
        })();

        agentPromise
          .then(() => {
            if (abortHandled) {
              return;
            }
            agentDone = true;
            pushEvent({ type: '__done__' });
          })
          .catch((err) => {
            if (abortHandled) {
              return;
            }
            agentDone = true;
            pushEvent({ type: 'error', content: err instanceof Error ? err.message : String(err) });
            pushEvent({ type: '__done__' });
          });
      }

      while (true) {
        if (eventQueue.length > 0) {
          const event = eventQueue.shift()!;
          if (event.type === '__done__') break;
          yield event;
        } else if (agentDone) {
          break;
        } else {
          await new Promise<void>((resolve) => {
            resolveWaiting = resolve;
          });
        }
      }

      while (eventQueue.length > 0) {
        const event = eventQueue.shift()!;
        if (event.type === '__done__') continue;
        yield event;
      }

      await this.persistAgentSessionMessages(sessionKey);

      if (!userAborted) {
        const ttsAudioEvent = await this.maybeEmitWebchatTts(sessionKey, inboundVoice);
        if (ttsAudioEvent) {
          yield ttsAudioEvent;
        }
      }
    } finally {
      unsubscribeStreaming();
      this.endDirectRequestContext();
    }
  }

  /**
   * Generate TTS for webchat when config allows, persist under `.xopcbot/tts/`, attach to last assistant turn.
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
      const fmt = getChannelOutputFormat('webchat').format as 'opus' | 'mp3' | 'wav';
      const ttsResult = await speak(text, ttsConfig, {
        tts: { format: fmt },
      });
      const { buffer, format } = await compressAudio(Buffer.from(ttsResult.audio), ttsResult.format);
      const normalizedMime =
        format === 'opus' || format === 'ogg'
          ? 'audio/ogg'
          : format === 'mp3' || format === 'mpeg'
            ? 'audio/mpeg'
            : format === 'wav'
              ? 'audio/wav'
              : `audio/${format}`;
      const persisted = await persistOutboundTtsAudio(this.workspaceDir, sessionKey, buffer, format);
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
      // Get or create agent for this session
      const agent = this.agentManager.getOrCreateAgent(sessionKey);

      await this.hydrateSessionModelFromStore(sessionKey);

      const loaded = await this.sessionStore.load(sessionKey);
      agent.replaceMessages(this.prepareLoadedSessionMessages(sessionKey, loaded));

      await this.modelManager.applyModelForSession(agent, sessionKey);
      await this.applyResolvedThinkingLevel(sessionKey, thinking);

      const prepared = await this.prepareInboundAttachments(sessionKey, attachments);
      const messageContent = this.buildMessageContent(content, prepared);

      await runAgentTurnWithModelFallbacks({
        agent,
        sessionKey,
        modelManager: this.modelManager,
        userMessage: {
          role: 'user',
          content: messageContent,
          timestamp: Date.now(),
        },
        log,
      });

      const response = this.agentManager.getLastAssistantContent(sessionKey) || '';
      await this.persistAgentSessionMessages(sessionKey);

      return response;
    } finally {
      this.endDirectRequestContext();
      // Don't unsubscribe here - keep the session agent alive for future messages
    }
  }

  private async handleInboundMessage(msg: InboundMessage): Promise<void> {
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

    this.sessionContextManager.setContext(sessionContext);
    this.feedbackCoordinator.setContext(sessionContext);

    // Setup event handling for this session
    this.setupSessionEventHandling(sessionContext.sessionKey);

    await this.sessionLifecycleManager.startSession(sessionContext);

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
      let typingController: TypingController | null = null;
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
            // Telegram doesn't have typing_off, but keep for consistency
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

      try {
        await this.agentOrchestrator.process(msg, sessionContext);
      } finally {
        // Stop typing indicator after processing completes
        typingController?.stop();
      }

    } finally {
      await this.sessionLifecycleManager.endSession(sessionContext);
      await this.streamManager.end();
      await this.sendFinalResponse(msg, sessionContext);
      this.feedbackCoordinator.endTask();
      this.sessionContextManager.clearContext();
      this.feedbackCoordinator.clearContext();
    }
  }

  private async handleSystemMessage(msg: InboundMessage, context: SessionContext): Promise<void> {
    log.debug({ sessionKey: context.sessionKey }, 'Processing system message');

    // Get or create agent for this session
    const agent = this.agentManager.getOrCreateAgent(context.sessionKey);

    const messages = await this.sessionStore.load(context.sessionKey);
    await this.checkAndCompact(context.sessionKey, messages);
    const refreshedMessages = await this.sessionStore.load(context.sessionKey);
    agent.replaceMessages(this.prepareLoadedSessionMessages(context.sessionKey, refreshedMessages));

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
      log.error({ err: error, sessionKey: context.sessionKey }, 'Error processing system message');
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
    // Only process events for the current context session
    const currentContext = this.sessionContextManager.getContext();
    if (currentContext?.sessionKey !== sessionKey) {
      // Event from a different session - still process but don't update stream
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

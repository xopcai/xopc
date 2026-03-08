/**
 * Agent Service - Main coordinator (Refactored)
 *
 * Orchestrates message processing, model management, and session handling.
 * Delegates specific concerns to specialized modules.
 */

import { Agent, type AgentEvent, type AgentMessage } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import { MessageBusShutdownError, type MessageBus, type InboundMessage } from '../bus/index.js';
import type { Config, AgentDefaults } from '../config/schema.js';
import type { ChannelManager } from '../channels/manager.js';

import { resolveModel, getDefaultModel, getApiKey as getProviderApiKey } from '../providers/index.js';
import { SessionStore, type CompactionConfig, type WindowConfig } from '../session/index.js';
import { getBundledSkillsDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import { ExtensionRegistryImpl as ExtensionRegistry, ExtensionHookRunner } from '../extensions/index.js';
import { loadBootstrapFiles, extractTextContent, type BootstrapFile } from './helpers.js';
import { SessionTracker } from './session-tracker.js';
import { ModelManager } from './models/index.js';
import { initializeCommands } from '../commands/index.js';
import { ProgressFeedbackManager, type ProgressStage } from './progress.js';
import { HookHandler } from './hook-handler.js';
import { AgentToolsFactory } from './agent-tools-factory.js';
import { ToolErrorTracker } from './tool-error-tracker.js';
import { RequestLimiter } from './request-limiter.js';
import { SystemReminder } from './system-reminder.js';
import { ToolUsageAnalyzer } from './tool-usage-analyzer.js';
import { ToolChainTracker } from './tool-chain-tracker.js';
import { ErrorPatternMatcher } from './error-pattern-matcher.js';
import { SelfVerifyMiddleware } from './middleware/self-verify.js';
import { LifecycleManager } from './lifecycle/index.js';
import { CompactionLifecycleHandler } from './lifecycle/handlers/compaction.js';

// New modular components
import { MessageRouter, CommandHandler, StreamManager } from './messaging/index.js';
import { SessionContextManager, SessionLifecycleManager, type SessionContext } from './session/index.js';
import { AgentOrchestrator, AgentEventHandler } from './orchestration/index.js';
import { FeedbackCoordinator } from './feedback/index.js';
import { SkillManager } from './skills/index.js';
import { SystemPromptBuilder } from './prompt/service-prompt-builder.js';

const log = createLogger('AgentService');

export interface AgentServiceConfig {
  workspace: string;
  model?: string;
  braveApiKey?: string;
  config?: Config;
  agentDefaults?: AgentDefaults;
  extensionRegistry?: ExtensionRegistry;
  maxRequestsPerTurn?: number;
  maxToolFailuresPerTurn?: number;
  maxTaskDurationMs?: number;
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

/**
 * AgentService - Main agent orchestrator (Refactored)
 *
 * This class now acts as a facade, delegating specific concerns to:
 * - MessageRouter: message routing and classification
 * - CommandHandler: command parsing and execution
 * - StreamManager: stream handle management
 * - SessionContextManager: session context tracking
 * - SessionLifecycleManager: session lifecycle events
 * - AgentOrchestrator: agent execution coordination
 * - AgentEventHandler: agent event processing
 * - FeedbackCoordinator: progress feedback coordination
 * - SkillManager: skill loading and management
 * - SystemPromptBuilder: system prompt construction
 */
export class AgentService {
  // Core Agent and infrastructure
  private agent: Agent;
  private sessionStore: SessionStore;
  private hookRunner?: ExtensionHookRunner;
  private unsubscribe?: () => void;
  private running = false;
  private agentId: string;
  private workspaceDir: string;
  private bootstrapFiles: BootstrapFile[] = [];
  private channelManagerRef: ChannelManager | null = null;
  private bus: MessageBus;
  private config: AgentServiceConfig;

  // Legacy delegated modules (kept for compatibility)
  private sessionTracker: SessionTracker;
  private modelManager: ModelManager;
  private progressManager: ProgressFeedbackManager;
  private hookHandler: HookHandler;
  private toolsFactory: AgentToolsFactory;
  private lifecycleManager: LifecycleManager;
  private errorTracker: ToolErrorTracker;
  private requestLimiter: RequestLimiter;
  private systemReminder: SystemReminder;
  private toolUsageAnalyzer: ToolUsageAnalyzer;
  private toolChainTracker: ToolChainTracker;
  private errorPatternMatcher: ErrorPatternMatcher;
  private selfVerifyMiddleware: SelfVerifyMiddleware;

  // New modular components
  private messageRouter: MessageRouter;
  private commandHandler: CommandHandler;
  private streamManager: StreamManager;
  private sessionContextManager: SessionContextManager;
  private sessionLifecycleManager: SessionLifecycleManager;
  private agentOrchestrator: AgentOrchestrator;
  private agentEventHandler: AgentEventHandler;
  private feedbackCoordinator: FeedbackCoordinator;
  private skillManager: SkillManager;
  private systemPromptBuilder: SystemPromptBuilder;

  constructor(bus: MessageBus, config: AgentServiceConfig) {
    this.bus = bus;
    this.config = config;
    this.agentId = `agent-${Date.now()}`;
    this.workspaceDir = config.workspace;

    // Load bootstrap files
    this.bootstrapFiles = loadBootstrapFiles(config.workspace);

    // Initialize legacy delegated modules
    this.sessionTracker = new SessionTracker();
    this.modelManager = new ModelManager({
      defaultModel: config.model,
      config: config.config,
    });

    // Initialize command system
    initializeCommands();
    log.info('Command system initialized');

    // Setup session store
    this.sessionStore = this.createSessionStore();

    // Setup hook runner and handler
    this.hookRunner = this.createHookRunner();
    this.hookHandler = new HookHandler({
      hookRunner: this.hookRunner,
      agentId: this.agentId,
      get sessionKey() { return this.currentContext?.sessionKey; },
    });

    // Initialize tools via factory
    this.toolsFactory = new AgentToolsFactory({
      workspace: config.workspace,
      braveApiKey: config.braveApiKey,
      extensionRegistry: config.extensionRegistry,
      getCurrentContext: () => this.sessionContextManager.getContext(),
      bus,
    });
    const tools = this.toolsFactory.createAllTools();

    // Initialize new modular components
    this.skillManager = new SkillManager(config.workspace, getBundledSkillsDir());
    this.systemPromptBuilder = new SystemPromptBuilder({
      workspace: config.workspace,
      config: config.config!,
      skillManager: this.skillManager,
    });

    // Initialize agent
    this.agent = this.createAgent(tools);
    this.unsubscribe = this.agent.subscribe((event) => this.handleEvent(event));

    // Initialize progress and reliability modules
    this.progressManager = this.createProgressManager();
    this.initializeReliabilityModules();

    // Initialize lifecycle manager
    this.lifecycleManager = new LifecycleManager();
    this.initializeLifecycleHandlers();

    // Initialize new modular architecture
    this.streamManager = new StreamManager();
    this.sessionContextManager = new SessionContextManager();
    this.feedbackCoordinator = new FeedbackCoordinator({
      progressManager: this.progressManager,
      bus,
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
      agent: this.agent,
      sessionStore: this.sessionStore,
      modelManager: this.modelManager,
      eventHandler: this.agentEventHandler,
      feedbackCoordinator: this.feedbackCoordinator,
    });

    this.messageRouter = new MessageRouter({ workspace: config.workspace });
    this.commandHandler = new CommandHandler({
      config: config.config!,
      bus,
      sessionStore: this.sessionStore,
      getCurrentModel: () => this.agentOrchestrator.getCurrentModel(),
      switchModelForSession: (sessionKey: string, modelId: string) =>
        this.switchModelForSession(sessionKey, modelId),
    });

    this.sessionLifecycleManager = new SessionLifecycleManager(
      this.sessionStore,
      this.sessionTracker,
      this.lifecycleManager
    );

    // Setup shutdown handlers
    process.on('SIGINT', () => this.dispose());
    process.on('SIGTERM', () => this.dispose());

    log.info('AgentService initialized with modular architecture');
  }

  // ============================================================================
  // Initialization Helpers
  // ============================================================================

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
    return new SessionStore(this.config.workspace, windowConfig, compactionConfig);
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

  private createAgent(tools: any[]): Agent {
    let model: Model<Api>;
    if (this.config.model) {
      try {
        model = resolveModel(this.config.model);
      } catch {
        const defaultModel = getDefaultModel(this.config.config);
        log.warn({ model: this.config.model, defaultModel }, 'Model not found, using default');
        model = resolveModel(defaultModel);
      }
    } else {
      const defaultModel = getDefaultModel(this.config.config);
      model = resolveModel(defaultModel);
    }

    return new Agent({
      initialState: {
        systemPrompt: this.systemPromptBuilder.build(this.bootstrapFiles),
        model,
        tools,
        messages: [],
      },
      getApiKey: (provider: string) => {
        return getProviderApiKey(this.config.config, provider);
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
  }

  private initializeLifecycleHandlers(): void {
    this.lifecycleManager.on('llm_response', new CompactionLifecycleHandler({
      minMessages: 20,
      maxTokens: 8000,
      preserveReasoning: true,
      accumulateUsage: true,
    }));

    log.info(
      { handlers: this.lifecycleManager.getRegisteredHandlers() },
      'Lifecycle handlers initialized'
    );
  }

  // ============================================================================
  // Public API (Maintains backward compatibility)
  // ============================================================================

  setChannelManager(channelManager: ChannelManager): void {
    this.modelManager.setChannelManager(channelManager);
    this.channelManagerRef = channelManager;
  }

  async switchModelForSession(sessionKey: string, modelId: string): Promise<boolean> {
    const result = await this.modelManager.switchModelForSession(sessionKey, modelId);
    if (result) {
      this.sessionTracker.touchSession(sessionKey);
    }
    return result;
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
    await this.hookHandler.trigger('gateway_start', { port: 0, host: 'cli' });
    log.info('Agent service started');
    await this.hookHandler.trigger('session_start', { sessionId: this.agentId });

    while (this.running) {
      try {
        const msg = await this.bus.consumeInbound();
        await this.handleInboundMessage(msg);
      } catch (error) {
        // MessageBusShutdownError is expected during graceful shutdown
        if (error instanceof MessageBusShutdownError) {
          break;
        }
        log.error({ err: error }, 'Error in agent loop');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    await this.hookHandler.trigger('session_end', {
      sessionId: this.agentId,
      messageCount: this.agent.state.messages.length,
    });
  }

  stop(): Promise<void> {
    this.running = false;
    this.agent.abort();
    this.unsubscribe?.();
    this.dispose();

    this.hookHandler.trigger('gateway_stop', { reason: 'stopped' });
    log.info('Agent service stopped');
    return Promise.resolve();
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

  async processDirect(
    content: string,
    sessionKey = 'cli:direct',
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
    }>
  ): Promise<string> {
    // Parse sessionKey to extract channel and chatId
    const parts = sessionKey.split(':');
    const channel = parts[0] || 'cli';
    const chatId = parts.slice(1).join(':') || 'direct';

    // Create and set context for this direct processing
    const context: SessionContext = {
      sessionKey,
      channel,
      chatId,
      senderId: '',
      isGroup: false,
    };

    this.sessionContextManager.setContext(context);
    this.feedbackCoordinator.setContext(context);

    try {
      const messages = await this.sessionStore.load(sessionKey);
      this.agent.replaceMessages(messages);

      const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];

      if (content.trim()) {
        messageContent.push({ type: 'text', text: content });
      }

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.type === 'image' || att.mimeType?.startsWith('image/')) {
            const mimeType = att.mimeType || 'image/png';
            const data = att.data || '';
            messageContent.push({ type: 'image', data, mimeType });
          } else {
            const fileInfo = `[File: ${att.name || 'unknown'} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
            messageContent.push({ type: 'text', text: fileInfo });
          }
        }
      }

      await this.agent.prompt({
        role: 'user',
        content: messageContent,
        timestamp: Date.now(),
      });
      await this.agent.waitForIdle();

      const response = this.getLastAssistantContent() || '';
      await this.sessionStore.save(sessionKey, this.agent.state.messages);

      return response;
    } finally {
      // Clear context after processing
      this.sessionContextManager.clearContext();
      this.feedbackCoordinator.clearContext();
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async handleInboundMessage(msg: InboundMessage): Promise<void> {
    // Route the message
    const routing = await this.messageRouter.routeMessage(msg);
    const { context, isCommand, command, commandArgs } = routing;

    // Create SessionContext from AgentContext (ensuring required fields)
    const sessionContext: SessionContext = {
      sessionKey: context.sessionKey,
      channel: context.channel,
      chatId: context.chatId,
      senderId: context.senderId || '',
      isGroup: context.isGroup || false,
    };

    // Set context for this message
    this.sessionContextManager.setContext(sessionContext);
    this.feedbackCoordinator.setContext(sessionContext);

    // Start session lifecycle
    await this.sessionLifecycleManager.startSession(sessionContext);

    try {
      // Handle system messages
      if (msg.channel === 'system') {
        await this.handleSystemMessage(msg, sessionContext);
        return;
      }

      // Handle commands
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

      // Send typing indicator
      if (msg.channel !== 'cli') {
        this.bus.publishOutbound({
          channel: msg.channel,
          chat_id: msg.chat_id,
          content: '',
          type: 'typing_on',
          metadata: {
            accountId: msg.metadata?.accountId,
            threadId: msg.metadata?.threadId,
          },
        }).catch(err => {
          log.warn({ err }, 'Failed to send typing indicator');
        });
      }

      // Setup streaming if channel manager is available
      if (this.channelManagerRef && msg.channel !== 'cli') {
        const streamHandle = this.channelManagerRef.startStream(
          msg.channel,
          msg.chat_id,
          msg.metadata?.accountId as string | undefined
        );
        
        if (streamHandle) {
          this.setStreamHandle(streamHandle as StreamHandle);
        }
      }

      // Process through agent orchestrator
      await this.agentOrchestrator.process(msg, sessionContext);

    } finally {
      // End session lifecycle
      await this.sessionLifecycleManager.endSession(sessionContext);
      
      // End and cleanup stream
      await this.streamManager.end();
      this.feedbackCoordinator.endTask();
      
      this.sessionContextManager.clearContext();
      this.feedbackCoordinator.clearContext();
    }
  }

  private async handleSystemMessage(msg: InboundMessage, context: SessionContext): Promise<void> {
    log.debug({ sessionKey: context.sessionKey }, 'Processing system message');

    const messages = await this.sessionStore.load(context.sessionKey);
    await this.checkAndCompact(context.sessionKey, messages);
    const refreshedMessages = await this.sessionStore.load(context.sessionKey);
    this.agent.replaceMessages(refreshedMessages);

    const systemMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: `[System: ${msg.sender_id}] ${msg.content}` }],
      timestamp: Date.now(),
    };

    try {
      await this.agent.prompt(systemMessage);
      await this.agent.waitForIdle();

      const finalContent = this.getLastAssistantContent();
      if (finalContent) {
        const hookResult = await this.hookHandler.runMessageSending(context.chatId, finalContent);
        if (hookResult.send) {
          await this.bus.publishOutbound({
            channel: context.channel,
            chat_id: context.chatId,
            content: hookResult.content || finalContent,
            type: 'message',
          });
        }
      }

      await this.sessionStore.save(context.sessionKey, this.agent.state.messages);
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

  private handleEvent(event: AgentEvent): void {
    // Handle streaming updates
    if (event.type === 'message_update') {
      // Cast to any to access message property safely (though TS should narrow it)
      const msgEvent = event as any;
      if (msgEvent.message?.role === 'assistant') {
        const content = msgEvent.message.content;
        const text = Array.isArray(content)
          ? extractTextContent(content as Array<{ type: string; text?: string }>)
          : String(content);
        
        this.streamManager.update(text);
      }
    }

    const context = this.sessionContextManager.getContext();
    this.agentEventHandler.handle(event, context);
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

  private getLastAssistantContent(): string {
    const messages = this.agent.state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') {
        const content = msg.content;
        if (Array.isArray(content)) {
          return extractTextContent(content as Array<{ type: string; text?: string }>);
        }
        return String(content);
      }
    }
    return '';
  }

  private dispose(): void {
    this.sessionTracker.dispose();
  }
}

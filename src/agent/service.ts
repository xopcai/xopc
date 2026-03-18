import type { AgentEvent, AgentMessage, ThinkingLevel } from '@mariozechner/pi-agent-core';
import { MessageBusShutdownError, type MessageBus, type InboundMessage } from '../bus/index.js';
import type { Config, AgentDefaults } from '../config/schema.js';
import type { ChannelManager } from '../channels/manager.js';

import { SessionStore, type CompactionConfig, type WindowConfig } from '../session/index.js';
import { createLogger } from '../utils/logger.js';
import { ExtensionRegistryImpl as ExtensionRegistry, ExtensionHookRunner } from '../extensions/index.js';
import { loadBootstrapFiles, extractTextContent } from './helpers.js';
import { SessionTracker } from './session-tracker.js';
import { ModelManager } from './models/index.js';
import { initializeCommands } from '../commands/index.js';
import { ProgressFeedbackManager, type ProgressStage } from './progress.js';
import { HookHandler } from './hook-handler.js';
import { ToolErrorTracker } from './tool-error-tracker.js';
import { RequestLimiter } from './request-limiter.js';
import { SystemReminder } from './system-reminder.js';
import { ToolUsageAnalyzer } from './tool-usage-analyzer.js';
import { ToolChainTracker } from './tool-chain-tracker.js';
import { ErrorPatternMatcher } from './error-pattern-matcher.js';
import { SelfVerifyMiddleware } from './middleware/self-verify.js';
import { ContextMiddleware } from './middleware/context.js';
import { LifecycleManager } from './lifecycle/index.js';
import { CompactionLifecycleHandler } from './lifecycle/handlers/compaction.js';

import { MessageRouter, CommandHandler, StreamManager } from './messaging/index.js';
import { SessionContextManager, SessionLifecycleManager, type SessionContext } from './session/index.js';
import { AgentOrchestrator, AgentEventHandler } from './orchestration/index.js';
import { FeedbackCoordinator } from './feedback/index.js';
import { AgentManager } from './agent-manager.js';

import { createTypingController, type TypingController } from './typing.js';

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
      braveApiKey: config.braveApiKey,
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

  async switchModelForSession(sessionKey: string, modelId: string): Promise<boolean> {
    // Use AgentManager to set model for the session's agent
    const result = this.agentManager.setModelForSession(sessionKey, modelId);
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

  async *processDirectStreaming(
    content: string,
    sessionKey = 'cli:direct',
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
    }>,
    thinking?: string,
  ): AsyncGenerator<{ type: string; [key: string]: unknown }, void, unknown> {
    const parts = sessionKey.split(':');
    const channel = parts[0] || 'cli';
    const chatId = parts.slice(1).join(':') || 'direct';

    const context: SessionContext = {
      sessionKey,
      channel,
      chatId,
      senderId: '',
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

    const eventQueue: Array<{ type: string; [key: string]: unknown }> = [];
    let resolveWaiting: (() => void) | null = null;
    let agentDone = false;

    // Track last sent content for delta calculation (增量推送优化)
    let lastSentContent = '';

    const pushEvent = (event: { type: string; [key: string]: unknown }) => {
      eventQueue.push(event);
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    };

    const agent = this.agentManager.getOrCreateAgent(sessionKey);
    const unsubscribeStreaming = agent.subscribe((event: AgentEvent) => {
      this.agentEventHandler.handle(event, context);

      switch (event.type) {
        case 'tool_execution_start': {
          const toolEvent = event as Extract<AgentEvent, { type: 'tool_execution_start' }>;
          pushEvent({
            type: 'tool_start',
            toolName: toolEvent.toolName,
            args: toolEvent.args,
          });
          break;
        }
        case 'tool_execution_end': {
          const toolEvent = event as Extract<AgentEvent, { type: 'tool_execution_end' }>;
          pushEvent({
            type: 'tool_end',
            toolName: toolEvent.toolName,
            isError: toolEvent.isError,
            result: typeof toolEvent.result === 'string'
              ? toolEvent.result.slice(0, 500)
              : undefined,
          });
          break;
        }
        case 'message_update': {
          const msgEvent = event as any;
          if (msgEvent.message?.role === 'assistant') {
            const msgContent = msgEvent.message.content;
            const fullText = Array.isArray(msgContent)
              ? extractTextContent(msgContent as Array<{ type: string; text?: string }>)
              : String(msgContent);

            // 计算增量：只推送新增加的内容
            if (fullText.length > lastSentContent.length) {
              const delta = fullText.slice(lastSentContent.length);
              if (delta) {
                pushEvent({ type: 'token', content: delta });
                lastSentContent = fullText;
              }
            } else if (fullText.length < lastSentContent.length) {
              // 内容被重置（比如新消息），推送完整内容
              pushEvent({ type: 'token', content: fullText });
              lastSentContent = fullText;
            }
          }
          break;
        }
        case 'message_start': {
          const msgEvent = event as Extract<AgentEvent, { type: 'message_start' }>;
          if (msgEvent.message?.role === 'assistant') {
            // 重置增量追踪
            lastSentContent = '';
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
      const messages = await this.sessionStore.load(sessionKey);
      agent.replaceMessages(messages);

      if (thinking) {
        this.agentManager.setThinkingLevel(sessionKey, thinking as ThinkingLevel);
      }

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
            const fileInfo = `[File: ${att.name || 'unknown'} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
            messageContent.push({ type: 'text', text: fileInfo });
          }
        }
      }

      const agentPromise = (async () => {
        await agent.prompt({
          role: 'user',
          content: messageContent,
          timestamp: Date.now(),
        });
        await agent.waitForIdle();
      })();

      agentPromise
        .then(() => {
          agentDone = true;
          pushEvent({ type: '__done__' });
        })
        .catch((err) => {
          agentDone = true;
          pushEvent({ type: 'error', content: err instanceof Error ? err.message : String(err) });
          pushEvent({ type: '__done__' });
        });

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

      const finalMessages = this.agentManager.getMessages(sessionKey);
      if (finalMessages) {
        await this.sessionStore.save(sessionKey, finalMessages);
      }
    } finally {
      unsubscribeStreaming();
      this.sessionContextManager.clearContext();
      this.feedbackCoordinator.clearContext();
      this.contextMiddleware.onResponse();
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
    }>,
    thinking?: string,
  ): Promise<string> {
    const parts = sessionKey.split(':');
    const channel = parts[0] || 'cli';
    const chatId = parts.slice(1).join(':') || 'direct';

    const context: SessionContext = {
      sessionKey,
      channel,
      chatId,
      senderId: '',
      isGroup: false,
    };

    // Start request context for logging
    this.contextMiddleware.onRequest({
      sessionKey,
      userId: context.senderId,
      channel,
      chatId,
    });

    this.sessionContextManager.setContext(context);
    this.feedbackCoordinator.setContext(context);

    // Setup event handling for this session
    this.setupSessionEventHandling(sessionKey);

    try {
      // Get or create agent for this session
      const agent = this.agentManager.getOrCreateAgent(sessionKey);

      const messages = await this.sessionStore.load(sessionKey);
      agent.replaceMessages(messages);

      // Set thinking level if provided
      if (thinking) {
        this.agentManager.setThinkingLevel(sessionKey, thinking as ThinkingLevel);
      }

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

      await agent.prompt({
        role: 'user',
        content: messageContent,
        timestamp: Date.now(),
      });
      await agent.waitForIdle();

      const response = this.agentManager.getLastAssistantContent(sessionKey) || '';
      const finalMessages = this.agentManager.getMessages(sessionKey);
      if (finalMessages) {
        await this.sessionStore.save(sessionKey, finalMessages);
      }

      return response;
    } finally {
      this.sessionContextManager.clearContext();
      this.feedbackCoordinator.clearContext();
      this.contextMiddleware.onResponse();
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
        const streamHandle = this.channelManagerRef.startStream(
          msg.channel,
          msg.chat_id,
          msg.metadata?.accountId as string | undefined
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
    agent.replaceMessages(refreshedMessages);

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

      const finalMessages = this.agentManager.getMessages(context.sessionKey);
      if (finalMessages) {
        await this.sessionStore.save(context.sessionKey, finalMessages);
      }
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
      const msgEvent = event as any;
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
    const finalContent = this.agentManager.getLastAssistantContent(sessionContext.sessionKey);
    if (!finalContent?.trim()) return;

    const hookResult = await this.hookHandler.runMessageSending(sessionContext.chatId, finalContent);
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

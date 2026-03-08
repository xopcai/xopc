/**
 * Agent Service - Main coordinator
 *
 * Orchestrates message processing, model management, and session handling.
 * Refactored to delegate specific concerns to specialized modules.
 */

import { readFileSync } from 'fs';
import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { MessageBus, InboundMessage } from '../bus/index.js';
import type { Config, AgentDefaults } from '../config/schema.js';
import type { ExtensionTool } from '../extensions/types/index.js';
import { resolveModel, DEFAULT_MODEL, getApiKey as getProviderApiKey } from '../providers/index.js';
import { SessionStore, type CompactionConfig, type WindowConfig } from '../session/index.js';
import { SessionCompactor } from './memory/compaction.js';
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  createShellTool,
  grepTool,
  findTool,
  createWebSearchTool,
  webFetchTool,
  createMessageTool,
  createSendMediaTool,
  createMemorySearchTool,
  createMemoryGetTool,
} from './tools/index.js';
import { createSkillLoader, type Skill } from './skills/index.js';
import { getBundledSkillsDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import { ExtensionRegistryImpl as ExtensionRegistry, ExtensionHookRunner, createHookContext } from '../extensions/index.js';
import { buildSystemPrompt } from './system-prompt.js';
import { createTypingController } from './typing.js';
import { loadBootstrapFiles, extractTextContent, type BootstrapFile } from './helpers.js';
import { SessionTracker } from './session-tracker.js';
import { ModelManager } from './models/index.js';
import { initializeCommands } from '../commands/index.js';
import { getModelsByProvider, getProviderDisplayName, isProviderConfigured, getAllProviders } from '../providers/index.js';

const log = createLogger('AgentService');

export interface AgentServiceConfig {
  workspace: string;
  model?: string;
  braveApiKey?: string;
  config?: Config;
  agentDefaults?: AgentDefaults;
  extensionRegistry?: ExtensionRegistry;
}

interface AgentContext {
  channel: string;
  chatId: string;
  sessionKey: string;
}

/**
 * AgentService - Main agent orchestrator
 *
 * Delegates to:
 * - SessionTracker: session state and cleanup
 * - ModelManager: model selection and fallback
 * - SessionStore: message persistence
 * - ExtensionRegistry: hooks and tools
 */
export class AgentService {
  private agent: Agent;
  private sessionStore: SessionStore;
  private compactor: SessionCompactor;
  private hookRunner?: ExtensionHookRunner;
  private unsubscribe?: () => void;
  private running = false;
  private currentContext: AgentContext | null = null;
  private agentId: string;
  private skillPrompt: string = '';
  private skills: Skill[] = [];
  private skillLoader = createSkillLoader();
  private workspaceDir: string;
  private bootstrapFiles: BootstrapFile[] = [];

  // Delegated modules
  private sessionTracker: SessionTracker;
  private modelManager: ModelManager;

  constructor(private bus: MessageBus, private config: AgentServiceConfig) {
    this.agentId = `agent-${Date.now()}`;
    this.workspaceDir = config.workspace;

    // Load bootstrap files
    this.bootstrapFiles = loadBootstrapFiles(config.workspace);

    // Initialize delegated modules
    this.sessionTracker = new SessionTracker();
    this.modelManager = new ModelManager({
      defaultModel: config.model,
      config: config.config,
    });

    // Initialize command system
    initializeCommands();
    log.info('Command system initialized');

    // Setup session store
    const defaults = config.agentDefaults || config.config?.agents?.defaults;
    const windowConfig: Partial<WindowConfig> = {
      maxMessages: 100,
      keepRecentMessages: defaults?.maxToolIterations || 20,
      preserveSystemMessages: true,
    };
    const compactionConfig: Partial<CompactionConfig> = {
      enabled: defaults?.compaction?.enabled ?? true,
      mode: (defaults?.compaction?.mode as 'extractive' | 'abstractive' | 'structured') || 'abstractive',
      reserveTokens: defaults?.compaction?.reserveTokens || 8000,
      triggerThreshold: defaults?.compaction?.triggerThreshold || 0.8,
      minMessagesBeforeCompact: defaults?.compaction?.minMessagesBeforeCompact || 10,
      keepRecentMessages: defaults?.compaction?.keepRecentMessages || 10,
    };
    this.sessionStore = new SessionStore(config.workspace, windowConfig, compactionConfig);

    // Setup hook runner
    if (config.extensionRegistry) {
      this.hookRunner = new ExtensionHookRunner(config.extensionRegistry, {
        catchErrors: true,
        logger: {
          info: (msg) => log.info({ hook: true }, msg),
          warn: (msg) => log.warn({ hook: true }, msg),
          error: (msg) => log.error({ hook: true }, msg),
        },
      });
    }

    // Initialize tools
    const tools: AgentTool<any, any>[] = [
      readFileTool,
      writeFileTool,
      editFileTool,
      listDirTool,
      grepTool,
      findTool,
      createShellTool(config.workspace),
      createWebSearchTool(config.braveApiKey),
      webFetchTool,
      createMessageTool(bus, () => this.currentContext),
      createSendMediaTool(bus, () => this.currentContext),
      createMemorySearchTool(config.workspace),
      createMemoryGetTool(config.workspace),
    ];

    if (config.extensionRegistry) {
      const pluginTools = this.convertExtensionTools(config.extensionRegistry.getAllTools());
      tools.push(...pluginTools);
      log.info({ count: pluginTools.length }, 'Loaded plugin tools');
    }

    // Load skills
    const skillResult = this.skillLoader.init(config.workspace, getBundledSkillsDir());
    this.skillPrompt = skillResult.prompt;
    this.skills = skillResult.skills;
    for (const diag of skillResult.diagnostics) {
      if (diag.type === 'collision') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill collision');
      } else if (diag.type === 'warning') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill warning');
      }
    }
    log.info({ count: skillResult.skills.length }, 'Skills loaded');

    // Initialize agent
    let model: Model<Api>;
    if (config.model) {
      try {
        model = resolveModel(config.model);
      } catch {
        log.warn({ model: config.model }, 'Model not found, using default');
        model = resolveModel(DEFAULT_MODEL);
      }
    } else {
      model = resolveModel(DEFAULT_MODEL);
    }

    this.agent = new Agent({
      initialState: {
        systemPrompt: this.getSystemPrompt(),
        model,
        tools,
        messages: [],
      },
      getApiKey: (provider: string) => {
        return getProviderApiKey(config.config, provider);
      },
    });

    this.unsubscribe = this.agent.subscribe((event) => this.handleEvent(event));

    // Setup shutdown handlers
    process.on('SIGINT', () => this.dispose());
    process.on('SIGTERM', () => this.dispose());
  }

  // ============================================================================
  // Public API
  // ============================================================================

  setChannelManager(channelManager: any): void {
    this.modelManager.setChannelManager(channelManager);
  }

  async switchModelForSession(sessionKey: string, modelId: string): Promise<boolean> {
    const result = await this.modelManager.switchModelForSession(sessionKey, modelId);
    if (result) {
      this.sessionTracker.touchSession(sessionKey);
    }
    return result;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.triggerHook('gateway_start', { port: 0, host: 'cli' });
    log.info('Agent service started');
    await this.triggerHook('session_start', { sessionId: this.agentId });

    while (this.running) {
      try {
        const msg = await this.bus.consumeInbound();
        await this.handleInboundMessage(msg);
      } catch (error) {
        log.error({ err: error }, 'Error in agent loop');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    await this.triggerHook('session_end', {
      sessionId: this.agentId,
      messageCount: this.agent.state.messages.length,
    });
  }

  stop(): Promise<void> {
    this.running = false;
    this.agent.abort();
    this.unsubscribe?.();
    this.dispose();

    this.triggerHook('gateway_stop', { reason: 'stopped' });
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
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private dispose(): void {
    this.sessionTracker.dispose();
  }

  private async triggerHook(event: string, eventData: Record<string, unknown>): Promise<void> {
    if (!this.hookRunner) return;
    const ctx = createHookContext({
      extensionId: undefined,
      sessionKey: this.currentContext?.sessionKey,
      agentId: this.agentId,
      timestamp: new Date(),
    });
    try {
      await this.hookRunner.runHooks(event as any, eventData, ctx);
    } catch (error) {
      log.warn({ event, err: error }, 'Hook execution failed');
    }
  }

  private async runBeforeToolCallHook(
    _toolName: string,
    _params: Record<string, unknown>
  ): Promise<{ allowed: boolean; params?: Record<string, unknown>; reason?: string }> {
    if (!this.hookRunner) return { allowed: true };
    // ... (simplified, full implementation similar to original)
    return { allowed: true };
  }

  private async runMessageSendingHook(
    to: string,
    content: string
  ): Promise<{ send: boolean; content?: string; reason?: string }> {
    if (!this.hookRunner) return { send: true, content };

    const ctx = createHookContext({
      sessionKey: this.currentContext?.sessionKey,
      agentId: this.agentId,
    });

    return this.hookRunner.runMessageSending(to, content, ctx);
  }

  // 🆕 Phase 1: Input Hook - Intercept and transform user input
  private async runInputHook(
    text: string,
    images: Array<{ type: string; data: string; mimeType?: string }>,
    source: string
  ): Promise<{
    text: string;
    images: Array<{ type: string; data: string; mimeType?: string }>;
    action: 'continue' | 'handled';
    skipAgent: boolean;
    response?: string;
  }> {
    if (!this.hookRunner) {
      return {
        text,
        images,
        action: 'continue',
        skipAgent: false,
      };
    }

    const ctx = createHookContext({
      sessionKey: this.currentContext?.sessionKey,
      agentId: this.agentId,
    });

    return this.hookRunner.runInputHook(text, images, source, ctx);
  }

  // 🆕 Phase 1: Context Hook - Modify messages before sending to LLM
  private async runContextHook(
    messages: AgentMessage[]
  ): Promise<{ messages: AgentMessage[]; modified: boolean }> {
    if (!this.hookRunner) {
      return { messages, modified: false };
    }

    const ctx = createHookContext({
      sessionKey: this.currentContext?.sessionKey,
      agentId: this.agentId,
    });

    const result = await this.hookRunner.runContextHook(messages as any, ctx);
    return { messages: result.messages as AgentMessage[], modified: result.modified };
  }

  private convertExtensionTools(pluginTools: ExtensionTool[]): AgentTool<any, any>[] {
    return pluginTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      label: `🔌 ${tool.name}`,
      async execute(toolCallId: string, params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
        try {
          const result = await tool.execute(params);
          return { content: [{ type: 'text', text: result }], details: {} };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            details: {},
          };
        }
      },
    }));
  }

  private async handleInboundMessage(msg: InboundMessage): Promise<void> {
    // Use sessionKey from metadata if available (for channels with custom session key format like Telegram)
    const sessionKey = (msg.metadata?.sessionKey as string) || `${msg.channel}:${msg.chat_id}`;
    this.currentContext = { channel: msg.channel, chatId: msg.chat_id, sessionKey };

    try {
      await this.triggerHook('message_received', {
        channelId: msg.channel,
        from: msg.sender_id,
        content: msg.content,
        timestamp: new Date(),
      });

      if (msg.channel === 'system') {
        await this.handleSystemMessage(msg);
      } else {
        await this.handleUserMessage(msg);
      }
    } finally {
      this.currentContext = null;
    }
  }

  private async handleUserMessage(msg: InboundMessage): Promise<void> {
    // Use sessionKey from metadata if available (for channels with custom session key format like Telegram)
    const sessionKey = (msg.metadata?.sessionKey as string) || `${msg.channel}:${msg.chat_id}`;
    log.info({ channel: msg.channel, senderId: msg.sender_id, sessionKey }, 'Processing message');

    // Apply model for session
    await this.modelManager.applyModelForSession(this.agent, sessionKey);
    this.sessionTracker.touchSession(sessionKey);

    const typing = createTypingController({
      onStart: async () => {
        await this.bus.publishOutbound({ channel: msg.channel, chat_id: msg.chat_id, type: 'typing_on' });
      },
      onStop: async () => {
        await this.bus.publishOutbound({ channel: msg.channel, chat_id: msg.chat_id, type: 'typing_off' });
      },
    });

    try {
      typing.start();

      const content = msg.content.trim();

      // Check if it's a command using the new command system
      if (content.startsWith('/')) {
        const parsed = this.parseCommand(content);
        if (parsed && parsed.command !== 'skills') { // Keep /skills reload as-is for now
          // Use new command system
          const isGroup = (msg.metadata?.isGroup as boolean) || false;
          const isHandled = await this.executeCommand(parsed.command, parsed.args, {
            sessionKey,
            channel: msg.channel,
            chatId: msg.chat_id,
            senderId: msg.sender_id,
            isGroup,
          });

          if (isHandled) {
            return; // Command was handled
          }
          // If not handled, continue to AI processing (unknown command)
        }
      }

      // Handle /skills reload (legacy, will be migrated)
      if (content === '/skills reload') {
        try {
          this.reloadSkills();
          await this.bus.publishOutbound({
            channel: msg.channel,
            chat_id: msg.chat_id,
            content: '✅ Skills reloaded successfully',
            type: 'message',
          });
        } catch (err) {
          log.error({ err }, 'Failed to reload skills');
          await this.bus.publishOutbound({
            channel: msg.channel,
            chat_id: msg.chat_id,
            content: '❌ Failed to reload skills.',
            type: 'message',
          });
        }
        return;
      }

      // Check plugin commands (legacy, will be migrated)
      if (content.startsWith('/') && this.config.extensionRegistry) {
        try {
          const commandName = content.slice(1).split(/\s+/)[0];
          const pluginCommand = this.config.extensionRegistry.getCommand(commandName);
          if (pluginCommand) {
            const args = content.replace(/^\/\w+\s*/, '');
            await pluginCommand.handler([args]);
            return;
          }
        } catch (err) {
          log.error({ err, command: content }, 'Failed to execute plugin command');
          await this.bus.publishOutbound({
            channel: msg.channel,
            chat_id: msg.chat_id,
            content: `❌ Command failed: ${err instanceof Error ? err.message : String(err)}`,
            type: 'message',
          });
          return;
        }
      }

      // Process message
      const expandedContent = this.expandSkillCommand(msg.content);
      await this.triggerHook('before_agent_start', { prompt: expandedContent });

      // 🆕 Phase 1: Input Hook - Intercept/transform user input
      const inputImages: Array<{ type: string; data: string; mimeType?: string }> = [];
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.type === 'photo' || att.mimeType?.startsWith('image/')) {
            inputImages.push({
              type: 'image',
              data: att.data,
              mimeType: att.mimeType || 'image/jpeg',
            });
          }
        }
      }

      const inputResult = await this.runInputHook(expandedContent, inputImages, msg.channel);

      // If handled by input hook, skip AI processing
      if (inputResult.skipAgent) {
        if (inputResult.response) {
          await this.bus.publishOutbound({
            channel: msg.channel,
            chat_id: msg.chat_id,
            content: inputResult.response,
            type: 'message',
          });
        }
        return;
      }

      // Use transformed content
      const processedContent = inputResult.text;

      let messages = await this.sessionStore.load(sessionKey);
      await this.checkAndCompact(sessionKey, messages);
      messages = await this.sessionStore.load(sessionKey);
      this.agent.replaceMessages(messages);

      // 🆕 Phase 1: Context Hook - Modify messages before sending to LLM
      const contextResult = await this.runContextHook(this.agent.state.messages);
      if (contextResult.modified) {
        this.agent.replaceMessages(contextResult.messages);
      }

      // Build message content with text and attachments
      const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];

      // Add text content (use transformed content from input hook)
      if (processedContent.trim()) {
        messageContent.push({ type: 'text', text: processedContent });
      }

      // Add attachments from inbound message
      // Use transformed images from input hook if available, otherwise use original
      const finalImages = inputResult.images || inputImages;
      if (finalImages.length > 0) {
        for (const img of finalImages) {
          messageContent.push({ type: 'image', data: img.data, mimeType: img.mimeType || 'image/jpeg' });
        }
      }

      // Add non-image attachments as text description
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.type !== 'photo' && !att.mimeType?.startsWith('image/')) {
            const fileInfo = `[File: ${att.name || att.type} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
            messageContent.push({ type: 'text', text: fileInfo });
          }
        }
      }

      const userMessage: AgentMessage = {
        role: 'user',
        content: messageContent,
        timestamp: Date.now(),
      };

      // 🆕 Phase 1: Turn Start Hook
      const turnIndex = this.agent.state.messages.filter(m => m.role === 'user').length + 1;
      await this.triggerHook('turn_start', {
        turnIndex,
        timestamp: Date.now(),
      });

      // Run with fallback
      const currentProvider = this.modelManager.getCurrentProvider();
      const currentModel = this.modelManager.getCurrentModel();
      log.info(
        { sessionKey, provider: currentProvider, model: currentModel },
        'Calling LLM'
      );

      const result = await this.modelManager.runWithFallback(
        this.agent,
        sessionKey,
        userMessage,
        currentProvider,
        currentModel
      );

      // 🆕 Phase 1: Turn End Hook
      await this.triggerHook('turn_end', {
        turnIndex,
        message: {
          role: 'assistant',
          content: result.content || '',
        },
        timestamp: Date.now(),
      });

      // Track usage
      if (result.usage) {
        this.sessionTracker.updateUsage(sessionKey, {
          prompt: result.usage.prompt_tokens,
          completion: result.usage.completion_tokens,
          total: result.usage.total_tokens,
        });
      }

      // Send response
      if (result.content) {
        let contentWithUsage = result.content;
        if (result.usage && msg.channel === 'telegram') {
          const modelName = this.modelManager.getCurrentModel().split('/').pop() || 'unknown';
          contentWithUsage += `\n\n📊 *${modelName}*  \`+${result.usage.prompt_tokens} → ${result.usage.completion_tokens} = ${result.usage.total_tokens}\``;
        }

        // Run message_sending hook for plugin interception
        const hookResult = await this.runMessageSendingHook(msg.chat_id, contentWithUsage);
        if (!hookResult.send) {
          log.info({ chatId: msg.chat_id, reason: hookResult.reason }, 'Message sending blocked by hook');
        } else {
          // Check if TTS should be used (user sent voice message and TTS is enabled)
          const userSentVoice = msg.metadata?.transcribedVoice === true;
          const ttsEnabled = this.config.config?.tts?.enabled && this.config.config?.tts?.trigger === 'auto';
          const useTTS = userSentVoice && ttsEnabled && msg.channel === 'telegram';

          await this.bus.publishOutbound({
            channel: msg.channel,
            chat_id: msg.chat_id,
            content: hookResult.content || contentWithUsage,
            type: 'message',
            tts: useTTS || undefined,
          });
          await this.triggerHook('message_sent', { to: msg.chat_id, content: hookResult.content || contentWithUsage, success: true });
        }
      }

      await this.sessionStore.save(sessionKey, this.agent.state.messages);
      await this.triggerHook('agent_end', { messages: this.agent.state.messages, success: true, durationMs: 0 });
    } finally {
      typing.stop();
    }
  }

  private async handleSystemMessage(msg: InboundMessage): Promise<void> {
    log.info({ senderId: msg.sender_id, content: msg.content }, 'Processing system message');

    // Check if this is a channel command request (e.g., from Telegram /new, /usage handlers)
    // These commands are sent via system channel but should be handled by the unified command system
    if (msg.metadata?.sessionKey && msg.content.startsWith('/')) {
      const sessionKey = msg.metadata.sessionKey as string;
      const parsed = this.parseCommand(msg.content);

      if (parsed) {
        // Use parseSessionKey to extract channel info from sessionKey
        const { parseSessionKey } = await import('../commands/session-key.js');
        const sessionInfo = parseSessionKey(sessionKey);
        const channel = sessionInfo.source;

        // Use unified command system to handle the command
        const isHandled = await this.executeCommand(parsed.command, parsed.args, {
          sessionKey,
          channel,
          chatId: sessionInfo.chatId,
          senderId: msg.sender_id,
          isGroup: (msg.metadata?.isGroup as boolean) || false,
        });

        if (isHandled) {
          return; // Command was handled by the command system
        }
      }
    }

    // Legacy system messages that need AI processing
    // (messages that don't start with / or weren't handled by command system)

    // Handle Telegram /usage explicitly (for backward compatibility)
    if (msg.content === '/usage' && msg.sender_id === 'telegram:usage') {
      const sessionKey = (msg.metadata?.sessionKey as string) || `telegram:${msg.chat_id}`;
      const usage = this.sessionTracker.getUsage(sessionKey);
      this.sessionTracker.touchSession(sessionKey);

      if (usage) {
        const modelName = this.modelManager.getCurrentModel().split('/').pop() || 'unknown';
        await this.bus.publishOutbound({
          channel: 'telegram',
          chat_id: msg.chat_id,
          content:
            '📊 *Session Token Usage*\n\n' +
            `🤖 Model: ${modelName}\n` +
            `📥 Prompt: ${usage.prompt.toLocaleString()} tokens\n` +
            `📤 Completion: ${usage.completion.toLocaleString()} tokens\n` +
            `📊 Total: ${usage.total.toLocaleString()} tokens`,
          type: 'message',
        });
      } else {
        await this.bus.publishOutbound({
          channel: 'telegram',
          chat_id: msg.chat_id,
          content: '📊 No usage data available for this session yet.',
          type: 'message',
        });
      }
      return;
    }

    // Parse origin channel
    let originChannel = 'cli';
    let originChatId = msg.chat_id;
    if (msg.chat_id.includes(':')) {
      const [ch, ...rest] = msg.chat_id.split(':');
      originChannel = ch;
      originChatId = rest.join(':');
    }

    // Use sessionKey from metadata if available (for channels with custom session key format like Telegram)
    const sessionKey = (msg.metadata?.sessionKey as string) || `${originChannel}:${originChatId}`;
    let messages = await this.sessionStore.load(sessionKey);
    await this.checkAndCompact(sessionKey, messages);
    messages = await this.sessionStore.load(sessionKey);
    this.agent.replaceMessages(messages);

    const systemMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: `[System: ${msg.sender_id}] ${msg.content}` }],
      timestamp: Date.now(),
    };

    await this.agent.prompt(systemMessage);
    await this.agent.waitForIdle();

    const finalContent = this.getLastAssistantContent();
    if (finalContent) {
      // Run message_sending hook for plugin interception
      const hookResult = await this.runMessageSendingHook(originChatId, finalContent);
      if (!hookResult.send) {
        log.info({ chatId: originChatId, reason: hookResult.reason }, 'System message sending blocked by hook');
      } else {
        await this.bus.publishOutbound({
          channel: originChannel,
          chat_id: originChatId,
          content: hookResult.content || finalContent,
          type: 'message',
        });
      }
    }

    await this.sessionStore.save(sessionKey, this.agent.state.messages);
  }

  private async checkAndCompact(sessionKey: string, messages: AgentMessage[]): Promise<void> {
    const contextWindow = this.getContextWindow();
    const prep = this.sessionStore.prepareCompaction(sessionKey, messages, contextWindow);
    if (!prep.needsCompaction) return;

    log.info({ sessionKey, reason: prep.stats?.reason, usagePercent: prep.stats?.usagePercent }, 'Session needs compaction');

    try {
      const result = await this.sessionStore.compact(sessionKey, messages, contextWindow);
      await this.triggerHook('after_compaction', {
        messageCount: messages.length,
        tokenCount: result.tokensBefore,
        compactedCount: messages.length - result.firstKeptIndex,
      });
      log.info({ sessionKey, tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter }, 'Session compacted');
    } catch (error) {
      log.error({ err: error, sessionKey }, 'Failed to compact session');
    }
  }

  private getContextWindow(): number {
    const defaults = this.config.agentDefaults || this.config.config?.agents?.defaults;
    return defaults?.maxTokens ? defaults.maxTokens * 4 : 128000;
  }

  private handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        log.debug('Agent turn started');
        break;
      case 'turn_start':
        log.debug('Turn started');
        break;
      case 'message_start':
        if (event.message.role === 'assistant') log.debug('Assistant response starting');
        break;
      case 'message_end':
        if (event.message.role === 'assistant') {
          const content = event.message.content;
          const text = Array.isArray(content)
            ? extractTextContent(content as Array<{ type: string; text?: string }>)
            : String(content);
          log.debug({ contentLength: text.length }, 'Assistant response complete');
        }
        break;
      case 'tool_execution_start':
        log.debug({ tool: event.toolName }, 'Tool execution started');
        break;
      case 'tool_execution_end':
        log.debug({ tool: event.toolName, isError: event.isError }, 'Tool execution complete');
        break;
      case 'turn_end':
        log.debug('Turn complete');
        break;
      case 'agent_end':
        log.debug('Agent turn ended');
        break;
    }
  }

  private getLastAssistantContent(): string | null {
    const messages = this.agent.state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        const content = messages[i].content;
        if (Array.isArray(content)) {
          return extractTextContent(content as Array<{ type: string; text?: string }>);
        }
        return String(content);
      }
    }
    return null;
  }

  private getSystemPrompt(): string {
    // Get heartbeat config from gateway config
    const gatewayConfig = this.config.config?.gateway;
    const heartbeatEnabled = gatewayConfig?.heartbeat?.enabled ?? false;

    // Extract timezone from USER.md for quiet hours display
    const userFile = this.bootstrapFiles.find(f => f.name === 'USER.md');
    let userTimezone: string | undefined;
    if (userFile && !userFile.missing && userFile.content) {
      // Try to extract timezone from USER.md content
      const tzMatch = userFile.content.match(/Timezone:\s*(.+)/i);
      if (tzMatch) {
        userTimezone = tzMatch[1].trim();
      }
    }

    // Cast BootstrapFile[] to WorkspaceBootstrapFile[] for compatibility
    const prompt = buildSystemPrompt(
      this.config.workspace,
      {
        bootstrapFiles: this.bootstrapFiles as any,
        heartbeatEnabled,
        availableTools: this.skills.map(s => s.name),
        userTimezone,
      }
    );
    return this.skillPrompt ? prompt + '\n\n' + this.skillPrompt : prompt;
  }

  private reloadSkills(): void {
    const skillResult = this.skillLoader.reload();
    this.skillPrompt = skillResult.prompt;
    this.skills = skillResult.skills;
    for (const diag of skillResult.diagnostics) {
      if (diag.type === 'collision') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill collision');
      } else if (diag.type === 'warning') {
        log.warn({ skill: diag.skillName, message: diag.message }, 'Skill warning');
      }
    }
    log.info({ count: skillResult.skills.length }, 'Skills reloaded');
  }

  private expandSkillCommand(text: string): string {
    if (!text.startsWith('/skill:')) return text;
    const spaceIndex = text.indexOf(' ');
    const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
    const args = spaceIndex === -1 ? undefined : text.slice(spaceIndex + 1).trim();

    const skill = this.skills.find((s) => s.name === skillName);
    if (!skill) return text;

    try {
      const rawContent = readFileSync(skill.filePath, 'utf-8');
      const body = rawContent.replace(/^---[\s\S]*?---\n*/, '');
      const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
      return args ? `${skillBlock}\n\n${args}` : skillBlock;
    } catch {
      return text;
    }
  }

  /**
   * Parse a command from message text
   */
  private parseCommand(text: string): { command: string; args: string } | null {
    const trimmed = text.trim();

    if (!trimmed.startsWith('/')) {
      return null;
    }

    const withoutPrefix = trimmed.slice(1);
    const spaceIndex = withoutPrefix.indexOf(' ');

    if (spaceIndex === -1) {
      return { command: withoutPrefix, args: '' };
    }

    return {
      command: withoutPrefix.slice(0, spaceIndex),
      args: withoutPrefix.slice(spaceIndex + 1).trim(),
    };
  }

  /**
   * Execute a command using the new command system
   */
  private async executeCommand(
    commandName: string,
    args: string,
    context: {
      sessionKey: string;
      channel: string;
      chatId: string;
      senderId: string;
      isGroup: boolean;
    }
  ): Promise<boolean> {
    const { commandRegistry, createCommandContext } = await import('../commands/index.js');

    // Check if command exists
    if (!commandRegistry.has(commandName)) {
      return false;
    }

    log.info({ command: commandName, sessionKey: context.sessionKey }, 'Executing command via new system');

    // Create command context
    const cmdCtx = createCommandContext({
      sessionKey: context.sessionKey,
      source: context.channel as any,
      channelId: context.channel,
      chatId: context.chatId,
      senderId: context.senderId,
      isGroup: context.isGroup,
      config: this.config.config!,
      bus: this.bus,
      sessionStore: this.sessionStore,

      replyHandler: async (text: string, _options?) => {
        await this.bus.publishOutbound({
          channel: context.channel,
          chat_id: context.chatId,
          content: text,
          type: 'message',
        });
      },

      typingHandler: async (typing: boolean) => {
        await this.bus.publishOutbound({
          channel: context.channel,
          chat_id: context.chatId,
          type: typing ? 'typing_on' : 'typing_off',
        });
      },

      supportedFeatures: ['markdown', 'typing'],

      getCurrentModel: () => this.modelManager.getCurrentModel(),

      switchModel: async (modelId: string) => {
        return this.modelManager.switchModelForSession(context.sessionKey, modelId);
      },

      listModels: async () => {
        const providers = getAllProviders();
        const models: Array<{ id: string; name: string; provider: string }> = [];

        for (const providerId of providers) {
          if (isProviderConfigured(this.config.config!, providerId)) {
            const providerModels = getModelsByProvider(providerId);
            for (const m of providerModels) {
              models.push({
                id: `${m.provider}/${m.id}`,
                name: m.name || m.id,
                provider: getProviderDisplayName(providerId),
              });
            }
          }
        }

        return models;
      },

      getUsage: async () => {
        const messages = await this.sessionStore.load(context.sessionKey);
        let promptTokens = 0;
        let completionTokens = 0;

        for (const msg of messages) {
          if ('usage' in msg && msg.usage) {
            promptTokens += (msg.usage as any).input || 0;
            completionTokens += (msg.usage as any).output || 0;
          }
        }

        return {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          messageCount: messages.length,
        };
      },
    });

    // Execute command
    const result = await commandRegistry.execute(commandName, cmdCtx, args);

    // Send response if there's content
    if (result.content) {
      await this.bus.publishOutbound({
        channel: context.channel,
        chat_id: context.chatId,
        content: result.content,
        type: 'message',
      });
    }

    return true;
  }
}
